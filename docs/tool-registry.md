# Tool Registry — design (2026-11-20)

Status: **DESIGN APPROVED + PHASE 1 BUILT 2026-11-20.** User said "pure add
kr de na re bhai" — everything buildable without accounts/keys is now in the
repo (see "Built 2026-11-20" at the end). No account created, no key taken.
Tools stay `candidate` until live-tested (§15) — code existing is not wiring.

This doc expands the 2026-11-17 summary into the full design. It mirrors the
Unified Hub (`docs/unified-hub.md`, built 2026-11-06, `src/lib/hub/`) — same
patterns, tools instead of models.

## 1. The distinction (user's correction, 2026-11-16)

NOT combining methods into one Frankenstein workflow. A **toolbox / control
plane**: many free tools collected in one place, routed by one brain.

What it gives:

- **Parallel throughput** — work split across tools runs at the same time.
- **Resilience** — one tool down / quota out, another picks the job up (the hub
  already does this for models: router + quota guard + ledger).
- **Sharded scale** — a big job split into pieces, each piece on a different
  worker, results joined back on the Oracle VM.

What it NEVER gives: one single job with 64 GB RAM / 48 GB VRAM / 24 h
continuous GPU. Pooling adds total throughput, not a bigger single machine.
16 GB + 16 GB never becomes one 32 GB machine; 30 h + 50 h becomes 80 h of
total throughput only if the work splits into pieces.

## 2. Architecture — 3 layers (hub pattern, tools instead of models)

```
n8n workflows / dashboard / any HTTPS client
        │  x-n8n-secret, one URL
        ▼
┌──────────────────────────────────────────────────────────────┐
│  TOOL REGISTRY — backend API (Next.js, existing app)         │
│  GET /api/v1/tools/registry  (read-only, phase 1)            │
│  POST /api/v1/tools/run      (dispatch, phase 2 — after pick)│
│                                                              │
│  1. Router — capability match, never a tool name.            │
│     Job names a capability (e.g. "gpu-video"); the router    │
│     picks the tool from the registry by status + quota.      │
│  2. Quota guard — checked BEFORE the call, never after.      │
│     Same rule as src/lib/hub/quota.ts: on limit the tool     │
│     pauses with typed `quota_exceeded`, never a silent       │
│     fallback that pretends success.                          │
│  3. Adapters — one per tool, same interface, different API   │
│     inside. A tool with no adapter cannot be routed to.      │
│  4. Ledger — every dispatch writes a row: tool, job,         │
│     verdict, quota used, duration. No ledger row = the       │
│     dispatch didn't happen.                                  │
└──────────────────────────────────────────────────────────────┘
        │                │                 │
   Postgres/Redis   storage/tools/    Adapters reach out to
   (queue, already  (registry.json,   GitHub / Cloudflare /
    in compose)      quota.json,       Kaggle / Modal / HF
                     ledger.jsonl)    Spaces / NIM / R2 …
```

No new server, no new VM. The registry is a module + endpoints inside the
existing backend, the same way the hub is a module + `POST /api/v1/hub/run`
inside the same app. The Oracle VM stays the only brain; tools are workers.

## 3. Registry schema (one entry per tool)

File: `storage/tool-registry.json` (phase 1). One entry per tool. Tool IDs
and keys are env config, never hardcoded into a call — same rule as hub
model IDs (`src/lib/hub/types.ts`: env overrides win, constants are only
defaults).

```ts
type ToolStatus = "candidate" | "wired" | "paused" | "dead";

type ToolCapability =
  | "text-llm"        // free text model legs (hub ensemble)
  | "gpu-video"       // AI video clips (Wan / LTX class)
  | "lora-train"      // small LoRA / fine-tune
  | "gpu-batch"       // GPU upscale, background removal, batch image work
  | "parallel-compute"// CPU batch: renders, ETL, transcription shards
  | "webhook-ingress" // light webhook filter + queue before the VM
  | "object-storage"  // finals / delivery storage
  | "db-backup"       // off-VM Postgres backup
  | "queue-backup"    // off-VM Redis / queue backup
  | "email"           // transactional email
  | "monitoring";     // uptime / heartbeat monitoring

interface ToolEntry {
  id: string;                    // stable id, e.g. "modal"
  displayName: string;
  capabilities: ToolCapability[];
  /** Verified numbers only — no marketing figure without a source date. */
  limits: Record<string, string>;
  /** Quota shape: numeric caps in `unit`; missing cap = no limit on that window. */
  quota: { perDay?: number; perWeek?: number; perMonth?: number; unit: string };
  /** Which code module implements the tool, or null when none exists yet. */
  adapter: string | null;
  /** When the free allowance ends or renews. */
  expiry: string;                // e.g. "credit-based, refills monthly"
  /** Next tool to try when this one pauses. Must itself be wired. */
  fallback: string | null;
  /** "$0 while free tier lasts" — paid legs are never the base. */
  cost: string;
  status: ToolStatus;
  /** Last live check. A tool is never a permanent leg on an old date. */
  lastVerified: string;          // YYYY-MM-DD
  /** How the key/secret reaches the VM — file method only, never chat. */
  secretEnv?: string;            // e.g. "MODAL_TOKEN" (name only, never value)
}
```

Field rules:

- `limits` holds only numbers verified live, with the check date in
  `lastVerified`. A limit copied from a blog without a date is not a limit.
- `status` lifecycle: `candidate` (in the doc, not wired) → `wired` (adapter
  live-tested, see §15) → `paused` (quota out / failing / withdrawn) →
  `dead` (free tier ended / ToS closed it). A `paused` tool keeps its
  fallback; a `dead` tool is removed from routing, never retried.
- `lastVerified` is re-checked by the weekly free-AI sweep (Sunday ~09:10
  IST, report-only). A tool whose `lastVerified` is older than 30 days is
  treated as `candidate` again until re-checked — free tiers rotate without
  notice (Nemotron `:free` withdrawn 2026-11-16; Pollinations `pk_` keys
  dead since 1 Nov 2026).
- Secrets: env names only in the registry. Values live in the VM `.env`
  (file method, user-sent file), never in chat, never in the repo, never in
  this doc.

Example entry (shape only — `modal` is still `candidate` until picked):

```json
{
  "id": "modal",
  "displayName": "Modal",
  "capabilities": ["gpu-video", "lora-train", "gpu-batch"],
  "limits": { "gpuHours": "~50h T4 / $30 credit", "a100Hours": "~14h A100 40GB / $30 credit", "sessionMaxH": 12 },
  "quota": { "perMonth": 30, "unit": "usd-credit" },
  "expiry": "credit-based, refills monthly",
  "fallback": "kaggle",
  "cost": "$0 while credit lasts; free tier only",
  "status": "candidate",
  "lastVerified": "2026-11-16",
  "secretEnv": "MODAL_TOKEN",
  "adapter": null
}
```

## 4. Tool catalog (verified 2026-11-16/17)

Base — already live, no new account needed:

| Tool | Capabilities | Verified limit | Status |
|---|---|---|---|
| Oracle Always Free VM | brain, queue, render (CPU) | 2 OCPU / 12 GB, permanent; 31 GB free of 45 GB disk | wired |
| Groq / Gemini free legs | text-llm | Groq 30 RPM / 1,000 RPD / 8,000 TPM per model; Gemini free tier (inputs may train models — ad scripts only) | wired (via hub) |
| HF ZeroGPU Space 1 (Wan 2.2 TI2V-5B) | gpu-video | 5 GPU-min/day shared; scheduler reserves 1.5x decorator duration; authenticated 300 s/day with HF_TOKEN | wired (pool not wired yet — `HF_SPACES_VIDEO_ENABLED=false`) |

Candidates — verified, not wired:

| Tool | Capabilities | Verified limit | Status |
|---|---|---|---|
| GitHub Actions (public repo) | parallel-compute | 4 vCPU + 16 GB per runner, 20 concurrent, job max 6 h; CI/CD only — no persistent hosting, no limit-bypass (ToS) | candidate |
| Cloudflare Workers | webhook-ingress | 100k req/day, 10 ms CPU, 128 MB per request — routing only, no heavy work | candidate |
| Kaggle (manual/batch) | lora-train, gpu-batch | 30 GPU h/week, 1x P100 or 2x T4 (16 GB VRAM), 29 GB RAM, session max 12 h, 20 GB saved disk, no inbound webhook | candidate |
| Modal ($30/mo free credit) | gpu-video, lora-train, gpu-batch | ~50 h T4 / ~14 h A100 40 GB per $30 credit; recurring monthly | candidate |
| NVIDIA NIM | text-llm | 40 RPM, 10,000 req/day per model, 100+ models; no card | candidate (priority add 1) |
| Cloudflare R2 | object-storage | 10 GB free, $0 egress | candidate (priority add 2) |
| Pingzen | monitoring | 55 monitors, 1-min checks, commercial use allowed | candidate (priority add 3) |
| Resend | email | 3,000/mo, 100/day | candidate (priority add 3) |

Backups, not base:

| Tool | Role | Verified limit |
|---|---|---|
| SambaNova, Cloudflare Workers AI | hub backup text legs | Workers AI 10,000 Neurons/day |
| Backblaze B2 | R2 backup | 10 GB free, egress free up to 3x stored |
| Neon / Turso / Upstash | off-VM db/queue backup only | Neon 0.5 GB/project; Turso 5 GB; Upstash Redis 256 MB, 500k commands/mo |
| Brevo | second email option | 300/day |
| Paperspace Gradient Free | last-resort small GPU | M4000 (8 GB), session max 6 h — too small for Wan |
| OVHcloud trial | one-time GPU burst | $200 one-time, ~35 h GPU — burst only, never base |

Dead / closed — do not add (verified 2026-11-16/17):

| Tool | Why not |
|---|---|
| SageMaker Studio Lab | new signups closed 30 July 2026 |
| Beam $30/mo | withdrawn Sept 2026 |
| Fly.io free | ended Oct 2024; trial only (2 h) |
| UptimeRobot free | personal-use only since Dec 2024 |
| OpenRouter Nemotron 3 Super `:free` | withdrawn 2026-11-16 — `:free` list rotates, never a permanent leg |
| HF free CPU/Docker Spaces | creating compute Spaces needs PRO $9/mo; free = 2 ZeroGPU Gradio Spaces + static only; Spaces sleep after 48 h idle |

## 5. Adapter interface (design — mirrors the hub provider pattern)

One adapter per tool, same interface, different API inside. Mirrors
`src/lib/hub/types.ts` (typed results, pause reasons, ledger) and the
provider pattern in `src/lib/providers/` (one module per provider, env
config, fallback chain in `fallback.ts`).

```ts
interface ToolRunRequest {
  toolId: string;
  capability: ToolCapability;
  jobId: string;            // BullMQ job id on the VM — results join back here
  input: Record<string, unknown>;  // files by storage path, never inline secrets
  timeoutMs: number;
}

type ToolPauseReason =
  | "timeout" | "error" | "rate_limited" | "quota_exceeded"
  | "duplicate" | "too_short" | "empty" | "not_wired" | "tool_dead";

interface ToolRunResult {
  ok: boolean;
  toolId: string;
  jobId: string;
  status: "ok" | "paused";
  pauseReason?: ToolPauseReason;
  output?: { files?: string[]; data?: Record<string, unknown> };
  usage: { unitsUsed: string; costUsd: 0 };  // always 0 on the free stack
  durationMs: number;
  error?: { code: string; message: string };
}

interface ToolAdapter {
  id: string;
  capabilities: ToolCapability[];
  /** Quota check BEFORE the call. Never throws — broken counter = allow, logged. */
  checkQuota(): { allowed: boolean; remaining: string };
  run(req: ToolRunRequest): Promise<ToolRunResult>;
}
```

Adapter rules (same as hub legs):

- Every adapter reads its secret from env only (`secretEnv` name in the
  registry). No secret in code, logs, ledger, or chat.
- Every dispatch writes a ledger row first (attempt) and updates it on
  result — including pauses and failures. No ledger row = it didn't happen.
- A pause never silently falls back and pretends success: the result is
  `ok: false, status: "paused"` with a typed reason, and the router tries
  the `fallback` tool as a new, separately ledgered dispatch.
- Timeouts per capability (text 8 s in the hub; GPU/video per provider —
  set in the adapter, recorded in the registry entry).
- Compliance scan applies to every output that becomes public (script,
  caption, image, video): no music/SFX/price/fake claims, Shariah filter —
  same scan the pipeline already runs.

## 6. Routing rules

1. A job names a **capability**, never a tool. (`gpu-video`, not `modal`.)
2. Router lists wired tools with that capability, ordered by: status
   `wired` first, then most quota remaining, then lowest recent failure rate
   (from the ledger).
3. Quota guard runs before the call. On `quota_exceeded` the tool pauses
   for the rest of its quota window and the router tries `fallback`.
4. Max 2 attempts per job across tools (hub pipeline rule: max 2 retries).
   After that the job returns `ok: false` with the real reasons — never a
   fake success.
5. Results always join back on the VM: files land in `storage/` (or R2, then
   a pointer in `storage/`), the BullMQ job completes, n8n reads the result
   from the backend — n8n never talks to a tool directly.
6. A tool that fails 3 consecutive dispatches pauses itself and needs a
   manual re-check before it routes again (same spirit as the hub's pause
   gates).

## 7. Quota + ledger storage

Mirrors `src/lib/hub/quota.ts` (file store, date-keyed counters, Asia/Calcutta
day) and `src/lib/hub/ledger.ts`:

- `storage/tools/registry.json` — the registry file (§3). Read on every
  dispatch; edited by hand (or by the read endpoint's admin path, later).
- `storage/tools/quota.json` — per-tool counters, same shape as the hub's
  quota file: `{ date, counts: { <toolId>: <unitsUsed> } }`. Counters reset
  on the tool's own window (daily / weekly / monthly per entry).
- `storage/tools/ledger.jsonl` — one JSON line per dispatch: tool, job,
  capability, verdict, pause reason, units used, duration, costUsd 0.
- Read endpoint returns registry + remaining quota + last ledger rows, so
  the dashboard can show "which tool is tired" without reading files.

## 8. API design

Phase 1 — read-only (first build step, after the picks):

```
GET /api/v1/tools/registry
Header: x-n8n-secret
Response 200:
{
  "ok": true,
  "tools": [ { "id": "modal", "capabilities": [...], "status": "candidate",
               "quota": {...}, "remaining": "~50h T4", "lastVerified": "2026-11-16" } ],
  "summary": { "wired": 3, "candidate": 8, "paused": 0, "dead": 0 }
}
```

Phase 2 — dispatch (only after the first adapter is live-tested, §15):

```
POST /api/v1/tools/run
Header: x-n8n-secret
Body: { "capability": "gpu-video", "jobId": "...", "input": {...}, "timeoutMs": 600000 }
Response: ToolRunResult (§5) — ok, or ok:false with typed pause/error code.
```

Errors are typed, never silent: `quota_exceeded`, `tool_not_wired`,
`tool_dead`, `capability_unknown`, `validation_error`. A 422 for a bad
capability, the same way `POST /api/v1/hub/run` returns 422 for a bad kind.

## 9. n8n wiring

No workflow changes until the first adapter is wired and live-tested.
After that, one workflow (`n8n/workflows/tools-run.json`, mirroring
`n8n/workflows/hub-run.json`): webhook → validate (secret + capability) →
`POST /api/v1/tools/run` → respond with files/ledgerId. Existing workflows
keep calling the backend as today; the registry never replaces a working
workflow, it only adds a new route for jobs the VM cannot do.

## 10. The 6 new tasks it enables (not possible today)

| # | Task | Today | In the box | Tool(s) |
|---|---|---|---|---|
| 1 | Parallel batch renders | serial on 2 OCPU | 50 videos in one batch | GitHub Actions runners |
| 2 | Wan 5B at real scale | ~4–5 min AI footage/mo on ZeroGPU (5 s clip ≈ 9 min) | full clips, more AI scenes per video | Modal A100 40 GB / Lightning L4 24 GB (Kaggle cannot — T4 is 16 GB, Wan needs 24 GB) |
| 3 | LoRA / fine-tuning | zero (VM is CPU-only) | small brand/product-style LoRA | Kaggle 30 h/week or Modal |
| 4 | GPU upscale + background removal, batch | upscale only enlarges canvas; rembg slow on CPU | Real-ESRGAN detail upscale + 100s of designs | Modal / Kaggle GPU |
| 5 | Big data + audio at scale | days on 2 OCPU or stuck queue | sharded across parallel workers | GitHub Actions matrix / Modal (Whisper, lakh-row ETL) |
| 6 | Cloudflare webhook ingress | webhooks hit the VM directly | Workers filters + queues IG/FB webhooks first | Cloudflare Workers |

## 11. Priority adds — wiring cost per pick

1. **NVIDIA NIM** — cheapest to wire (OpenAI-compatible text API, hub
   already speaks that shape; one more leg in the router). Biggest gain:
   10,000 req/day per model vs Groq's 1,000/day.
2. **Cloudflare R2** — medium (S3-compatible client in the delivery path;
   finals move VM → R2, store keeps a pointer). Gain: disk pressure off
   the VM, $0 egress on delivery.
3. **Pingzen + Resend** — cheapest, two small adapters (monitoring reads
   the health endpoint; email sends via API). Gain: closes the two known
   gaps — no monitoring and no email leg today.

## 12. Never in the box

- **Local PC + tunnel** — cloud-only rule (2026-10-09); PC off = system dead.
- **Multi-account swarm** — one person, one free GitHub account;
  double-dipping free benefits is ToS abuse.
- **Someone else's Student ID** — fraud; GitHub revokes.
- **Deepfake / voice cloning** — banned in this system, toolbox or not.
- **Paid tools as the base** — free-first is a hard rule. Modal's $30 is a
  free credit, not a subscription; anything that needs a card on file to
  keep working is flagged once and dropped.

## 13. Honest limits

- Every new tool adds a secret, a quota to watch, and maintenance. After
  ~10 tools each addition buys less than it costs — the registry exists to
  make that cost visible (status + lastVerified + ledger), not to hide it.
- Free catalogs rotate: verify live before wiring. The 2026-11-15 sweep
  found Pollinations `pk_` keys dead since 1 Nov; Nemotron `:free`
  withdrawn 2026-11-16. A tool is never "done" — it is verified on a date.
- Trial credits ($200–300 GCP/Azure/AWS, OVH $200) are one-time bursts,
  never the permanent base. HF Spaces sleep after 48 h idle; free Docker
  Spaces need PRO $9/mo — Gradio/ZeroGPU only on free.
- Pooling adds throughput, never a bigger single machine (§1). Any design
  that needs one 64 GB job is out of scope for this box.

## 14. Build order (only after the picks in §16)

1. **Phase 1 — registry + read endpoint + tests.** `storage/tool-registry.json`
   (schema §3, catalog §4), one adapter interface (§5, types only), `GET
   /api/v1/tools/registry`, tests: registry validates, read endpoint returns
   wired/candidate counts, no secret value ever in a response. No workflow
   changes.
2. **Phase 2 — first adapter.** Only the picked priority add (§16, pick 2),
   wired to the picked first task (§16, pick 1). Live-tested end-to-end
   before it is marked `wired` — a test that only checks the registry file
   does not count.
3. **Phase 3 — second adapter.** Same rule: pick, wire, live-test, then mark
   `wired`. Never two adapters at once; never a workflow change before the
   adapter's live test passes.

## 15. "Wired" checklist (before any tool is called wired)

- [ ] Adapter live-tested against the real tool (not a fake caller).
- [ ] Quota guard blocks at the limit with typed `quota_exceeded`.
- [ ] Ledger row written for success, pause, and failure.
- [ ] Fallback dispatch works when the tool pauses.
- [ ] No secret value in code, logs, ledger, or repo (env name only).
- [ ] `lastVerified` updated to the test date; entry status set to `wired`.

## 16. Decisions needed from the user (still open, 2026-11-20)

1. First new task: parallel renders, LoRA, or Wan scale?
2. First priority add: NVIDIA NIM, R2, or Pingzen + Resend?
3. (Later, per tool) account + key via the file method, never in chat.

---
*Design only. No code, no accounts, no keys. Next step is Phase 1 (§14) after
the two picks above — not before.*

---

## Built 2026-11-20 (user: "pure add kr de na re bhai")

Everything buildable without accounts/keys is now in the repo. Tests
`scripts/test-tool-registry.ts` **23/23**, tsc 0, eslint 0, build 0 (routes
`/api/v1/tools/registry` + `/api/v1/tools/run` in the build output).
Repo-only, next redeploy; NOT live-tested (needs VM + keys).

**Core**
- `storage/tool-registry.json` — 26 tools, 0 load warnings. Summary
  (2026-11-20): 4 wired (oracle-vm, groq, gemini, **nim**), 1 paused
  (hf-space-1 — Space live, pool not wired, HF_TOKEN empty), 16 candidate,
  5 dead.
- `src/lib/tools/types.ts` — ToolEntry / ToolCapability / ToolStatus /
  ToolAdapter / ToolRunResult / ToolLedgerEntry, zod schemas, stale rule
  (lastVerified > 30 days).
- `src/lib/tools/registry.ts` — load + validate (bad entry skipped with
  warning), routableTools (wired + adapter + not stale), public view,
  summary. Entries hold env names only — no secret values exist to leak.
- `src/lib/tools/quota.ts` — per-tool counters (`storage/tools/quota.json`,
  Asia/Calcutta day/week/month windows), checked before dispatch.
- `src/lib/tools/ledger.ts` — `storage/tools/ledger.jsonl`, every dispatch
  incl. pauses and failures.
- `src/lib/tools/dispatch.ts` — capability routing, fallback chain, max 2
  attempts, typed `tool_not_wired` / `quota_exceeded` / `not_configured`.
- `GET /api/v1/tools/registry` + `POST /api/v1/tools/run` (x-n8n-secret,
  same envelope + error conventions as the hub routes).

**Adapters (code-complete, still `candidate` — live test pending)**
| Adapter | File | Needs to flip to `wired` |
|---|---|---|
| NVIDIA NIM | `src/lib/tools/adapters/nim.ts` | **WIRED 2026-11-20** — key installed + live chat call 200 (choices: 1). Default model corrected: `meta/llama-3.1-70b-instruct` returned 410 (gone from catalog) → `nvidia/nemotron-3-ultra-550b-a55b` (verified live, 33 models in catalog that day) |
| Resend | `src/lib/tools/adapters/resend.ts` | RESEND_API_KEY (free) + verified `from` domain + live send |
| GitHub Actions | `src/lib/tools/adapters/github-actions.ts` | GITHUB_TOKEN + GITHUB_REPO + GITHUB_WORKFLOW_ID; target workflow needs a `workflow_dispatch` trigger + live dispatch (204) |
| R2 | `src/lib/tools/adapters/r2.ts` (wraps existing `src/lib/storage.ts` S3 backend — no duplicate client) | S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY / S3_ENDPOINT (R2 endpoint) / S3_REGION=auto / S3_FORCE_PATH_STYLE=true + live upload |

**No adapter code (candidate, interface only) — needs more than a key**
- Modal: Python-first SDK/CLI, no verified TS path — needs a VM-side plan first.
- Kaggle: CLI-based (`kaggle` command + token on the VM), no inbound webhook.
- Pingzen: API shape not verified live — needs a live account check first.
- Cloudflare Workers ingress: the adapter is a Worker script, not a backend
  module — needs a Cloudflare account + `wrangler` deploy, separate step.
- SambaNova / Workers AI / Neon / Turso / Upstash / Brevo / B2 / Paperspace /
  OVH trial: registered as candidates; adapters only when one is picked.

**Keys installed 2026-11-20 (blind, values never shown):** NVIDIA_API_KEY +
OPENROUTER_API_KEY — both verified live (NIM models 200 + chat 200,
OpenRouter models 200), app + worker restarted, health ok:true. OpenRouter
provider patch still NOT applied — key sits in .env, hub cannot use it
until the patch gets the user's "haan". **Cloudflare (same day, second
check):** R2 creds INSTALLED — CLOUDFLARE_ACCOUNT_ID + S3_ACCESS_KEY /
S3_SECRET_KEY / S3_ENDPOINT (the .env S3 vars were empty placeholders, so
no conflict). NOT installed: CLOUDFLARE_API_TOKEN — the file's value is 53
chars (real tokens are 40) and failed live verify (401 in every extraction);
user must re-copy it cleanly. R2 TLS from the VM FAILS (handshake failure
on TLS 1.2 and 1.3, host curl and Node-in-app both) while other Cloudflare
hosts work from the same VM — cause unproven, re-test after the token fix.
S3_BUCKET name was not in the file — still needed before R2 can go wired.

**What this build does NOT do (honest)**
- None of the 6 new tasks runs live yet: parallel renders, Wan 5B scale,
  LoRA, GPU upscale batch, big-data/Whisper sharding, webhook ingress —
  all need a `wired` tool first, and every `wired` flip needs a key + a
  live test. Dispatch refuses candidates with typed `tool_not_wired`.
- No account created, no key taken, no n8n workflow changed.
- Keys reach the VM by the file method only, never in chat. Per tool, send
  the key file the same way the Groq/Gemini keys were sent (2026-11-13).

## Phase 2 built 2026-11-22 (user: "6 me se jo jo kr skte hain kr do")

Everything buildable without accounts/keys/tokens is now in the repo.
Tests `scripts/test-tool-registry.ts` **48/48**, tsc 0, eslint 0, build 0
(route `/api/v1/jobs/[id]/render-bundle` in the build output). Repo-only,
next redeploy; NOT live-tested — every new adapter needs its account/key
+ a first live run, and all 6 tasks stay `candidate` until then.

**Per-task status (the 6 tasks from §10)**
| # | Task | Built 2026-11-22 | Still blocked by |
|---|---|---|---|
| 1 | Parallel renders | `GET /api/v1/jobs/[id]/render-bundle` (x-n8n-secret; scenes as signed URLs, captions as text, same opts as the local path — shared `renderOptsBase` helper in `render.ts`, so the two paths cannot drift) + `scripts/gh-render-batch.ts` (download → `renderFinalVideo()` → MP4 + stage-callback) + `.github/workflows/render-batch.yml` (workflow_dispatch: bundleUrl/jobId/apiBase, 4 vCPU/16 GB runner, 120-min cap, artifact kept 90 days) | GITHUB_TOKEN + GITHUB_REPO + GITHUB_WORKFLOW_ID (repo secrets) + first live dispatch; the workflow file must exist in the target repo (it does — this repo) |
| 2 | Wan 5B at scale | `src/lib/tools/adapters/modal.ts` (shells out to the `modal` CLI; every worker takes one `--payload_json` kwarg and prints one `RESULT_JSON:` line) + `src/lib/tools/workers/modal-wan.py` (Wan2.2-TI2V-5B on A100-40GB, 16 fps, volume `toolbox-outputs`) | Modal account + `modal setup` (MODAL_TOKEN_ID/SECRET) + first live `modal run` (the Wan pipeline class is untested against a live run) |
| 3 | LoRA / fine-tuning | `src/lib/tools/adapters/kaggle.ts` (push/status/output via the `kaggle` CLI; substitutes `<kaggle-username>` from env at push time) + `src/lib/tools/workers/kaggle-lora/train-lora.py` (SD 1.5 LoRA, rank 16, gradient checkpointing — fits a T4 16 GB; SDXL would OOM) + `kernel-metadata.json` (GPU enabled) | Kaggle account + API token (KAGGLE_USERNAME/KEY) + phone verification once for GPU access + training images folder + first live `kaggle kernels push` |
| 4 | GPU upscale + background removal | `src/lib/tools/workers/modal-upscale.py` (Real-ESRGAN x2/x4 + rembg, T4, same `modal` adapter, functions `upscale` / `remove-background`) | Same Modal account as #2 |
| 5 | Big data / Whisper ETL | `src/lib/tools/workers/modal-whisper.py` (faster-whisper `transcribe` + `transcribe_batch`) + `src/lib/tools/shard.ts` (`splitIntoShards` + `runSharded` — dispatch is sequential on purpose so quota accounting stays exact; parallelism lives on the tool side) | Same Modal account as #2 |
| 6 | Webhook ingress | `src/lib/tools/workers/webhook-ingress/index.ts` (HMAC verify via `crypto.subtle`, Meta verification GET, allowlist instagram/page, `ctx.waitUntil` forward so Meta gets its 200 fast) + `wrangler.toml` + `src/lib/tools/adapters/cf-workers.ts` (deploy/status via the `wrangler` CLI) | A VALID CLOUDFLARE_API_TOKEN (the file's value failed verify 2026-11-20) + `wrangler secret put META_APP_SECRET` / `META_VERIFY_TOKEN` + VM_WEBHOOK_URL set in `wrangler.toml` + first live `wrangler deploy` |

**Registry (2026-11-22, still 26 tools, 0 load warnings):** 4 wired, 16
candidate, 1 paused, 5 dead — unchanged counts. Adapters now wired in:
modal → `modal`, kaggle → `kaggle`, cf-workers → `cf-workers`
(all still `candidate`). SecretEnv corrections (the real provider names,
not the Phase 1 guesses): modal `MODAL_TOKEN` → `MODAL_TOKEN_ID` (+
MODAL_TOKEN_SECRET in limits), kaggle `KAGGLE_API_TOKEN` →
`KAGGLE_KEY` (+ KAGGLE_USERNAME in limits). gh-actions limits note the
render-batch workflow.

**Bug fixed in this build (found while grounding):** `dispatch.ts`
looked adapters up by the registry's `adapter` field, but its map key
was `r2` while the registry says `s3-storage` (shared by the r2 and b2
entries) — so R2/B2 dispatch always fell through to `tool_not_wired`
even when wired. Map key is now `s3-storage`, and `r2Adapter` reports
`req.toolId` in results so a b2 run is not mislabelled as r2. Test:
"dispatch object-storage reaches s3-storage adapter" (48/48).

**What Phase 2 does NOT do (honest)**
- Still zero live runs: no Modal account, no Kaggle token, no GitHub
  secrets, no valid Cloudflare token — so Wan 5B, LoRA, upscale,
  Whisper, parallel renders and the Worker are all code-complete but
  unproven. The first live run of each is the validation, not this build.
- The Python workers are syntax-checked (`py_compile`) only — no GPU,
  no Modal/Kaggle account on this machine to run them against.
- Nothing is deployed: the VM app is still the 2026-11-13 deploy and its
  `/api/v1/tools/registry` returns 404. The next redeploy carries the
  registry, dispatch, adapters, render-bundle route and all 6 task
  paths at once.
