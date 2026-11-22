# Manual promote

Built 2026-11-11. The dashboard now has a **Manual promote** card: paste
any website or product link, pick a type, and the marketing workflow
promotes it on demand — no waiting for the daily rotation.

## What happens when you press "Promote karo"

1. The dashboard calls `POST /api/v1/marketing/promote` with
   `{ url, title?, productType?, description?, durationSeconds?,
   publish?, platforms? }`.
2. The backend validates the URL (public http(s) only — localhost and
   private addresses are rejected; the job creation's own SSRF checks
   run again downstream) and maps it to the ads-marketing webhook
   payload.
3. It forwards to `POST {N8N_BASE_URL}/webhook/digital-ads-marketing`
   with the `x-n8n-secret` header — the exact webhook the daily
   ads rotation fires. The workflow then does its normal thing:
   research the page, write a Hinglish script, render a 15s Premium
   Dark ad, and (publish on) push it to Instagram/Facebook Reels +
   Pinterest/LinkedIn/X.
4. The forward is fire-and-forget (30s timeout) because the webhook
   runs ~40 min server-side. The dashboard shows **Started** as soon as
   n8n accepts the call.

## When it cannot forward

If n8n is down, refuses (non-2xx), or `N8N_BASE_URL` /
`N8N_WEBHOOK_SECRET` are not set in `.env`, the promotion is saved to
`storage/marketing/promotions.json` with status **queued** and the
dashboard says so plainly — it is never faked as started. Fix n8n/env
and press Promote again (the queue is a record, not an auto-retry).

## The form

- **Website / product link** — any public URL. Title khali ho to site
  ka naam use hota hai.
- **Type** — website (default), ebook, template_pack, pod. `website`
  is a new product type added to the ads-marketing workflow (see below).
- **Duration** — 15–180s, default 45.
- **Publish bhi karo** — on (default): video banta hai aur publish
  hota hai. Off: sirf video banta hai, kahin post nahi hota.
- **Extra platforms** — pinterest / linkedin / x. Khali chhodo to
  multi-publish auto-route karta hai (fit ke hisaab se). IG/FB Reels
  hamesha standard flow se chalte hain.
- **Recent promotions** — the card lists the last 5 (GET
  `/api/v1/marketing/promote`), newest first.

## Workflow changes (digital-ads-marketing.json — re-import needed)

Three surgical edits, all node-checked and validator-passed:

1. `validate-input` now accepts productType `website` (was only
   ebook | template_pack | pod).
2. `build-publish-payload` category map gained `website: 'website'`.
3. **Bug fix found while wiring the toggle:** `publish: false` used
   to skip multi-publish but the IG/FB reels STILL fired
   (`if-reels-ready` only checked `reelsReady`). `build-reels-payload`
   now returns `reelsReady: false, reelsReason: 'publish_disabled'`
   when publish is false — so "video only" actually means video only.
   This matches the documented intent of
   `DIGITAL_ADS_AUTO_PUBLISH=false` (video banta hai, post nahi).

## Env

`N8N_BASE_URL` (added to `.env.example`) + `N8N_WEBHOOK_SECRET` —
both already exist in the deployment; the backend needs them to sign
the forward. Without them every promotion queues with a clear note.

## Files

- `src/lib/marketing/promote.ts` — validation, payload mapping,
  forward, promotion history file.
- `src/app/api/v1/marketing/promote/route.ts` — POST promote, GET
  recent promotions. Same trust boundary as POST /api/v1/jobs (called
  by the dashboard, no x-n8n-secret on this endpoint).
- `src/app/page.tsx` — Manual promote card.
- `n8n/workflows/digital-ads-marketing.json` — the three edits above.
- `scripts/test-manual-promote.ts` — 29/29 (URL gate, payload
  mapping, forward success/failure/down/env-missing, history,
  workflow-edit guards).

## Verification

- test-manual-promote 29/29; tsc/eslint/build green;
  `validate-workflows.py` PASS digital-ads-marketing.json (36
  pre-existing legacy errors unchanged).
- NOT live-tested: no real promotion has been fired (needs deploy +
  backend redeploy + workflow re-import). The first manual promote
  after deploy will be the live test — the dashboard shows Started /
  Queued, and the video takes ~40 min.
