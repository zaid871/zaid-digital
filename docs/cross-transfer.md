# Cross-transfer: affiliate <-> digital marketing techniques

**Date:** 2026-11-13. **Status:** built, tested, imported live (59 workflows, all inactive). **NOT live-tested** — first real runs need activation + IG/FB tokens.

## User instruction (verbatim)

> "affiliate k jitne techniques hain un sb ko digital me add kr do aur digital k jitne hain sb k sb affiliate me dal do haan albatta jo digital products k saath khaas hai marketing jaise ki email mark..., campaigns, landing pages wagaira ko chod do"

Plus (21:12 IST): "albatta is ko bhi agr existing workflows me hi add kr do to munasib rhe ga" — integrate into existing workflows wherever feasible; only genuinely standalone scheduled loops get new workflow files.

## What was ported

### Affiliate -> digital

| Technique | Where it landed |
|---|---|
| Analytics auto-collection (IG/FB insights) | NEW `src/lib/publishing/analytics.ts` (`fetchInsights`, `recentRecordsWithInsights`, `collectAnalytics`); runs inside the brain daily route BEFORE `buildDailyPlan`, so today's plan uses fresh views. |
| Weekly reporting | NEW `src/lib/marketing/reports.ts` (`buildWeeklyReport`) + `GET /api/v1/marketing/reports/weekly`; digital goal-loop workflow gained a weekly-report branch (sweep -> GET report -> optional `REPORT_WEBHOOK_URL` post -> log). |
| Link validation | NEW `src/lib/publishing/validate-link.ts` (`checkLink`: private-host gate, HEAD-then-GET, 10s timeout) + `POST /api/v1/publishing/validate-link`; ads-marketing validates the product link BEFORE creating the ad job (unreachable -> 400, no job created). |
| Standalone QC workflow | NEW `src/lib/publishing/qc.ts` (`runQcCheck`: job exists/completed, video exists, price pattern, banned claims, link reachable) + `POST /api/v1/publishing/qc-check`; ads-marketing gates reels on it: pass -> publish, review -> needsReview, fail -> qc_failed. |
| Error recovery | NEW `n8n/workflows/digital-error-recovery.json` (clone of affiliate/error-recovery, webhook `digital/error-sweep`); `errorWorkflow` set on all digital workflow files. **Caveat below — NOT live via CLI import.** |

### Digital -> affiliate

| Technique | Where it landed |
|---|---|
| Goal loop (gaps sweep) | Affiliate weekly-reporting gained a `sweep-goals` fork (POST `/api/v1/marketing/goals/sweep`, 600s timeout) off build-report; the report item still flows to post-report/log-report unchanged. |
| Brain deepening (past performance) | `src/lib/marketing/brain.ts`: affiliate videos scored with goal-loop history (keyed by jobId) + their history feeds the shared median campaigns use. A hot affiliate video (500 views, median 120) scores 91 vs a fresh video's 70. |
| Season mode | `POST /api/v1/discovery/season-rank` (neutral demandScore 50 + season +25 via `rankWithSeason`); affiliate discovery inserts season-rank -> apply-ranking between dedup-filter and has-products. Ranking is a nudge, never a gate (falls back to dedup order on failure). |
| Pinterest volume | NEW `n8n/workflows/affiliate/pinterest-volume.json` (clone of digital-pinterest-volume; Wed 06:30 IST, 7 pins; queue from `AFFILIATE_PINTEREST_QUEUE_JSON`; same generic endpoint). |
| Auto-DM | Branch inside the EXISTING `affiliate/instagram-auto-dm.json` build-dm node (see below). |

### Record enrichment (both directions)

All 4 IG/FB publishing workflows + website-listing + quality-control now carry `jobId` into the publish record. `PublishRecord.productId` is a FOREIGN KEY to `Product.id` — a name/slug there would throw an FK violation, so only `jobId` (plain `String?`) is sent. This fixes a latent bug: the brain's `collectInputs` reads publishRecord BY jobId, which was always NULL before, so publishedIds was always empty.

## Already shared — honestly NO build (verified in-repo)

- **Repost loop:** the sweep at `src/app/api/v1/publishing/sweep/route.ts` loads ALL published IG reels from the shared records table (platform filter only) — digital reels are already covered. A second loop would double-publish the same variant.
- **Backup-monitoring:** checks the shared backend; covers digital indirectly.
- **Buyer-psychology copy:** already in the shared backend script.ts (affiliate scripts get the prompt lines).
- **Website listing:** digital's landing-page + ads flow does this work.

## Excluded (digital-specific, per the user's "wagaira")

Campaigns, email marketing (nurture + freebie + review-request emails), landing pages, presell/PMF, auto-generate, marketing machine + strategist, beat-the-top.

## The Auto-DM constraint

Meta allows ONE webhook callback URL per app. A separate digital auto-DM workflow could never receive comment events. Solution (user-approved): a media-based branch inside the existing affiliate workflow's build-dm node. A mediaId in `DM_DIGITAL_LINK_MAP_JSON` gets `DM_DIGITAL_TEMPLATE` with NO affiliate disclosure (`lane: "digital"`); everything else keeps the affiliate template + disclosure. Price gate and 900-char gate apply to both lanes. `DM_KEYWORDS` must include digital keywords (e.g. RSVP) for the keyword-match node to route digital comments.

## New backend surface (needs redeploy)

- `GET /api/v1/marketing/reports/weekly` — week (Monday UTC), totals, byChannel, top 5 posts, gaps, calibration (last 30 brain plans), notes (views are not sales; cold-start note).
- `POST /api/v1/publishing/validate-link` `{url}` — reachable true/false + status/note. Private hosts (localhost, RFC1918, .local) are never fetched.
- `POST /api/v1/publishing/qc-check` `{jobId, caption?, productLink?}` — checks + verdict pass/review/fail. Fail = job missing / not COMPLETED / no video / banned claim. Review = price pattern or unreachable link.
- `POST /api/v1/discovery/season-rank` `{products: [{title?, url?, category?, description?}]}` — products + `_seasonScore`/`_seasonId`/`_seasonLabel`, sorted desc.
- Brain daily route: `collectAnalytics({now})` runs before `buildDailyPlan`; payload gains an `analytics` summary. Campaign goals keep primaryMetric "posts" (so tick runs never read as 0 views); new affiliate goals use "views".

## New env vars (all optional, commented in .env.example)

`DM_DIGITAL_LINK_MAP_JSON`, `DM_DIGITAL_TEMPLATE`, `AFFILIATE_PINTEREST_QUEUE_JSON`, `REPORT_WEBHOOK_URL` (unset = report only logged).

## Honest caveats

1. **errorWorkflow is NOT live.** n8n 2.43.7's CLI `import:workflow` silently drops the top-level `errorWorkflow` field — verified 2026-11-13 by re-importing 11 workflows with live workflow IDs as the value; the live export shows 0 workflows with errorWorkflow. The repo files carry the field (affiliate convention), but error routing needs the REST API (PATCH with an API key) or the n8n UI. Because of this, the remaining digital workflows were NOT re-imported just for the field — their nodes didn't change.
2. **NOT live-tested.** Tests are repo-side only (see below). First real runs need activation + IG/FB tokens, which don't exist yet.
3. **Generator caveat:** only `gen-digital-goal-loop.py` and `gen-auto-dm.py` emit `errorWorkflow`; regenerating other digital workflows from their gen scripts loses the field. `gen-auto-dm.py` was fixed to emit long-form connections (`{"node", "type": "main", "index": 0}`) — n8n 2.x import rejects short form (this blocked the auto-dm re-import once).
4. **DB surgery lesson:** after copying a checkpointed `database.sqlite` back, remove the stale `-wal`/`-shm` on the host with `sudo` BEFORE restarting n8n, or the old WAL replays and the export fails with SQLITE_CORRUPT (happened 2026-11-13; removing the stale wal/shm fixed it, the DB itself was fine).

## Verification (2026-11-13)

- Tests: 91 new checks + brain 45/45 + auto-dm 34/34; regressions green (campaigns 35/35, seasons 27/27, auto-generate 28/28, carousel 12/12, multi-platform 24/24, goal-loop 31/31). `python3 scripts/validate-workflows.py` (top-level 42 PASS + 2 pre-existing v1-legacy FAILs; affiliate/ 20/20 PASS). `npx tsc --noEmit` 0, eslint 0, `npm run build` 0.
- Live n8n (158.180.19.153): export AND database agree — **59 workflows, all inactive, no duplicates**. New nodes confirmed in the live export (link-check, qc-check, weekly-report, sweep-goals, season-rank, digital DM lane, jobId in triggers).
- Test files: `scripts/test-publishing-analytics.ts`, `test-marketing-reports.ts`, `scripts/test-publishing-validate-link.ts`, `scripts/test-publishing-qc-check.ts`, `scripts/test-discovery-season-rank.ts`, `scripts/test-digital-ads-marketing.ts`; additions in `test-marketing-brain.ts` and `test-auto-dm.ts`.
