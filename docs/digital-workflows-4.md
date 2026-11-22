# Digital Products: 4 Split Workflows (2026-11-03)

The old combined `n8n/workflows/digital-products.json` (one webhook routing
ebook/template_pack) is superseded by four focused workflows. The affiliate
workflows under `n8n/workflows/affiliate/` are untouched.

## The four workflows

| Workflow | Webhook path | Backend |
|---|---|---|
| `digital-ebook-generation.json` | `POST /digital-ebook-generation` | `POST /api/v1/digital/ebooks` (sync, 15 min timeout) |
| `digital-template-generation.json` | `POST /digital-template-generation` | `POST /api/v1/digital/template-packs` (sync, 5 min timeout) |
| `digital-pod-generation.json` | `POST /digital-pod-generation` | `POST /api/v1/digital/pod` (sync, 15 min timeout) |
| `digital-ads-marketing.json` | `POST /digital-ads-marketing` | shared ads pipeline (see below) |

All four: webhook → secret check (`x-n8n-secret` vs `N8N_WEBHOOK_SECRET`) →
validate → **demand pre-check** → call → normalize → respond (200 / 400 / 502).
Statically validated (node graph + `node --check` on every Code node); NOT
live-import-tested in n8n.

### v2 additions (2026-11-07) — generation workflows only

1. **Demand pre-check (plan guardrail #1):** after validation, the workflow
   calls `GET /api/v1/discovery/problem-miner/latest` (cheap read of the
   weekly miner's top-10) and keyword-matches the topic/niche against it.
   Match → proceeds. No match → responds 200 `needs_validation` with the
   closest mined problems as hints (generate nahi hota). Never blocks when
   the miner never ran or is unreachable — proceeds with a warning
   (`not_mined_yet` / `demand_not_checked`). Override per call:
   `skipDemandCheck: true`.
2. **One retry on transient failure:** a `generation_failed` / 5xx / timeout
   is retried once after a 60s wait. `compliance_rejected` and validation
   errors are never retried.

   Fix 2026-11-07: the pre-check calls `GET .../problem-miner/latest`,
   but that route did not exist — only `GET .../problem-miner` did, so the
   call 404'd and every check silently degraded to `demand_not_checked`.
   Added `src/app/api/v1/discovery/problem-miner/latest/route.ts` (shared
   reader `src/lib/discovery/latest.ts`, live-tested 200 `mined:false` /
   `mined:true`); both URLs now work.

## digital-ads-marketing (shared) — v2 2026-11-07: full affiliate-style publishing setup (separate copies)

One setup for all three product types. Webhook body:

```json
{
  "productType": "ebook | template_pack | pod",
  "productName": "My Product",
  "productLink": "https://payhip.com/b/xxxx",
  "productDescription": "optional",
  "features": ["optional", "up to 8"],
  "durationSeconds": 45,
  "publish": true,
  "platforms": ["pinterest", "linkedin", "x"]
}
```

Flow: validate → `POST /api/v1/jobs` (productUrl = productLink, Premium Dark,
numbered Hinglish script, 15–180s ad, default 45s) → poll `GET /api/v1/jobs/:id`
every 20s × 120 (≈40 min) → on COMPLETED → `GET /api/v1/jobs/:id/result`
(signed `video.downloadUrl` — the bare `/download` URL without `?key=` 400s,
never use it) → build own-product caption (name + description + up to 3
features + link; no price, no claims) → trigger `POST /webhook/digital/instagram`
+ `POST /webhook/digital/facebook` (fire-and-forget; each runs the full
affiliate-style publishing chain — best-time gate, eligibility check,
container/upload, publish, record-publish — as a separate copy) → `POST
/api/v1/publishing/multi-publish` (Pinterest + LinkedIn auto, X draft) →
respond. `WAITING_FOR_REVIEW` returns 200 with `needsReview: true` (approve
in dashboard, re-run). `publish: false` skips the multi-publish step.
No video URL in the result → reels trigger skipped with `reelsReason:
no_video_url`, multi-publish still runs.

### Digital publishing copies (2026-11-07)

- `digital-instagram-publishing.json` (24 nodes) and
  `digital-facebook-publishing.json` (18 nodes) are node-for-node copies of
  the affiliate publishing workflows, kept separate: webhook paths
  `digital/instagram` / `digital/facebook`, own-product caption, **no
  affiliate disclosure** (affiliate files untouched — `affiliate/` still
  Oct 29). Same IG_USER_ID/IG_ACCESS_TOKEN + FB_PAGE_ID/FB_PAGE_TOKEN env.
  Best-time gate parks outside IST peak slots as DEFERRED (same as affiliate).
- The ads-marketing workflow also needs `N8N_BASE_URL` env (to call the
  digital publishing webhooks).

## POD backend v1 (`src/lib/digital/pod.ts`)

`POST /api/v1/digital/pod` `{ niche, designText?, style?, shirtColor?, title?,
description?, printify? }` → Pollinations design image → FFmpeg Lanczos
upscale (5000×5500 default, env POD_PRINT_WIDTH/HEIGHT; TeePublic full range + Redbubble men's graphic) → optional rembg (skipped + warning when absent; deploy-check scripts/check-pod-deps.ts) → flat
mockup composite (`mockup-flat.png` — honest flat preview, NOT lifestyle) →
optional Printify **unpublished draft** (upload + product create) → manifest +
zip. Without `PRINTIFY_API_TOKEN` / `PRINTIFY_SHOP_ID` the Printify step is
skipped with `printify_not_configured` — assets are still produced locally.
AI text in designs may render imperfectly: always review `design-print.png`
before publishing anything.

## Deploy notes

- Import the 6 JSONs in n8n (3 generation + ads-marketing + 2 digital
  publishing); set `N8N_WEBHOOK_SECRET`, `BACKEND_URL`, and `N8N_BASE_URL` env.
- Deactivate the old `digital-products` workflow to avoid duplicate webhooks.
- Deploy needs: `PRINTIFY_API_TOKEN` / `PRINTIFY_SHOP_ID` (optional),
  `rembg` python package for background removal (optional), ffmpeg + zip
  (already in Dockerfile.app).
