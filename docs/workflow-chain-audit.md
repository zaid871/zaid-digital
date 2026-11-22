# Workflow Chain Audit — 2026-11-16 (gaps fixed same day)

**Total: 49 workflows** (was 59; 10 orphans retired 2026-11-16 — see
"Gaps — FIXED" below). Repo has 64 JSON files + 10 in `_retired/`; 5
excluded from the live set: 2 `*.v1-legacy.json`, 1 mock, 1 old
combined `digital-products.json`, 1 disabled
`digital-website-template-generation.json`. Verified live on the VM
2026-11-16 (`n8n export:workflow --all`): **49 exported, 0 active, 0
duplicates, 48 with error routing.** Nothing runs yet — activation is
still pending the user's decision (proposed 2026-11-14).

## How the chain connects (two fabrics)

### 1. Direct n8n → n8n webhook calls
- **Affiliate video chain (fully linked):** daily-controller →
  product-discovery → product-verification → script-generation →
  ai-visual-generation → voice-generation → video-rendering →
  quality-control → website-listing → instagram/facebook-publishing.
  Daily-controller also calls affiliate/error-recovery.
- **Digital ads chain:** ads-daily (09:00 IST, reads the brain plan) →
  digital-ads-marketing → digital instagram/facebook-publishing.
- **Presell chain:** marketing-machine → presell-gate → generation
  webhooks (ebook/template/pod) once 10 intents pass.
- **Email chain:** freebie-delivery → email-nurture.

### 2. Shared backend state (scheduled workflows)
- **Weekly digital chain:** problem-miner Mon 07:00 IST → idea-briefs
  07:30 → auto-generate 08:00 (backend tick fires the generation
  webhooks) → products land in storage → brain daily 06:30 plan →
  ads-daily 09:00 executes the plan → publishing.
- **Loops:** goal-loop Sun 08:00, beat-the-top Sun 09:00, weekly
  reporting Mon 08:00 (+ goal sweep), campaigns tick at best-time
  slots (02:00/03:00/14:00/15:00 UTC), backup-monitoring daily,
  performance-repost daily, pinterest-volume weekly.

## Gaps — FIXED 2026-11-16 (user: "gaps fix karo")

All three gaps from the audit above are fixed and verified live
(export + DB agree). Repo live-candidate files: 49, matching live.

### A. Orphans — 10 retired (live rows deleted, files preserved)
Live: 59 → **49 workflows, all inactive, no duplicates.** Retired files
moved to `n8n/workflows/_retired/` (with a README on when to re-import):
affiliate-analytics-collection + affiliate-link-validation (superseded
by backend routes), hub-run + digital: marketing-strategist (thin
wrappers; the API route is the entry), digital: marketing-machine +
digital: presell-gate (one uncalled pair, no brief source; brain +
campaigns + ads-daily are the live marketing loop), digital: pmf-survey
+ digital: review-request + digital: pod-approve (need the selling
layer / live POD), product-video-main (backend `POST /api/v1/jobs` +
BullMQ worker is the live path). Every remaining workflow now has a
caller (direct webhook) or a schedule + shared backend state.

### B. Error routing — LIVE (was 0)
n8n stores it in workflow **settings** (`settings.errorWorkflow` =
target workflow ID) — not a top-level field, not a dedicated column.
That is why CLI import drops the repo files' top-level field and why
the export shows it under `settings`. Set via DB surgery 2026-11-16
(backup in `~/workspace/n8n-db-backup-2026-11-16/`): 17 affiliate
workflows → affiliate-error-recovery, 29 digital workflows →
digital-error-recovery, both recovery workflows → product-video-errors
(terminal logger, no loop), product-video-errors itself → none.
Both recovery workflows carry an Error Trigger node + retry logic (max
3 attempts, 5-min backoff, spend guard, `POST /api/v1/jobs/:id/retry`
exists). Verified via fresh export: 49 total, **48 with
settings.errorWorkflow**, 0 active, 0 duplicates. (The
workflow_dependency index still shows 0 errorWorkflow rows — stale
index, rebuilds on save; execution reads settings directly.)

### C. Still outstanding (not chain gaps) — updated 2026-11-16 ~20:10 IST
- **Activation DONE: 29 of 49 active** (brain, miner, briefs, auto-generate, ads-daily, ads-marketing, goal-loop, beat-the-top, campaigns, weekly-reporting, backup-monitoring, 15 generation workflows, 3 error workflows). Verified live: export + DB + short webhook URLs all agree; outbox 50 completed / 0 failed.
- **20 HELD for tokens:** affiliate chain (8) + 4 IG/FB publishing + auto-DM + repost + Pinterest (2) + email (2) — IG/FB tokens do not exist yet; activating them would burn quota on failed publishes.
- **Backend redeploy DONE 2026-11-16:** cross-transfer routes + storefront live on the VM (weekly report GET 200, validate-link/qc-check/season-rank POST 401 = exist, /store 200).
- IG/FB tokens do not exist — publishing workflows will fail when
  activated (correctly held until tokens exist).
- Meta comments-webhook subscription is manual at deploy.
- Etsy API key not set (optional).
- PMF survey / presell gate need real human responses (10 intents) —
  market validation, not a user manual step.
- **First live runs:** brain Tue 2026-11-17 06:30 IST; ads-daily Tue 09:00 IST; weekly chain Mon 2026-11-23 (miner 07:00 → briefs 07:30 → auto-generate 08:00) → first products in the store after that tick. Monday 2026-11-16's chain was missed (activation finished 20:10 IST); a manual catch-up (miner → briefs → tick) was not done — offer to the user.

## Fix plan (needs the user's go-ahead)
1. Delete the 2 superseded workflows (analytics-collection,
   link-validation) — or keep them dormant, user's call.
2. Give the machine/strategist/hub-run/pmf/review/pod-approve a caller
   (goal-loop / campaigns tick / dashboard) or retire them.
3. Set `errorWorkflow` via the n8n REST API (needs an API key created
   in the n8n UI) and wire both error-recovery webhooks.
4. Then activation (separate decision) + IG/FB tokens.
