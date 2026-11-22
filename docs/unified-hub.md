# Unified Hub — Combined Spec (2026-11-06)

> **BUILT 2026-11-06 (user: "ab tak humari jo baat hui un sb high possiblities ko shamil kr k wo api banao").**
> Combination level, user ke words me: **APIs ek gateway ke peeche merge hoti hain; models alag rehte hain; outputs ek Shared Power Pool (third place) me jama hote hain.**
> Built: `src/lib/hub/` (router, ensemble, pipeline, pool, sandbox, ledger, quota, engines, run) + endpoint `POST /api/v1/hub/run` (file: `src/app/api/v1/hub/run/route.ts` — route path `/api/v1/hub/run` hai, `/api/v1/hub` nahi) + `n8n/workflows/hub-run.json` + `scripts/hub-eval.ts` + `scripts/test-hub.ts` (**33/33 pass**, tsc/eslint/build green, endpoint live-tested on a local server: 422 validation, 200 no-keys honest fail, GET ledger 200).
> NOT live-tested with real keys yet: no GROQ/GEMINI key in this sandbox, so no real ensemble/sandbox-pass run has happened — `hub-eval.ts` deploy par chalana hai, usse pehle koi quality number claim nahi karna. Deploy precondition wahi hai: backend VM par nahi hai (sirf n8n), Phase 1 handover baaki, Docker socket + images chahiye sandbox ke liye.

One central hub on the Oracle VM that combines everything from the Dream Team
transcript into a single system the user can call from n8n, the dashboard, or
any client — with the PC off. No local-PC component. No weight merging.
No custom model upload to Groq.

## 1. Vision, in one line

**Ek hi endpoint, ek hi dimaag ka faisla, har kaam ka verified output:**
text/code, image, video, ebook, template, PDF/DOCX/PPTX — sab `POST /api/v1/hub/run`
se, aur har output deploy se pehle test/verify hoke nikle.

## 2. What this replaces (and why)

| Transcript idea | Verdict | Replacement in this hub |
|---|---|---|
| Sequential Brain → Builder → Critic | KEEP, as one mode | `mode: "pipeline"` — 3 Groq/Gemini calls, critic last, optional sandbox re-run |
| Parallel MoA (3 models at once + synthesizer) | KEEP, as one mode | `mode: "swarm"` — `Promise.all` over 3 models, then one synthesis call |
| "Unified energy" weight merge (DeepSeek-Llama + Qwen-Coder) | BLOCKED — cross-architecture merge is impossible (MergeKit needs same base + tokenizer); Groq takes no custom weights; vLLM needs a GPU, the VM is CPU-only | The hub *behaves* unified: one router picks the right model per token-budget/task, one call surface, one output. No fake merge. Same-family merge (e.g. DeepSeek-R1-Distill-Qwen + Qwen-Coder) is possible in theory but needs GPU hosting — out of scope, free-first rule. |
| Claude Desktop local MCP + local Python | BLOCKED as the home — dies when the PC is off | Hub lives on Oracle VM (Docker Compose). Claude Desktop, if used, talks to the hub over HTTPS, never to a local script. |
| Fal.ai / Replicate for image+video | PAID — rejected per free-first | Pollinations-first image chain + video pool (Spaces Wan2.1/LTX, Pollinations ltx-2, Remotion, FFmpeg). Same API surface, free providers underneath. |
| WeasyPrint ebook engine | DUPLICATE — ebook/PDF already built | Reuse `src/lib/digital/` (fpdf2 PDF, SVG/PNG templates). Only DOCX/PPTX are new. |

## 3. Architecture (Oracle VM, Docker Compose)

```
n8n workflows / dashboard / any HTTPS client
        │  x-n8n-secret, one URL
        ▼
┌──────────────────────────────────────────────────┐
│  HUB — backend API (Next.js, existing app)       │
│  POST /api/v1/hub/run                            │
│                                                  │
│  1. Router (task-aware, deterministic)           │
│     → picks mode + models from task type,        │
│       not from vibes. Env-overridable.           │
│  2. Brain layer (Groq → Gemini fallback)         │
│     → pipeline OR swarm, per request             │
│  3. Verification layer (the real edge)           │
│     → code: Docker-isolated sandbox + tests      │
│     → docs: compliance scan + render check       │
│     → video/image: QA checks from video platform │
│  4. Engine layer (already-built, reused)         │
│     → script/voice/captions: src/lib/pipeline/   │
│     → image: src/lib/providers/pollinations.ts   │
│     → video: src/lib/providers/video-pool.ts     │
│     → ebook/template/PDF: src/lib/digital/       │
│     → docs: NEW docx/pptx (python-docx,          │
│       python-pptx via existing pdf_bridge.py     │
│       pattern)                                   │
│  5. Ledger (PostgreSQL + storage/hub/ledger.json)│
│     → every run: task, models, tokens, cost $0,  │
│       verdict, retries, output paths             │
└──────────────────────────────────────────────────┘
        │                │                 │
   Postgres/Redis   storage/ (files)   HF Spaces (video GPU)
   (already in       (PDF/MP4/PNG)     (2 ZeroGPU Spaces,
    compose)                            5 GPU-min/day shared)
```

No new server, no new VM. The hub is a module + one endpoint inside the
existing backend, plus one optional LiteLLM container only if multi-provider
routing outgrows the in-code router (see §7).

> **CORRECTION 2026-11-06 (verified live, before any build):** the model
> IDs in the first draft of this spec are dead on Groq's current catalog.
> Checked against `console.groq.com/docs/models` and
> `console.groq.com/docs/rate-limits` (crawled 2026-11-06 ~11:00 IST):
> `deepseek-r1-distill-llama-70b` was retired 2025-10-02 and is not listed;
> `qwen/qwen3-32b` is gone (replaced by `qwen/qwen3.8-27b`, itself a Preview
> model); `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` were retired
> for free/developer tier on 2026-08-16 and are now Enterprise-only. The
> live Groq text models are `openai/gpt-oss-120b` (Production),
> `openai/gpt-oss-20b` (Production) and `qwen/qwen3.8-27b` (Preview) — each
> 30 RPM / 1,000 RPD / 8,000 TPM / 200,000 TPD on the Developer-plan base
> limits. §4 and §11 below now use only those IDs, plus Gemini Flash.
> The existing adapter's default (`src/lib/providers/groq.ts`,
> `llama-3.3-70b-versatile`) has the same problem and needs a one-line
> swap to `openai/gpt-oss-120b` (or `GROQ_MODEL` env) before deploy —
> NOT yet applied, untested, deploy-check required.

## 4. The router — the "unified" part

One request, one decision. The router reads `task.kind`, never the model name:

| `task.kind` | Mode | Brain (Groq, verified 2026-11-06 — see correction note at top) | Why |
|---|---|---|---|
| `code` / `automation` / `n8n-json` | pipeline | plan: `openai/gpt-oss-120b` (reasoning) → build: `qwen/qwen3.8-27b` (thinking mode, coding) → critic: `openai/gpt-oss-120b` | reasoning first, syntax second, review last |
| `reasoning` / `math` / `planning` | swarm | `openai/gpt-oss-120b` + `qwen/qwen3.8-27b` + `openai/gpt-oss-20b` in parallel → `openai/gpt-oss-120b` synthesis | 3 angles, one merged answer; costs 3x tokens — only when asked |
| `long-doc` / `research` | pipeline | Gemini 2.5 Flash (1M context route) → `openai/gpt-oss-120b` polish | context beats reasoning here |
| `chat` / `summary` / `caption` | single | `openai/gpt-oss-20b` (fast, 1000 tps) | no need to burn 3 models |
| `image` | engine | Pollinations FLUX.1-schnell → SDXL fallback | already built |
| `video` | engine | video-pool.ts (Spaces → Pollinations ltx-2 → Remotion → FFmpeg) | already built |
| `ebook` / `template` / `document` | engine | digital/ + Brain for text only | already built except docx/pptx |

Defaults: `mode: "ensemble"` for code/reasoning/planning (see §11 — all
eligible models fire in parallel, pause rule applies); `mode: "single"` only
for trivial chat/summary or when the quota budget is low. `mode: "pipeline"`
(sequential Brain → Builder → Critic) stays as a fallback mode for tasks
where synthesis needs a verified chain, not a vote.

Model IDs are **env-config, not hardcoded**: `HUB_PLAN_MODEL`,
`HUB_BUILD_MODEL`, `HUB_CRITIC_MODEL`, `HUB_SYNTH_MODEL`. At deploy, list
live IDs from console.groq.com/docs/models and set env. Never ship a model
ID that wasn't verified live.

## 5. API — one endpoint

`POST /api/v1/hub/run` — header `x-n8n-secret`, body:

```json
{
  "task": { "kind": "code", "prompt": "...", "mode": "pipeline" },
  "deliver": { "format": "code" },
  "limits": { "maxRetries": 2 }
}
```

`deliver.format`: `code` | `text` | `image` | `video` | `ebook-pdf` |
`template-pack` | `docx` | `pptx` | `pdf-report`.

Response (always):

```json
{
  "ok": true,
  "output": { "kind": "code", "text": "...", "files": ["storage/hub/..."] },
  "verification": { "sandbox": "passed", "tests": "3/3", "retriesUsed": 1 },
  "usage": { "models": ["..."], "tokens": 0, "costUsd": 0 },
  "ledgerId": "..."
}
```

Rules:
- Code is **never returned as "done" unless the sandbox ran it**. Fail →
  traceback goes back to the builder once per retry (max 2), then the run
  returns `ok: false, verification.sandbox: "failed"` with the real error.
  No fake success, ever.
- Every run writes a ledger row. No ledger row = the run didn't happen.
- Compliance scan (no music/SFX/price/fake claims, Shariah filter) runs on
  every text/caption/doc output, same as the existing pipeline.
- Quotas are enforced before the call, not after: Groq per-model
  rate limits + ZeroGPU 5 GPU-min/day ledger + Pollinations shrinking scope.
  On limit: typed `quota_exceeded`, never a silent fallback that pretends
  success.

## 6. Verification layer — why this beats a single big model

This is the only honest edge over Sonnet 5.5 / GPT-6 Astra, and it is
architectural, not model magic:

1. **Code runs.** A single model predicts code; the hub executes it.
   Prediction loses to execution every time — but only for code/tasks that
   can be executed. Novel abstract reasoning, native multimodality and 1M+
   stable context stay with the frontier models. No blanket "beat" claim.
2. **Docs render.** A PDF/DOCX is rendered and page-checked before delivery,
   not pasted as markdown.
3. **Video/image QA.** The existing 16-check QA + video-pool backoff apply.
4. **Live grounding.** A RAG/docs-fetch step runs before code generation when
   the task names a library/framework — latest docs in, hallucinated old
   syntax out.

No benchmark numbers are claimed here (no 98%, no 8–15s). The hub ships with
an eval script (`scripts/hub-eval.ts`): 10 fixed tasks from the user's real
work, run against `pipeline` vs `swarm` vs single-model, scored on
sandbox-pass + human check. Numbers come from that run, not from a chat.

## 7. LiteLLM — when, and when not

- **Phase 1: no LiteLLM.** The in-code router (Groq + Gemini clients already
  in `src/lib/providers/`) is enough and has zero extra moving parts.
- **Phase 2 (only if):** if a third provider is added, or n8n wants an
  OpenAI-compatible URL instead of the hub endpoint, add LiteLLM as one
  more container in the same `docker-compose.yml`, keys in `.env` only.
  LiteLLM is a router, not a brain — it does not merge models, it does not
  add verification, and it does not replace the sandbox.
- **Phase 2 — DONE 2026-11-16 without a LiteLLM container** (Astro K Joseph
  video "Build Your Own Private AI API Server in 10 Minutes ($0)":
  the transferable idea was the OpenAI-compatible API itself, not the
  local model or the paid VPS). `POST /api/v1/chat/completions`
  (`src/lib/hub/chat-compat.ts`) is a thin shim over runHub — models
  `hub` (ensemble) and `hub-fast` (single leg), Bearer key
  `CHAT_API_KEY` else `N8N_WEBHOOK_SECRET`, OpenAI-shaped responses.
  No new container, no new RAM. Limits: text only; `stream: true`
  arrives as one SSE chunk; `usage` is a chars/4 estimate. Tests
  `scripts/test-chat-compat.ts` 28/28 (fake caller). Doc:
  `docs/openai-compatible-api.md`. NOT live-tested (needs VM + keys).

## 8. What gets built, in order

1. **Hub core** — ✅ BUILT 2026-11-06: `src/lib/hub/router.ts`, `pipeline.ts`, `ensemble.ts` (Ensemble v2 fan-out + pause gates), `sandbox.ts` (Docker-isolated exec), `ledger.ts`, `pool.ts` (Shared Power Pool), `quota.ts`, `engines.ts`; endpoint `src/app/api/v1/hub/run/route.ts`. Tests: `scripts/test-hub.ts` 33/33 (router table, pause gates, pool, quota, compliance, sandbox-unavailable, no-keys honest fail, fake-caller ensemble run).
2. **Docx/pptx** — ✅ BUILT 2026-11-06 (earlier the same day): `src/lib/digital/docs.ts` via the `pdf_bridge.py` pattern; endpoints through the hub (`deliver.format: docx/pptx`). Ebook/template reuse `src/lib/digital/` unchanged.
3. **n8n wiring** — ✅ BUILT 2026-11-06: one workflow `n8n/workflows/hub-run.json`: webhook → validate (secret + kind/format) → `POST /api/v1/hub/run` (x-n8n-secret header) → respond with files/ledgerId. Statically validated (9 nodes, connections checked). NOT live-import-tested — deploy par n8n me import karna hai.
4. **Eval + ledger dashboard** — ✅ Eval BUILT 2026-11-06: `scripts/hub-eval.ts` (10 fixed real tasks, pipeline vs ensemble vs single). NOT RUN yet — needs GROQ/GEMINI keys on the VM; without keys it refuses (exit 1) instead of printing zeros. Ledger read endpoint: `GET /api/v1/hub/run` (same route file, newest 20 rows). Dashboard UI still open.

## 9. Deploy checklist (VM)

- Backend deploy is the precondition — today only n8n runs on the VM.
  Needs the Phase 1 handover (VM IP, SSH key, n8n URL+login) already asked.
- Env: `GROQ_API_KEY`, `GEMINI_API_KEY` (load-bearing), `HUB_*_MODEL`
  (live-verified IDs), `x-n8n-secret`, `HF_TOKEN` optional.
- Sandbox: Docker socket available to the app container, no host exec.
- No local-PC step exists in this plan. There is nothing to install on the PC.

## 10. Honest limits (kept, not hidden)

- No weight merge, no Groq custom-model upload, no GPU on the VM.
- Groq catalog moves fast: Llama + DeepSeek IDs in the first draft are
  already dead (see correction note at top). Re-check
  `console.groq.com/docs/models` at deploy; never hardcode a model ID.
  `qwen/qwen3.8-27b` is a Preview model — it may be discontinued at short
  notice, so the router must fall back to `openai/gpt-oss-120b` if it 404s.
- Swarm costs ~3x tokens; default is off.
- Frontier models still win on novel abstract reasoning, native
  audio+video+vision in one pass, and very large repos.
- Speed/cost wins are real (Groq LPU + $0 free tiers) but the hub's quality
  numbers must come from `scripts/hub-eval.ts` after it runs — not before.

## 11. Parallel Ensemble v2 — the user's vision (2026-11-06)

**Vision, as stated:** jab prompt aaye to *har* model ek hi waqt me involve
ho — koi model apna kaam khatam karke dusre ka intezar na karwaye; sab ki
thinking ek saath ho, phir unka combine response mile. Agar kisi model ka
usage kisi tarah nahi ban raha, ya dusra model usse behtar response de raha
hai, to wo pause ho jaye.

**What "har model" means, precisely.** A model only gets a slot if it *can*
contribute to that task. Capability is the pause rule, not preference:

| Prompt type | Plays in parallel | Paused by capability (automatic) |
|---|---|---|
| Code / reasoning / planning | All eligible text LLMs at once: Groq `openai/gpt-oss-120b`, Groq `openai/gpt-oss-20b`, Groq `qwen/qwen3.8-27b` (Preview), Gemini Flash | Image/video/TTS models — they cannot reason about code; Whisper (audio-in only) |
| Video generation | Visual lane in parallel: image model (Pollinations FLUX) makes the key frame + video pool (Spaces/Pollinations ltx-2) animates it, while text LLMs write script/caption/prompt in parallel | Code-sandbox lane, docx lane |
| Ebook / doc | Text LLMs write chapters in parallel (one per chapter or one per angle) + image model draws cover in parallel | Video pool, TTS |
| Voiceover / audio | TTS lane (edge-tts) + text LLMs for script in parallel | Video render lane (unless the request also asks for video) |

A video model never "reasons" about a Python bug and a TTS model never
"thinks" about an ebook chapter — giving them a text slot would burn quota
for zero contribution. Their parallel contribution is in *their own lane*,
at the same millisecond as the text lanes.

**How one run flows (no sequential chain):**

```
Prompt arrives
  │
  ├─ (0) Split (deterministic, <50ms, no LLM call): prompt → lanes
  │     reasoning / code / visual / voice / doc — only lanes the
  │     prompt actually asks for are opened.
  │
  ├─ (1) FAN-OUT — Promise.allSettled, same millisecond:
  │     every eligible model in every open lane fires at once.
  │     Nobody waits for anybody. Latency = slowest survivor,
  │     not the sum.
  │
  ├─ (2) LIVE GATE / PAUSE — per contribution, while running:
  │     • timeout: text lane cap 8s, visual/video lane cap per
  │       provider — slow model pauses, run does not wait.
  │     • empty / error / 429 → paused, logged, never blocks.
  │     • duplicate / low-confidence: synthesizer scores each
  │       contribution; if a second model adds nothing new, or
  │       scores clearly below the leader on the same section,
  │       it is paused out of the final merge (attempt still
  │       in the ledger).
  │     • capability miss: a model that cannot do the lane never
  │       gets the call in the first place (§11 table).
  │
  ├─ (3) SYNTHESIS — one call, only survivors in:
  │     merges the best section from each survivor, picks the
  │     best code verbatim (never re-writes working code),
  │     resolves contradictions by the higher-scored version.
  │     Synthesizer: openai/gpt-oss-120b (Groq) or Gemini Flash.
  │
  └─ (4) VERIFICATION — unchanged (§6): sandbox for code,
        render check for docs, QA for video/image, compliance
        scan for everything.
```

**Quota math (why the ensemble is capped at 4 text models, not 10).**
Groq Developer-plan base limits, verified 2026-11-06: each live text model
(`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) gets its
OWN allowance — 30 RPM / 1,000 RPD / 8,000 TPM / 200,000 TPD per model, not
one shared pool. So one ensemble prompt firing 3 different Groq models +
Gemini burns 1 request from each model's separate 1,000/day allowance, and
the binding constraint is 8,000 TPM per model, not requests. With 4 parallel
text calls the ensemble still caps at 4 (config `HUB_ENSEMBLE_MAX=4`,
env-overridable) because there are only 4 live text legs and TPM is tight
for long prompts; the cap is a budget rule, and every paused/over-budget
call is visible in the ledger — never silent.

**Difference from the old "swarm".** Swarm was 3 fixed models + synthesis,
opt-in. Ensemble v2 is the default for code/reasoning: *every eligible*
model, *every* open lane, *same* millisecond, with the pause gate deciding
who survives into the final answer. Sequential pipeline stays only as a
fallback mode, never the default path.
