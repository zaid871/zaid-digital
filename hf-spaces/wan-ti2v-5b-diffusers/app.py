"""Wan 2.2 TI2V-5B — minimal image-to-video Gradio Space (Space 1).

Contract with the video-pool bridge (src/lib/providers/hf_spaces_bridge.py):
the bridge calls client.predict(image, prompt, *extra, api_name="/predict"),
so this Space exposes exactly ONE function with TWO positional inputs
(image first, prompt second) and returns one MP4 file.

Model: Wan-AI/Wan2.2-TI2V-5B-Diffusers (Apache 2.0, official WanPipeline).
Output is portrait 704x1280 @ 24fps, 121 frames (5s) — the 9:16 size the
Reels pipeline needs. The model card says a 5s 720p clip takes under 9 min
on a consumer GPU, so the pool must use this Space sparingly (1 AI scene
per video, the rest Remotion/FFmpeg) — ZeroGPU quota is 5 GPU-min/day,
shared across all Spaces.

Loading: the pipeline loads at MODULE level, not lazily inside the GPU
function. This is the ZeroGPU docs' recommended pattern, and it is REQUIRED
on the free tier: the scheduler reserves 1.5x the decorator duration
(verified: duration=600 -> 900s requested, duration=240 -> 360s requested,
duration=200 -> 300s requested) and refuses any call whose reservation
reaches the remaining daily quota (300s) — duration=200 (300s requested)
was refused, so the reservation must be STRICTLY below 300s. We use
duration=180 (270s requested) for margin. A lazy load would put the ~10GB
model download inside that 180s GPU window, leaving almost no time for
inference — loading at startup (CPU, no quota) makes the GPU call
inference-only. Importing this module therefore needs torch + the model
download; it is Space-only code.
Diffusers must come from git main (stable PyPI does not have Wan2.2
support yet) — see requirements.txt.
"""

import tempfile

import gradio as gr
import spaces
import torch
from diffusers import AutoencoderKLWan, WanPipeline
from PIL import Image

MODEL_ID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"

# Portrait 9:16 — the TI2V 720p size is 1280x704 or 704x1280 per the model card.
WIDTH = 704
HEIGHT = 1280
NUM_FRAMES = 121  # 121 frames @ 24fps = ~5s (frames % 8 == 1, per model card)
FPS = 24
NUM_INFERENCE_STEPS = 50  # official diffusers example value
GUIDANCE_SCALE = 5.0

# Official negative prompt from the Wan-AI diffusers example.
NEGATIVE_PROMPT = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，"
    "整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，"
    "画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，"
    "手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"
)

# --- Module-level pipeline load (ZeroGPU pattern) ---
# Outside @spaces.GPU, ZeroGPU runs PyTorch in CUDA emulation mode, so
# .to("cuda") works here without a real GPU. The model downloads once at
# Space startup (CPU time, no GPU quota) and stays cached on the Space.
if not torch.cuda.is_available():
    raise RuntimeError("CUDA GPU chahiye — is Space ko ZeroGPU hardware par chalao.")

_VAE = AutoencoderKLWan.from_pretrained(
    MODEL_ID, subfolder="vae", torch_dtype=torch.float32
)
_PIPE = WanPipeline.from_pretrained(MODEL_ID, vae=_VAE, torch_dtype=torch.bfloat16)
_PIPE.to("cuda")
# If this OOMs on the shared half-card, switch to:
#   _PIPE.enable_model_cpu_offload()
# (slower, but lower peak VRAM).


def _to_portrait(image: Image.Image) -> Image.Image:
    """Center-crop to 9:16 and resize to the pipeline's portrait size.
    Product stills are already 1080x1920, so this is a no-op for them."""
    w, h = image.size
    target_ratio = WIDTH / HEIGHT
    ratio = w / h
    if ratio > target_ratio:  # too wide -> crop sides
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        image = image.crop((left, 0, left + new_w, h))
    elif ratio < target_ratio:  # too tall -> crop top/bottom
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        image = image.crop((0, top, w, top + new_h))
    return image.resize((WIDTH, HEIGHT), Image.LANCZOS)


@spaces.GPU(duration=180)
def predict(image, prompt):
    """Bridge contract: predict(image, prompt) -> mp4 path.

    `image` arrives as a PIL image (Gradio converts the uploaded file);
    `prompt` is the scene prompt string. Returns the path of the
    generated MP4 (5s, 704x1280 @ 24fps). The pipeline is already loaded
    (module level), so this call is inference-only.
    """
    if image is None:
        raise gr.Error("Image chahiye — pehle product image do.")
    if not prompt or not str(prompt).strip():
        raise gr.Error("Prompt khaali hai — scene prompt do.")

    from diffusers.utils import export_to_video

    frame0 = _to_portrait(image.convert("RGB"))

    output = _PIPE(
        image=frame0,
        prompt=str(prompt).strip(),
        negative_prompt=NEGATIVE_PROMPT,
        height=HEIGHT,
        width=WIDTH,
        num_frames=NUM_FRAMES,
        guidance_scale=GUIDANCE_SCALE,
        num_inference_steps=NUM_INFERENCE_STEPS,
    ).frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        out_path = tmp.name
    export_to_video(output, out_path, fps=FPS)
    return out_path


demo = gr.Interface(
    fn=predict,
    inputs=[
        gr.Image(type="pil", label="Product image (9:16)"),
        gr.Textbox(label="Prompt", placeholder="Camera slowly pushes in on the product..."),
    ],
    outputs=gr.Video(label="Video (5s, 704x1280 @ 24fps)"),
    title="Wan 2.2 TI2V-5B — Image to Video",
    description=(
        "Minimal image-to-video Space for the affiliate video pool. "
        "One call = one 5s portrait clip. ZeroGPU quota is 5 GPU-min/day (shared), "
        "so the pool calls this at most once per video."
    ),
    api_name="predict",
)

if __name__ == "__main__":
    demo.launch()
