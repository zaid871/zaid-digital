# Marketing campaigns (smart layer)

Built 2026-11-11. Correction of the manual-promote idea: the user did
NOT want a dumb "press button, blast everywhere" tool. The campaign
decides BY ITSELF where and when to market, and only when it is
appropriate — and when given a target ("itne din mein kam se kam
itna"), it pushes as hard as it can to hit it by the deadline.

## How it works

1. **Add the product** — dashboard card "Marketing campaign": link +
   title + type (website / ebook / template_pack / pod) + optional
   target (metric: views / clicks / posts / sales, value, deadline in
   days, 1–90). No target is also fine — the campaign then runs on a
   normal cadence.
2. **Analyze** — at creation the platform-fit analyzer ranks the
   platforms for the product (ebook/template → Pinterest + LinkedIn
   high; POD → Pinterest high, X medium; website → broad default).
   Only high/medium-fit platforms get the multi-publish part. IG/FB
   Reels are the base channel of every ad. X is manual-only (paid API)
   — the campaign prepares the copy; a human posts it.
3. **Decide, every publish slot** — the n8n workflow
   `digital-marketing-campaigns.json` ticks at 07:30 / 08:30 / 19:30 /
   20:30 IST (cron `0 2,3,14,15 * * *` UTC) → POST
   `/api/v1/marketing/campaigns/tick`. Each active campaign decides:
   - **wait** — not a peak window (the next slot is named), or the
     last post was too recent (min 24h gap, 12h when urgent — no spam).
   - **post** — peak time + gap OK. Level 0 (on-track): top fit
     platform. Level 1 (behind, < 0.7 of expected pace): ALL fit
     platforms. Level 2 (urgent, < 0.4 of pace or < 25% time left and
     behind): all platforms + shorter gap + the manual X draft.
   - **done** — target reached. **missed** — deadline passed, target
     unmet (the campaign stops; set a new target).
   Every decision is recorded with its reason, so the dashboard can
   always say WHY it waited.
4. **Act** — a "post" fires the ads-marketing webhook through the
   same promote() forward as the manual path (fresh video ad each
   time) and records the post as a goal run, so the goal-loop ledger
   sees it.

## Pace math

expected = target x (elapsed / deadline). ratio = progress /
expected. On-track >= 0.7, behind < 0.7, urgent < 0.4 or (>= 75%
elapsed and < 0.7). The 0.7 threshold is the same one the goal-loop
uses for gaps.

## Progress — what can and cannot be measured

- **posts** — always measurable; the campaign counts its own posts.
- **views / clicks** — read from the goal-loop ledger (latest
  recorded value per channel, summed). They need metrics fed into
  the ledger (POST /api/v1/marketing/goals/record); until then
  progress is "unknown" — never faked as zero. The goal-loop's
  auto-collection is still v2 (pending).
- **sales** — CANNOT be measured without the selling layer (parked).
  The campaign accepts a sales target but flags it on the dashboard
  and steers by views as a proxy. Sales targets need the
  selling/delivery decision unparked first.

## The honest limit

Effort is what the system controls — frequency, channels, timing,
fresh angles. The outcome (views, clicks, sales) depends on the
product and the market. No target is promised, only pursued: the
campaign maximizes the levers it has and reports the gap every
slot. A target that is unreachable (e.g. 1 lakh views in 3 days for
a new product) will show "behind / urgent" and keep pushing — it
will not invent numbers to look successful.

## Manual override

The old "Manual promote" is now a secondary button in the same card
("Abhi ek baar promote karo") — one immediate promotion using the
form's current values, bypassing the decision engine. The endpoint
POST /api/v1/marketing/promote is unchanged and is also what the
campaign tick uses internally.

## Files

- `src/lib/marketing/campaigns.ts` — fit mapping, pace, decision
  engine, tick, progress reading.
- `src/app/api/v1/marketing/campaigns/route.ts` — POST create, GET
  list with progress/pace/daysLeft.
- `src/app/api/v1/marketing/campaigns/tick/route.ts` — POST tick
  (x-n8n-secret, n8n caller).
- `src/app/api/v1/marketing/campaigns/[id]/route.ts` — POST
  pause/resume (completed/missed cannot resume).
- `n8n/workflows/digital-marketing-campaigns.json` (+
  `scripts/gen-digital-campaigns.py`).
- `src/app/page.tsx` — "Marketing campaign" card (replaced the
  "Manual promote" card).
- `scripts/test-campaigns.ts` — 35/35.

## Verification

- test-campaigns 35/35 (fit mapping, pace levels, all decision
  branches, progress sums, sales-null, pause/resume, tick post/wait/
  webhook-down, goal-run recording); tsc/eslint/build green;
  `validate-workflows.py` PASS digital-marketing-campaigns.json (36
  pre-existing legacy errors unchanged).
- NOT live-tested: no real campaign has run (needs deploy + backend
  redeploy + workflow import). The first tick after deploy will be
  the live test — the dashboard shows each campaign's last decision
  and why.
