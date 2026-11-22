# Free AI Alternatives — Research Notes (2026-10-19)

Researched via web on 2026-10-19; commercial-use column re-verified 2026-10-20.
Free tiers change often — re-verify at deploy time. Rule from SPEC §22: never
assume unlimited free quota, never auto-switch to paid, verify commercial-use
licence before publishing affiliate content.

## 2026-10-21 update — Hugging Face is no longer free for free accounts

Verified live on **huggingface.co/docs** (Pricing and Billing) 2026-10-21:

- **Free accounts get NO included Inference Providers credits.** The docs table
  reads: Free Users → `None` ("yes (credits purchase required)"); PRO →
  `$2.00`/mo; Team/Enterprise → `$2.00` per seat.
- The old "Inference API (serverless)" is now the **`hf-inference` provider
  inside Inference Providers**, billed per compute-second of GPU time — from
  the first request on a free account.
- The legacy `api-inference.huggingface.co` endpoint is retired
  (HF migration doc: requests return 410/404; use `router.huggingface.co/hf-inference`).

**Consequences applied in code the same day** (`src/lib/providers/`):

- `hf-inference.ts` default endpoint → `https://router.huggingface.co/hf-inference/models`;
  402 now returns a typed non-retryable `billing` error.
- Router preference order changed so genuinely-free providers lead; all chains
  keep 4 links (user requirement). New order in `router.ts`:
  - script: `groq → gemini → pollinations → hf`
  - image: `pollinations → pollinations-turbo → hf → hf-sdxl`
  - tts: `edge-tts → hf → pollinations-tts → espeak` (unchanged)
- Honest read: the HF legs only help if the user later adds credits or PRO
  ($2/mo). Without that, they fail fast and the chain falls through — the
  system still works, just without HF. Quota risk #1 (40–50 videos/month on
  free tiers) is now carried by Groq (~1K req/day) + Gemini (~500 req/day) +
  Pollinations (best-effort) + edge-tts + local FFmpeg/espeak.

## Fallback chains (as built in `src/lib/providers/router.ts`)

| Capability | Chain (in order) | Notes |
|---|---|---|
| script (LLM) | groq → gemini → pollinations → hf | 4 deep; hf last (billed on free accounts) |
| image | pollinations (flux) → pollinations-turbo → hf (FLUX.1-schnell, billed) → hf-sdxl (billed) | 4 deep (model variants); hf legs last |
| tts | edge-tts → hf → pollinations-tts → espeak | 4 deep |
| video | hf-spaces-video (exp) → pollinations-video (exp) → ffmpeg | 3 deep — no 4th automatable free video API exists |

## Provider details

| Provider | Capability | Free tier (as researched) | Key needed | Commercial use |
|---|---|---|---|---|
| Hugging Face Inference | text/image/tts | **NOT free for free accounts** (verified 2026-10-21 on huggingface.co/docs): no included Inference Providers credits; billed per compute-second from the first call. PRO ($9/mo) gets $2/mo credits. Kept as LAST chain link — works with credits/PRO | HF_TOKEN (user has) + credits/PRO to actually work | Verify terms at deploy |
| Pollinations.ai | text/image/tts/video | No signup; ~1.5 Pollen/week free, 1 req/15s anon; tightening | None | Platform free/open-source; commercial rights depend on the underlying model — re-check model at deploy. Chain models used here (FLUX.1-schnell Apache-2.0, SDXL Open RAIL-M, Wan2.1 Apache-2.0) are commercially permissive |
| Groq | text | ~30 RPM, ~1K req/day, no card | GROQ_API_KEY (free) | Commercial use allowed on free tier (guide 2026-10-13 citing Groq's own data); confirm at deploy |
| Google Gemini | text | Rate-limited Flash models, no card | GEMINI_API_KEY (AI Studio, free) | Free tier permits commercial use; **caveats:** free-tier inputs may be used by Google for product improvement (nothing sensitive — ad scripts only); since 2026 keys are billing-tied, treat as secrets |
| Edge TTS | tts | Free, unlimited-ish, no key | None | Widely used; verify at deploy |
| espeak-ng | tts | Free, local, always available | None (apt install) | Free software; robotic quality, last resort |
| HF Spaces video | video | Free Spaces, queues | HF_TOKEN + opt-in flag | Experimental; Spaces can vanish |
| FFmpeg | video | Free, local, always available | None | Reliable default |

## Standing source — free-for-dev (added 2026-11-12)

`github.com/ripienaar/free-for-dev` (142K stars, community list since
2015) is the standing hunting ground for the weekly free-AI sweep
(Sundays ~09:10 IST, cron `weekly-free-ai-research`): the sweep checks
its sections for newly added or changed free tiers and verifies each
candidate on the provider's OWN pricing page before reporting it.

Sections that matter to this setup (verified 2026-11-12):

- **Storage and Media Processing** — Cloudflare R2 10 GB free, Backblaze
  B2 10 GB free, Filebase 5 GB free, Oracle Object Storage 10 GB free
  (already in the Oracle free tier).
- **Generative AI** — new free model/API candidates for the sweep.
- **Email, Monitoring, Web Hosting** — supporting services.

Honest limits (same as the rest of this file):

- Entries go STALE — HF free inference, LLM7 R1 and the Groq catalog all
  changed under us. Nothing from this list is adopted on the list's word
  alone; every candidate is live-verified on its own pricing page first.
- R2/B2 10 GB ≈ 1 month of video output (12–22 GB/mo) — they never
  solved the archive problem on their own. The user's own 5TB Drive +
  1TB Google One (rclone archive plan, 2026-11-12) supersedes them for
  archive. The S3 lane (`STORAGE_BACKEND=s3`) is still the publishing
  store option — see `docs/floci-s3-testing.md`.

## Explicitly REJECTED (not free-for-commercial-use)

- **Cohere trial key** — non-commercial use only.
- **ElevenLabs free tier** — no commercial licence.
- **Vheer free plan** — personal use only (commercial needs Premium).
- **Browser-only video tools** (FlatAI, Vider, Pixelbin, FreeCreate) — no API,
  not automatable; watermarks/daily caps make them unusable for 40–50 videos/month.

## Honest limits

- **Hugging Face is out of the free pool** (2026-10-21): free accounts get no
  Inference Providers credits, so the HF legs only fire with credits/PRO.
  The free stack is now Groq + Gemini + Pollinations + edge-tts + local
  FFmpeg/espeak. Pollinations is best-effort and its free scope is shrinking —
  it leads the image chain only because nothing else free remains; treat it
  as a fallback that happens to be first, and watch its quota.
- Groq/Gemini free tiers are per-account and can change without notice; the
  circuit breaker + quota records exist for exactly this.
- Video has only 3 automatable free options; FFmpeg remains the reliable default.
- Re-verify every row before Phase 9 (end-to-end test).
