"""Modal workers: Whisper transcription (faster-whisper) + batch ETL.

Run (needs a Modal account + `modal setup`):
    modal run src/lib/tools/workers/modal-whisper.py::transcribe \
        --payload-json '{"audio_url": "https://...", "model": "large-v3"}'
    modal run src/lib/tools/workers/modal-whisper.py::transcribe_batch \
        --payload-json '{"audio_urls": ["https://...", "https://..."], "model": "base"}'

Payloads:
    transcribe: audio_url (str), model (str, default "large-v3";
        faster-whisper sizes: tiny/base/small/medium/large-v3)
    transcribe_batch: audio_urls (list[str]), model (str, default "base")

Output: one RESULT_JSON line — transcribe returns {"text", "segments",
"language", "gpu_minutes"}; transcribe_batch returns {"results":
[{audio_url, text, language}...], "gpu_minutes"}. Audio is downloaded
to the container; nothing is persisted to the volume (transcripts go
back through stdout only).

This is the batch path for competitor-video transcription and for the
big-data ETL shards the VM's 2 OCPU cannot chew through: the TS shard
helper (src/lib/tools/shard.ts) splits a list of URLs into N shards
and dispatches each shard as one transcribe_batch call.

NOT live-tested: no Modal account exists yet. First `modal run` is the
validation.
"""

import json
import time
import urllib.request

import modal

app = modal.App("toolbox-whisper")
# av pinned: faster-whisper calls av.open(..., metadata_errors=...),
# but av 19.x removed that parameter (TypeError on open) — caught
# 2026-11-22 Whisper live test. av 13.1.0 still accepts it, but it
# ships no prebuilt cp312 wheel, so pip builds PyAV from source —
# that needs pkg-config + the FFmpeg dev libraries (av 12.3.0 and
# 13.1.0 both died on "pkg-config is required for building PyAV").
image = (
    # CUDA base image: debian_slim has no CUDA runtime libs, and the
    # nvidia-cublas-cu12 pip package's libs are not on ctranslate2's
    # search path (test4/5/6 all died with "libcublas.so.12 is not
    # found"). The nvidia/cuda runtime image ships libcublas in the
    # system library path, so faster-whisper finds it. (Caught
    # 2026-11-22 Whisper live test.)
    modal.Image.from_registry("nvidia/cuda:12.4.1-runtime-ubuntu22.04", add_python="3.12")
    .apt_install(
        "pkg-config",
        "libavformat-dev", "libavcodec-dev", "libavdevice-dev",
        "libavutil-dev", "libswscale-dev", "libswresample-dev", "libavfilter-dev",
    )
    .pip_install("faster-whisper", "av==13.1.0")
)
volume = modal.Volume.from_name("toolbox-outputs", create_if_missing=True)


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "toolbox-whisper/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        with open(dest, "wb") as f:
            f.write(r.read())


def _result(**kw) -> None:
    print("RESULT_JSON:" + json.dumps(kw), flush=True)


@app.function(image=image, gpu="T4", timeout=1800)
def transcribe(payload_json: str) -> None:
    from faster_whisper import WhisperModel

    t0 = time.time()
    payload = json.loads(payload_json)
    model_name = payload.get("model", "large-v3")
    audio_path = "/tmp/audio-input"
    _download(payload["audio_url"], audio_path)
    model = WhisperModel(model_name, device="cuda", compute_type="float16")
    segments, info = model.transcribe(audio_path, beam_size=5)
    text_parts = []
    seg_list = []
    for seg in segments:
        text_parts.append(seg.text)
        seg_list.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text})
    _result(
        text=" ".join(text_parts).strip(),
        segments=seg_list,
        language=info.language,
        gpu_minutes=round((time.time() - t0) / 60, 2),
    )


@app.function(image=image, gpu="T4", timeout=3600)
def transcribe_batch(payload_json: str) -> None:
    from faster_whisper import WhisperModel

    t0 = time.time()
    payload = json.loads(payload_json)
    model_name = payload.get("model", "base")
    urls = payload["audio_urls"]
    model = WhisperModel(model_name, device="cuda", compute_type="float16")
    results = []
    for i, url in enumerate(urls):
        audio_path = f"/tmp/audio-{i}"
        _download(url, audio_path)
        segments, info = model.transcribe(audio_path, beam_size=5)
        text = " ".join(s.text for s in segments).strip()
        results.append({"audio_url": url, "text": text, "language": info.language})
    _result(results=results, gpu_minutes=round((time.time() - t0) / 60, 2))
