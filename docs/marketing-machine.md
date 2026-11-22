# Marketing Machine (2026-11-03)

Poori machine — 4 channels + scoreboard + auto-fallback + pre-sell gate first.

## Channels

| # | Channel | Status |
|---|---|---|
| 1 | Pinterest auto-pins (5-10 distinct angles, weekly) | BUILT (pinterest-volume) |
| 2 | Daily AI video ads | BUILT (ads-daily + DIGITAL_ADS_QUEUE_JSON) |
| 3 | SEO articles (buyer-intent, FAQ, compounding) | BUILT (seo/article.ts + endpoint) |
| 4 | Etsy optimizer (13 tags, front-loaded title, bundles) | BUILT (etsy-optimizer) |

## Orchestrator

`digital-marketing-machine.json` (16 nodes):
`POST /webhook/digital-marketing-machine` (brief) → validate →
strategist plan → pre-sell gate check (ebook/template/pod only) →
Pinterest volume → Etsy optimize → SEO article → report.

Video ads machine ke bahar ads-daily se chalte hain (quota-friendly);
report me reminder aata hai.

## Scoreboard + auto-fallback (built-in, duplicate nahi)

- Scoreboard = goal-loop ledger (har metric ka MAX = target)
- Auto-fallback = weekly sweep (<70% → diagnose + best-config re-apply)
- Winner scale = 3x rule → 5 sub-angles queue
- Weakness audit = 7 checks har sweep me

## Verification

- test-seo-article 10/10, tsc/eslint clean
- Machine workflow: graph + JS syntax validated (16 nodes)
- Zip: 16 workflows + README
