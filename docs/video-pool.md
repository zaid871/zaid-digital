# Video Pool — combined free video generation

Built 2026-11-01. The video stage no longer walks a fixed 3-link chain; it
rotates across a **pool** of free endpoints so no single one gets hammered
(and flagged).

## The pool (in selection order)

| # | Endpoint | Kind | Quota | Notes |
|---|----------|------|-------|-------|
| 1 | HF Spaces in `HF_SPACES_VIDEO_POOL` | AI diffusion (Wan2.1-I2V-14B, LTX-Video, FramePack…) | 5 GPU-min/day free (caller-charged) | Own ZeroGPU Spaces once created; public Spaces work too |
| 2 | Pollinations models in `POLLINATIONS_VIDEO_MODELS` | AI video (`wan`, `ltx-2`) | Pollen credits / best-effort | Keyless |
| 3 | Remotion code-motion (`REMOTION_ENABLED=true`) | Code (Ken Burns + title card) | **None** — on-VM CPU | Deterministic, never hallucinates |
| 4 | FFmpeg motion | Code (zoom/pan/light-sweep) | **None** | Always last, always works |

Comparison scenes skip the pool (split-screen wipe is an FFmpeg
composition, not a diffusion clip) — unchanged behavior.

## How rotation works (`src/lib/providers/video-pool.ts`)

- **Least-recently-used** among eligible endpoints (never-used first).
- **Cooldown**: `VIDEO_POOL_COOLDOWN_SEC` (default 300) rest after each use.
- **Failure backoff**: `VIDEO_POOL_MAX_FAILS` (default 3) consecutive
  failures → `VIDEO_POOL_FAIL_BACKOFF_MIN` (default 30) minutes backoff.
  Success resets immediately.
- **ZeroGPU ledger** (`storage/video-pool/ledger.json`): estimated GPU
  minutes per day (wall-clock of the bridge call — conservative; HF is the
  source of truth). When `ZERO_GPU_DAILY_MINUTES` (default 5) is spent,
  Spaces endpoints are hidden until the 24h window rolls over. Fail-safe:
  we may UNDER-use quota, never over.
- The recorded `videoProvider` on every scene always names what ACTUALLY
  produced the clip (`spaces:<id>`, `pollinations:<model>`, `remotion`,
  `ffmpeg`) — never mislabeled.

## What "combine everything" honestly means

- **Own Spaces (2 max on free HF)**: recommended = Wan2.1-I2V-14B +
  LTX-Video. Duplicate a public Space → Settings → Hardware → ZeroGPU.
  Needs verified email + 30-day-old account (ours unlocks ~mid-Nov 2026).
- **FramePack**: fits as a *public* Space entry in the pool (only 2 own
  Spaces allowed) — or swaps in for LTX later.
- **Remotion**: runs inside the backend container on the Oracle VM. Needs
  `remotion`, `@remotion/renderer`, `@remotion/bundler` (installed) + a
  Chrome/Chromium binary at deploy (`npx remotion browser ensure` or
  `REMOTION_CHROME_PATH`). Missing pieces → typed `dependency_missing`,
  falls through to FFmpeg. Never crashes the job.
- **NOT free-sustained** (rejected for the pool): Wan 3.0 (closed, paid),
  Kling/Runway APIs (paid), Pixazo (trial + card), JSON2Video (one-time
  trial). "Free API hubs" for Runway etc. are untrusted — never paste keys
  there.

## Realistic throughput (free)

- AI diffusion footage: ~5–15 min/month (the 5 GPU-min/day quota is the
  hard ceiling; rotation spreads load but does NOT multiply quota).
- Finished videos: 40–50/month is fine — Remotion/FFmpeg tiers are
  quota-free; only VM CPU binds (~10–25 render-hours/month).
- Practical pattern: 1–2 AI scenes per video, rest code-motion — every
  video gets an AI touch without ever exhausting quota mid-month.

## Deploy checklist additions

1. Create the 2 ZeroGPU Spaces (browser, ~10 min each, after mid-Nov 2026);
   set `HF_SPACES_VIDEO_ENABLED=true` + `HF_SPACES_VIDEO_POOL=<id1>,<id2>`.
2. Backend image: install a Chrome binary for Remotion
   (Dockerfile: `npx remotion browser ensure` equivalent or apt chromium);
   set `REMOTION_ENABLED=true`.
3. `gradio-client` python package (existing Tier A requirement, unchanged).
4. First week: measure actual GPU-sec/clip and adjust
   `ZERO_GPU_DAILY_MINUTES` / per-Space expectations.

## Verification status

- `scripts/test-video-pool.ts`: 27/27 (env parsing, LRU, cooldown,
  backoff, ledger incl. 24h rollover + corrupt-ledger fail-safe).
- `scripts/test-remotion-motion.ts`: 13/13 (gating, props, typed
  fall-through when disabled/deps missing).
- `tsc --noEmit`: clean. `eslint`: clean. `next build`: green.
- Live Remotion render: VERIFIED in sandbox 2026-11-01 — real 2s 1080x1920
  H.264 via the actual `renderCodeMotion` path (dynamic @remotion/bundler +
  chrome-headless-shell); ffprobe-confirmed 1080x1920@30, title card +
  accent bar visually confirmed in extracted frame
  (`~/workspace/remotion-frame.png`). Re-verify on the deploy VM (its
  Chrome install differs) before relying on the tier.
