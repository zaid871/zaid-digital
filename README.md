# AI Product-to-Video Automation Platform

Submit a **product URL** → get a researched, compliant, **9:16 vertical MP4**
(1080×1920, 30fps) with natural Hinglish voiceover, synchronized
captions, no price displayed, and no music. Built for Instagram Reels,
Facebook Reels, and YouTube Shorts.

**Docs:** [DEPLOY.md](DEPLOY.md) (cloud VM setup) · [OPS.md](OPS.md)
(backups, retention, troubleshooting) · [PROVIDERS.md](PROVIDERS.md)
(provider registry & free-tier notes)

## Architecture

```
Product URL
  │  POST /api/v1/jobs  (validated, SSRF-guarded)
  ▼
Next.js API ──► Postgres (Job + 15 JobStage rows + JobEvents)
  │                 ▲ persisted — survives restarts
  ▼ enqueue
BullMQ ──► worker (src/worker.ts)
  │  1-6   research:    extraction → evidence → identity → compliance
  │  7-12  creative:    plan → Hinglish script → voiceover → storyboard
  │                     → AI visuals → AI video (two-tier)
  │  13    render:      FFmpeg 1080×1920@30, loudnorm audio, burned-in captions
  │  14    QA:          technical (ffprobe/blackdetect/freeze) + content checks
  │  15    delivery:    verified final.mp4, download URLs
  ▼
final.mp4 + captions.srt/vtt  (local ASSETS_DIR or S3-compatible)
```

All AI inference is remote (cloud APIs) — nothing runs on the user's
machine. Rendering runs on the cloud worker (CPU FFmpeg, no GPU needed).

## The 15 pipeline stages

Every job persists one row per stage; progress in the UI comes from the
database, never from a fake animation.

| # | Stage | What happens |
|---|---|---|
| 1 | URL validation | SSRF guard, normalization, redirect checks |
| 2 | Product extraction | Structured data, specs, images (no paywall/CAPTCHA bypass) |
| 3 | Product research | Supplementary evidence from permitted sources |
| 4 | Fact verification | VERIFIED vs UNVERIFIED vs AI-INFERENCE classification |
| 5 | Media analysis | Vision analysis of product imagery |
| 6 | Compliance review | Shariah filter: APPROVED / NEEDS_REVIEW / REJECTED (no music, no fake claims, no prices) |
| 7 | Creative planning | Audience, hook, narrative, CTA |
| 8 | Script generation | Natural Hinglish narration, evidence-linked claims |
| 9 | Voiceover generation | TTS (edge-tts → HF fallback), normalized audio |
| 10 | Storyboard generation | Per-scene plan: narration, text, camera, captions |
| 11 | AI visual generation | FLUX.1-schnell product images (HF free tier) |
| 12 | AI video generation | Two-tier: **A** experimental HF Spaces diffusion → **B** FFmpeg cinematic motion (default) |
| 13 | Editing and rendering | Concat, 2.5s end-card, loudnorm, burned-in captions, `+faststart` MP4 |
| 14 | Quality assurance | 16 checks → PASS / PASS_WITH_WARNINGS / NEEDS_REVIEW / FAILED |
| 15 | Final delivery | Stored + verified `final.mp4`, download URLs |

## Providers (free-tier stack, $0)

| Capability | Primary (free) | Fallback | Notes |
|---|---|---|---|
| LLM (script/research) | Hugging Face Inference (`HF_TOKEN`, free, no card) | — | Rate-limited; cold starts |
| Image generation | HF FLUX.1-schnell | Pollinations.ai (no key, best-effort) | Product-identity prompts |
| TTS (Hindi/Hinglish) | edge-tts (`hi-IN-SwaraNeural`) | HF MMS-TTS Hindi | edge-tts is unofficial — typed errors, never silent |
| Video motion | **Tier B:** FFmpeg zoom/pan/light-sweeps (deterministic) | **Tier A (experimental):** HF Spaces diffusion via `gradio_client` | Tier A needs python3 + `gradio-client`, off by default |
| STT / captions | ffprobe + generated SRT→VTT | — | Captions burned in via ASS with explicit 1080×1920 PlayRes |

Paid adapters (OpenAI, Anthropic, ElevenLabs, fal.ai, Replicate) exist in
the registry as **opt-in fallbacks** behind per-job budget caps — the
default path spends $0 and reports paid providers honestly as
*unconfigured* until keys are added. Full matrix: [PROVIDERS.md](PROVIDERS.md).

## Quick start (local dev)

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env — at minimum DATABASE_URL and REDIS_URL.
# For the free AI stack, add HF_TOKEN from https://huggingface.co/settings/tokens

# 3. Start Postgres + Redis (pick ONE)
docker compose up -d postgres redis   # needs Docker; uses the compose file in this repo
# — or, on Debian/Ubuntu without Docker —
sudo apt-get update && sudo apt-get install -y postgresql redis-server
sudo service postgresql start && sudo service redis-server start

# 4. Database
npm run db:generate
npm run db:migrate

# 5. Run (two terminals)
npm run dev        # app at http://localhost:3000
npm run worker     # BullMQ worker: tsx src/worker.ts
```

> Without Postgres/Redis the API still builds, but job creation returns
> `500` (DB) or an `enqueueWarning` (Redis). The health of each dependency
> is reported by `GET /api/v1/health`.

## Production deploy

```bash
cp .env.production.example .env   # fill in secrets (see DEPLOY.md)
docker compose up -d --build
docker compose run --rm app npx prisma migrate deploy
```

Full step-by-step (VM sizing, DNS, HTTPS via Caddy, firewall, n8n import):
**[DEPLOY.md](DEPLOY.md)**. Day-2 operations (backups, retention, upgrades,
troubleshooting): **[OPS.md](OPS.md)**.

## n8n webhook contract

The backend can trigger n8n, and n8n can report stage progress back.

**Backend → n8n:** set `N8N_WEBHOOK_URL` (default
`http://localhost:5678/webhook/product-video/job`). The importable
workflows live in `n8n/workflows/`.

**n8n → backend (stage callbacks):** `POST /api/v1/jobs/:id/stage-callback`

| Item | Contract |
|---|---|
| Header | `x-n8n-secret: <N8N_WEBHOOK_SECRET>` — required when the secret is set (constant-time compare); optional when `N8N_WEBHOOK_SECRET` is unset (dev convenience only — always set it in production; unauthenticated callbacks are flagged with a warning JobEvent) |
| Body | `{ stageKey, status, progressPct?, message?, warnings?, errorCode?, errorMessage? }` |
| `status` values | `pending` `running` `succeeded` `failed` `skipped` `waiting_review` |
| Auth unset | Callbacks are accepted without the header and a `n8n_callback_unauthenticated` warning event is recorded |
| Effects | Updates the stage row, derives the job-level status from the stage, records JobEvents; a `failed` callback moves the job to `FAILED`; when all 15 stages are `succeeded` the job moves to `COMPLETED` |

## API (v1)

All responses use a versioned envelope:

```json
{ "ok": true, "apiVersion": "v1", "requestId": "…", "data": { … } }
```

| Method & path | Purpose |
|---|---|
| `POST /api/v1/jobs` | Create generation job |
| `GET /api/v1/jobs` | List jobs (paginated) |
| `GET /api/v1/jobs/:id` | Job status + 15 stage states |
| `POST /api/v1/jobs/:id/cancel` | Request cancellation |
| `POST /api/v1/jobs/:id/retry` | Retry eligible failures |
| `GET /api/v1/jobs/:id/result` | Final output metadata |
| `GET /api/v1/jobs/:id/assets` | Job assets |
| `GET /api/v1/jobs/:id/download?key=…` | Download a stored file (traversal-safe) |
| `POST /api/v1/jobs/:id/stage-callback` | n8n stage progress callback |
| `GET /api/v1/providers` | Provider configuration status |
| `POST /api/v1/providers/:provider/test` | Test provider connectivity |
| `GET /api/v1/usage` | Usage & cost records |
| `GET /api/v1/health` | Health check (app + postgres + redis) |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Apply Prisma migrations (dev) |
| `npm run db:deploy` | Apply Prisma migrations (production) |
| `npm run db:studio` | Prisma Studio DB browser |
| `npm run worker` | Background worker |

## Project layout

```
src/app/            pages: dashboard (/), jobs/[id], providers, usage
src/app/api/v1/     versioned route handlers
src/lib/            db, queue, providers, pipeline/*, schemas, compliance, storage
src/lib/pipeline/   creative → voice → visuals → video → render → qa → delivery
src/components/ui/  minimal shadcn-style primitives
prisma/             schema.prisma (21 models) + migrations
n8n/workflows/      main-workflow.json, error-workflow.json
docker/             Dockerfile.app, Dockerfile.worker, Caddyfile, postgres-init.sql
scripts/            cleanup-assets.sh (retention cron)
```

## Security notes

- Secrets only in `.env` / n8n credential store — never committed, never in API responses or logs (see `redactSecrets` in `src/lib/envelope.ts`).
- Product-URL validation blocks private/loopback hosts and cloud metadata endpoints (SSRF guard in `src/lib/schemas.ts`).
- Generated videos never show prices and never include music (enforced in compliance + QA).
- Compose publishes **only** 80/443 (proxy). Postgres, Redis, and n8n are internal-only; the n8n editor sits behind HTTP basic-auth.

## Build history

- **Phase 2:** scaffold — Next.js 16 + TS + Tailwind, 10 API routes, 21 Prisma models, n8n workflows, compose (tsc/lint/build green)
- **Phase 3:** real job tracking — DB-backed jobs, BullMQ worker, n8n callbacks, provider reachability
- **Phase 4:** product research, evidence verification, Shariah compliance module
- **Phase 5:** creative pipeline — Hinglish script, storyboard, edge-tts voiceover, HF/Pollinations visuals, two-tier video, SRT+VTT captions (19/19 tests green)
- **Phase 6:** render + QA + delivery — real 1080×1920 MP4s rendered and verified, 16 QA checks, traversal-safe storage
- **Phase 7:** production deploy — hardened Dockerfiles, Caddy HTTPS proxy, DEPLOY.md / OPS.md, retention cron, final verification
