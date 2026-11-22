"""Modal worker: Wan 2.2 TI2V 5B text/image-to-video on an A100-40GB.

Deploy/run (needs a Modal account + `modal setup`):
    modal run src/lib/tools/workers/modal-wan.py::generate \
        --payload-json '{"prompt": "...", "image_url": "https://...", "seconds": 5}'

Payload:
    prompt (str, required) — what the clip should show
    image_url (str, optional) — first-frame image (product shot); when
        absent the model generates from text alone
    negative_prompt (str, optional)
    seconds (int, default 5) — clip length, 1-10
    width/height (int, default 1280x720) — Wan 2.2 5B is a 720p model
    seed (int, optional)

Output: one RESULT_JSON line — {"output_path", "duration_sec",
"gpu_minutes"}. The MP4 is saved into the shared "toolbox-outputs"
volume; download it with `modal volume get` or via the Modal dashboard.
Costs ~9 GPU-min per 5 s 720p clip (measured pattern: Wan 5B needs
>=24 GB VRAM, which is why this runs on A100-40GB, never on the
ZeroGPU Space or a Kaggle T4).

NOT live-tested: no Modal account exists yet. The first `modal run`
is the validation — if diffusers renamed the Wan pipeline class, the
error will say so and the fix is a one-line class swap.
"""

import io
import json
import time
import urllib.request

import modal

app = modal.App("toolbox-wan")
image = modal.Image.debian_slim().pip_install(
    "torch", "diffusers", "transformers", "accelerate", "imageio", "imageio-ffmpeg"
)
volume = modal.Volume.from_name("toolbox-outputs", create_if_missing=True)


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "toolbox-wan/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


@app.function(image=image, gpu="A100-40GB", timeout=1800, volumes={"/outputs": volume})
def generate(payload_json: str) -> None:
    import torch
    from diffusers import WanPipeline
    from PIL import Image

    t0 = time.time()
    payload = json.loads(payload_json)
    prompt = payload["prompt"]
    seconds = int(payload.get("seconds", 5))
    width = int(payload.get("width", 1280))
    height = int(payload.get("height", 720))
    seed = payload.get("seed")
    image_url = payload.get("image_url")
    negative = payload.get("negative_prompt", "")

    pipe = WanPipeline.from_pretrained(
        "Wan-AI/Wan2.2-TI2V-5B-Diffusers", torch_dtype=torch.bfloat16
    )
    pipe.to("cuda")

    image = None
    if image_url:
        image = Image.open(io.BytesIO(_download(image_url))).convert("RGB")

    generator = torch.Generator(device="cuda").manual_seed(int(seed)) if seed else None
    # Wan 2.2 generates at 16 fps; frames = seconds * 16 + 1.
    result = pipe(
        prompt=prompt,
        negative_prompt=negative,
        image=image,
        height=height,
        width=width,
        num_frames=seconds * 16 + 1,
        guidance_scale=5.0,
        generator=generator,
    )
    frames = result.frames[0]

    import imageio

    out_path = f"/outputs/wan-{int(time.time())}.mp4"
    imageio.mimsave(out_path, frames, fps=16, codec="libx264", quality=8)
    volume.commit()

    gpu_minutes = round((time.time() - t0) / 60, 2)
    print(
        "RESULT_JSON:"
        + json.dumps(
            {
                "output_path": out_path,
                "duration_sec": seconds,
                "frames": len(frames),
                "gpu_minutes": gpu_minutes,
            }
        ),
        flush=True,
    )
