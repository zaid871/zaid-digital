---
title: Wan 2.2 TI2V-5B — Image to Video
emoji: 🎬
colorFrom: purple
colorTo: indigo
sdk: gradio
python_version: "3.12"
app_file: app.py
pinned: false
---

# Wan 2.2 TI2V-5B — Image to Video (Space 1)

Minimal image-to-video Space for the affiliate video pool. One call = one
5-second portrait clip (704×1280 @ 24fps) from a product image + prompt.

- **Model:** `Wan-AI/Wan2.2-TI2V-5B-Diffusers` (official diffusers format,
  WanPipeline, 50 steps) — **Apache 2.0**.
- **API contract:** `predict(image, prompt)` → MP4 path, endpoint `/predict`.
  This exact shape is what the pool bridge sends
  (`client.predict(image, prompt, api_name="/predict")`), so no bridge
  change is needed.
- **Quota:** ZeroGPU free = 5 GPU-min/day, **shared** across all Spaces.
  A 5s 720p clip takes under 9 min on a consumer GPU per the model card,
  so the pool calls this Space at most once per video (1 AI scene, the
  rest is Remotion/FFmpeg motion).

## Saturday creation steps (14 Nov, after ZeroGPU unlocks)

1. HF account `mrcrator` (created 15 Oct 2026) — confirm email verified,
   and **Settings → Hardware** shows ZeroGPU available.
2. **New Space** → SDK **Gradio** → upload these 3 files:
   `app.py`, `requirements.txt`, `README.md` (this file).
3. Space **Settings → Hardware → ZeroGPU** select karo.
   (Hardware files se set nahi hota — Settings se karna padta hai.)
4. Space build hone do (first build pe model download hota hai, time lagega).
5. Test: Space UI pe ek product image + prompt daal ke ek clip banao.
   GPU-min kitne lage, note karo.
6. Uske baad hi, VM se `gradio_client` test call karo, phir
   `HF_SPACES_VIDEO_POOL` mein Space ID daal ke
   `HF_SPACES_VIDEO_ENABLED=true` karo.

## Files

- `app.py` — Gradio app. Pipeline first call par load hota hai (lazy),
  UI turant khulta hai. Portrait output 704×1280, 121 frames @ 24fps.
- `requirements.txt` — diffusers **git main se** (stable PyPI mein Wan2.2
  support abhi nahi hai — model card ke hisaab se).

## Notes

- LTX-2.5 is NOT this Space — uske weights gated hain (401), access
  acceptance chahiye. Turbo (quanhaol) Space 2 hai, baad mein — uska
  licence unverified hai aur usko custom wrapper chahiye.
- Agar Space OOM de (shared half-card par VRAM tight ho), to `app.py`
  mein `pipe.enable_model_cpu_offload()` wala commented fallback use karo
  — slow hoga, lekin chalega.
