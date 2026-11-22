"""Modal workers: GPU upscale (Real-ESRGAN) + background removal (rembg).

Run (needs a Modal account + `modal setup`):
    modal run src/lib/tools/workers/modal-upscale.py::upscale \
        --payload-json '{"image_url": "https://...", "scale": 4}'
    modal run src/lib/tools/workers/modal-upscale.py::remove_background \
        --payload-json '{"image_url": "https://..."}'

Payloads:
    upscale: image_url (str), scale (int, 2 or 4, default 4)
    remove_background: image_url (str)

Output: one RESULT_JSON line — {"output_path", "gpu_minutes", ...}.
Images are saved into the shared "toolbox-outputs" volume. This is the
batch path for POD designs: the TS side sends one image per call (or a
batch through transcribe-style lists), and Modal's T4 does the work the
VM's CPU cannot do at scale — Real-ESRGAN adds real detail (the VM's
upscale only enlarges the canvas) and rembg runs in seconds, not minutes.

NOT live-tested: no Modal account exists yet. First `modal run` is the
validation.
"""

import json
import time
import urllib.request

import modal

app = modal.App("toolbox-upscale")
# Python 3.11 pinned: realesrgan pulls basicsr, whose setup.py cannot
# build a wheel on 3.12+ (debian_slim default) — the image build dies
# with "Failed to build 'basicsr'" (caught 2026-11-22 Modal live test).
image = (
    modal.Image.debian_slim(python_version="3.11")
    # System libs OpenCV/rembg need at runtime: libxcb (libxcb.so.1),
    # libGL (libGL.so.1), glib. Without them the worker dies on import
    # with "libxcb.so.1: cannot open shared object file" (caught
    # 2026-11-22 Modal live test — the image built fine, the run failed).
    .apt_install("libxcb1", "libgl1", "libglib2.0-0")
    # torch/torchvision pinned: basicsr 1.4.2 (a realesrgan dep) imports
    # torchvision.transforms.functional_tensor, which was REMOVED in
    # torchvision 0.17+ — with latest torch the worker dies on import
    # with "No module named 'torchvision.transforms.functional_tensor'"
    # (caught 2026-11-22 Modal live test). torch 2.0.1 + torchvision
    # 0.15.2 is the pair basicsr 1.4.2 was built against.
    .pip_install(
        # numpy pinned <2: torch 2.0.1 was built against numpy 1.x, and
        # numpy 2.x breaks it at runtime ("Numpy is not available")
        # (caught 2026-11-22 Modal live test).
        "torch==2.0.1", "torchvision==0.15.2", "numpy==1.26.4", "realesrgan", "rembg[gpu]", "pillow", "opencv-python-headless"
    )
)
volume = modal.Volume.from_name("toolbox-outputs", create_if_missing=True)


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "toolbox-upscale/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _result(**kw) -> None:
    print("RESULT_JSON:" + json.dumps(kw), flush=True)


@app.function(image=image, gpu="T4", timeout=900, volumes={"/outputs": volume})
def upscale(payload_json: str) -> None:
    import io

    import numpy as np
    import torch
    from PIL import Image
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet

    t0 = time.time()
    payload = json.loads(payload_json)
    scale = int(payload.get("scale", 4))
    if scale not in (2, 4):
        raise ValueError("scale must be 2 or 4")
    raw = _download(payload["image_url"])
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=scale)
    upsampler = RealESRGANer(
        scale=scale,
        model_path=(
            "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x4plus.pth"
            if scale == 4
            else "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth"
        ),
        model=model,
        tile=0,
        tile_pad=10,
        pre_pad=0,
        half=True,
        device="cuda" if torch.cuda.is_available() else "cpu",
    )
    out, _ = upsampler.enhance(np.array(img), outscale=scale)
    out_path = f"/outputs/upscaled-{int(time.time())}.png"
    Image.fromarray(out).save(out_path)
    volume.commit()
    _result(output_path=out_path, scale=scale, gpu_minutes=round((time.time() - t0) / 60, 2))


@app.function(image=image, gpu="T4", timeout=900, volumes={"/outputs": volume})
def remove_background(payload_json: str) -> None:
    import io

    from PIL import Image
    from rembg import remove

    t0 = time.time()
    payload = json.loads(payload_json)
    raw = _download(payload["image_url"])
    out = remove(raw)
    out_path = f"/outputs/nobg-{int(time.time())}.png"
    Image.open(io.BytesIO(out)).save(out_path)
    volume.commit()
    _result(output_path=out_path, gpu_minutes=round((time.time() - t0) / 60, 2))
