# Free Provider Adapters

All adapters live in `src/lib/providers/` (one file per provider) and are
coordinated by `router.ts`. The canonical registry is `src/lib/providers.ts`
(`PROVIDER_REGISTRY`); the router adds runtime status on top of it.

**Design principles**
- Every adapter returns typed results (`ProviderResult<T>` in `types.ts`):
  real output is marked `simulated: false`; failures are typed errors with a
  `code`, `retryable` flag, and suggested `fallback`. Output is **never
  fabricated**.
- Secrets come only from env vars and are never logged or echoed.
- The router never sends a task to a provider that lacks the capability.

## Capability map (free stack)

Failover is automatic: `attemptWithFallback()` (`fallback.ts`) walks the
chain in order — one provider stops, the next is tried. A provider that
fails 3 times inside 30 minutes has its circuit opened for 1 hour
(`recordProviderSuccess` / `recordProviderFailure` in `router.ts`), so a
dead provider is skipped instead of retried on every scene.

| Task | Chain (preference order) |
|---|---|
| script (LLM) | `groq` → `gemini` → `pollinations` (text) → `hf` (billed; see below) |
| image | `pollinations` (FLUX) → `pollinations-turbo` → `hf` (FLUX.1-schnell, billed) → `hf-sdxl` (billed) |
| tts | `edge-tts` (hi-IN-SwaraNeural) → `hf` (facebook/mms-tts-hin, billed) → `pollinations-tts` → `espeak` (local, robotic, last resort) |
| video | `hf-spaces-video` (experimental, gated) → `pollinations-video` (experimental) → `ffmpeg` (Tier B, always available) |

> **2026-10-21 change:** Hugging Face legs moved to the end of each chain.
> HF's own docs (verified live 2026-10-21) state free accounts get **no
> included Inference Providers credits** — calls are billed per compute-second
> from the first request — and the legacy `api-inference.huggingface.co`
> endpoint is retired in favour of `router.huggingface.co/hf-inference`.
> The adapters were re-pointed and 402 responses now surface a typed
> `billing` error so the chain falls through honestly. HF still works with
> PRO ($2/mo credits) or purchased credits; genuinely-free providers lead.

## Adapters

### 1. `hf-inference.ts` — Hugging Face Inference Providers (billed on free accounts)
- **Key:** `hf` · **Needs:** `HF_TOKEN` **plus** credits — a free-account token alone
  is not enough (verified on huggingface.co/docs 2026-10-21: free accounts get
  no included Inference Providers credits; PRO gets $2/mo).
- **Does:** `generateText(model, prompt)` (default `Qwen/Qwen2.5-7B-Instruct`),
  `generateImage(prompt)` (default `black-forest-labs/FLUX.1-schnell` → image bytes),
  `textToSpeech(text, lang)` (tries `facebook/mms-tts-hin`, then `facebook/mms-tts-eng`).
  Endpoint: `https://router.huggingface.co/hf-inference/models/{model}` (the legacy
  `api-inference.huggingface.co` endpoint is retired; overridable via
  `HF_INFERENCE_BASE_URL`).
- **Billing:** billed per compute-second past included credits (if any). On a free
  account every call fails with a billing error — the router therefore tries this
  provider LAST, and 402 surfaces a typed non-retryable `billing` error (never fake output).
- **Failure modes:** 429 → bounded exponential backoff (3 retries, jitter);
  repeated 429s return typed `rate_limited` (never fake output). Timeouts and
  5xx are `retryable`; 404/410 (unknown model / retired endpoint) is `unavailable`;
  402 is `billing` (non-retryable, falls through the chain). TTS falls back to
  `edge-tts` first in chain order; images fall back to `pollinations`.
- **Tested:** code paths reviewed + `tsc` clean. NOT tested live in this
  sandbox: `HF_TOKEN` is unset here and the sandbox blocks outbound inference
  calls. Live validation needs a deploy-time token **with credits**.

### 2. `pollinations.ts` — Pollinations.ai images + text
- **Key:** `pollinations` · **Needs:** nothing (no key, no login)
- **Does:** `generateImage(prompt, width, height)` via
  `https://image.pollinations.ai/prompt/...?nologo=true&model=flux`, and
  `generateText(prompt, maxTokens, temperature)` via the free OpenAI-compatible
  endpoint `https://text.pollinations.ai/openai` (script fallback when HF is down).
- **Free-tier limits:** none published — community-run, best-effort. Can be
  slow or rate-limit under load.
- **Failure modes:** validates `content-type: image/*`; retries 3× with
  backoff; returns `unavailable` (retryable, fallback `hf`) instead of a
  placeholder.
- **Tested live:** one 256×256 FLUX image request succeeded (9,769 bytes,
  valid image content-type).

### 3. `edge-tts.ts` — Microsoft Edge TTS
- **Key:** `edge-tts` · **Needs:** `edge-tts` npm package (installed), no API key
- **Does:** `synthesize(text, voice?)` → MP3 buffer. Default voice
  `hi-IN-SwaraNeural` (override via `EDGE_TTS_VOICE`); rate/pitch/volume via
  `EDGE_TTS_RATE` / `EDGE_TTS_PITCH` / `EDGE_TTS_VOLUME`.
- **Free-tier limits:** unofficial endpoint — no published quota; can throttle
  or change without notice.
- **Failure modes:** missing npm package → `dependency_missing`; empty audio →
  `upstream_error`; all failures suggest fallback `hf` (MMS-TTS). 90s timeout.
- **Tested:** package loads, API surface correct, Hindi voice list filter works.
  Live synthesis NOT completed in this sandbox: the package's WebSocket client
  does not honor the sandbox egress proxy (TLS EPROTO); plain-HTTPS `curl` to
  `speech.platform.bing.com:443` succeeds, so synthesis is expected to work on
  a normal deploy target. Re-test at deploy time.

### 4. `ffmpeg-motion.ts` — Tier B cinematic motion (default video path)
- **Key:** `ffmpeg` · **Needs:** `ffmpeg` + `ffprobe` on PATH (local)
- **Does:** `animateImage(inputPath, {motion, durationSec, width:1080,
  height:1920})` → H.264/yuv420p MP4 (no audio; audio is muxed later).
  Motions: `zoom_in` (dolly-in), `zoom_out`, `pan_left`, `pan_right`, `static`,
  plus an optional drifting light-sweep band (`lightSweep: true`).
- **Free-tier limits:** none — local CPU rendering. Cost is render time.
- **Failure modes:** missing input → `invalid_input`; missing binary →
  `dependency_missing`; render/timeout errors → typed errors (retryable).
  Output is **verified with ffprobe** (resolution + duration) before success.
- **Tested live:** all 5 motions (`zoom_in`, `zoom_out`, `pan_left`,
  `pan_right`, `static`) rendered 1080x1920 MP4s; ffprobe verified
  1080x1920 / 3.00s / 90 frames / h264; extracted frames at 0.2s and 2.5s
  differ (real motion, not frozen). Light-sweep overlay renders.

### 5. `hf-spaces-video.ts` — Tier A experimental image-to-video
- **Key:** `hf-spaces-video` · **Needs:** `HF_SPACES_VIDEO_ENABLED=true`,
  `pip install gradio-client` for python3
- **Does:** `generateVideo({imagePath, prompt})` → calls a public Gradio Space
  (default `Lightricks/LTX-Video`, override `HF_SPACE_ID`) through the Python
  bridge `hf_spaces_bridge.py` (resolved via `HF_SPACES_BRIDGE_PATH`,
  `<cwd>/src/lib/providers/hf_spaces_bridge.py`, or next to the module).
- **Free-tier limits:** none guaranteed — unofficial use of someone else's
  Space: queues, API changes, or removal at any time.
- **Failure modes:** **any** failure (disabled, missing bridge, missing
  gradio_client, queue timeout, bad Space output) returns a typed error with
  `fallback: "ffmpeg"`. Strict timeout (default 120s, `HF_SPACES_TIMEOUT_SEC`).
  Every success is labeled `experimental: true` and must be verified downstream.
- **Per-Space tuning:** Spaces differ in `predict()` signature — set
  `HF_SPACE_API_NAME` and `HF_SPACE_EXTRA_ARGS_JSON` per Space.
- **Tested:** disabled path returns `not_configured` + `fallback: "ffmpeg"` +
  `experimental: true` (no network touched); enabled path without
  `gradio_client` returns `dependency_missing` with the pip install hint.
  The bridge's live Space call was NOT run (no `gradio_client` in sandbox,
  and Spaces are queue-bound) — validate per-Space at deploy time.

### 6. `espeak-tts.ts` — espeak-ng local TTS (last resort)
- **Key:** `espeak` · **Needs:** `espeak-ng` (or legacy `espeak`) binary on the
  host/VM (`sudo apt install espeak-ng`)
- **Does:** `synthesize(text, voice, rateWpm)` → WAV bytes via `--stdout`.
  Tries the requested voice (default `hi`), falls back to the engine default
  voice if that voice is missing.
- **Honesty:** robotic quality — always labeled `espeak` in the audioProvider
  field so QC and the user can see exactly which voice produced the audio.
  Empty text is refused (`invalid_input`), never synthesized as silence.
- **Tested:** `dependency_missing` path verified where no binary is installed
  (this sandbox). Live synthesis needs the binary — install at deploy time.

### 7. `router.ts` — capability-aware routing with circuit breaker
- Exposes `getProviderStatus()` (honest `configured` / `unconfigured` /
  `rate_limited` / `circuit_open` / `experimental` per provider — env +
  dependency checks only, no fake "connected"), `providersForTask(task)`,
  and `pickProvider(task)`.
- `markRateLimited(key)` lets adapters feed 429 observations back; the signal
  expires after 10 minutes.
- Circuit breaker: `recordProviderSuccess(key)` /
  `recordProviderFailure(key)`; 3 consecutive failures inside 30 minutes
  open the circuit for 1 hour (`isCircuitOpen`), and `providersForTask`
  skips open providers. `resetProviderCircuit(key)` for tests/admin recovery.

### 8. `fallback.ts` — automatic failover runner
- `attemptWithFallback(task, attempt, providers?)` walks the router's usable
  providers in preference order until one succeeds; every attempt is recorded
  with the circuit breaker. All-fail → typed `unavailable` error listing each
  provider's message (never fabricated output). Optional provider override
  for tests.

## Adding a new provider
1. Create `src/lib/providers/<key>.ts` returning `ProviderResult<T>`.
2. Register it in `PROVIDER_REGISTRY` (`src/lib/providers.ts`) with honest
   `requiredEnv`, `kind`, and `commercialUseNotes`.
3. Add its API host (or local probe) to the providers test route.
4. Add env vars to `.env.example` and a section to this file.
