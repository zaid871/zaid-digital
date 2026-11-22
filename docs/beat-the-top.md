# Beat-the-Top loop

Built 2026-11-11. The marketing workflow that tracks the #1 in every
field (ebook / template / POD) on every platform (KDP, Etsy, YouTube,
Reddit, Instagram, Facebook, X, Pinterest) and measures the gap to our
own numbers, so the next cycle can close it.

User's instruction: "haan bana do lekin koi cheez manual krne ki mt
rakho hr cheez ko koi jugaad se shi automate kr do" — build it, but
nothing manual; automate everything, somehow.

## How #1 is found (no manual step)

| Platform | Source | Key needed |
|---|---|---|
| YouTube | Data API v3: top video by views + channel stats | YOUTUBE_API_KEY (free, optional) |
| Etsy | Open API v3: top listing by favorites | ETSY_API_KEY (free, optional) |
| Reddit | Public JSON: top weekly post in the niche subreddit | none |
| KDP | Amazon public pages: Kindle search -> #1 ASIN -> product page Best Sellers Rank | none |
| Instagram / Facebook / X / Pinterest | Public profile page `og:description` ("12.3K Followers...") with a browser User-Agent — the same numbers any logged-out visitor sees | none |

Social handles come from the YouTube winner's channel description
(creators link their socials there). A registry entry — set once via
`POST /api/v1/marketing/beat/competitors` — wins for IG/FB/X/Pinterest
handles, Reddit subreddit and KDP ASIN. YT/Etsy are always auto: the #1
IS whoever tops the search.

## The loop (weekly, Sunday 09:00 IST)

`digital-beat-the-top.json` (4 nodes): schedule -> POST /beat/collect
-> POST /beat/analyze -> report.

1. **Collect** (`POST /api/v1/marketing/beat/collect`): auto-discovers
   #1 per field x niche x platform and fetches every benchmark. Our own
   numbers come from the goal-loop ledger (latest run per
   productKey::channel). Body is optional: `{ fields: [{ field,
   niches }] }` — without it, all three fields over
   `DIGITAL_MINER_NICHES`.
2. **Analyze** (`POST /api/v1/marketing/beat/analyze`): gap per target
   (beating / closing / behind / unknown) + the actions that close it
   (bestseller style angles for the niche, via `analyzeBestsellers`
   with `includeYouTube: false, includeEtsy: false` — it reuses the
   collected evidence). The #1's metric is written as the goal-loop
   **north star** for that productKey::channel, so the existing Sunday
   goal-loop sweep flags the gap automatically. The plan is saved to
   `storage/marketing/beat/latest.json`.
3. **Read**: `GET /api/v1/marketing/beat/latest` returns the plan.

Gap math: score = lowerIsBetter ? their/ours : ours/their (ours > 0).
beating >= 1, closing >= 0.7, else behind. BSR is lower-is-better
(inverted). `ourValue: null` (we never recorded that metric) -> status
`unknown` + the plan notes to record it via
`POST /api/v1/marketing/goals/record` first.

## The jugaad, honestly

- **Walled platforms degrade, never fake.** If IG/FB/X/Pinterest
  serve a login wall, or Amazon serves a bot wall, or any fetch 429s,
  the run records `competitor_blocked_*` + keeps the last-known value
  and retries next week. The user is never asked to fetch a number by
  hand.
- **No session tokens, no unofficial APIs, no login bypasses** to force
  a number — the same standard as the Meta AI WebSocket refusal. The
  loop reads only what the platform shows logged-out visitors.
- **X is the weakest lane.** x.com profile pages are usually
  login-walled now, so X benchmarks will usually be last-known +
  warning until/unless X opens up. Same risk for IG if Meta tightens
  public pages further.
- **POD has no public sales data.** Printify/Redbubble/Teepublic
  publish no per-product sales — the POD field is measured through
  Etsy listings (where POD products actually sell) and YouTube/Reddit
  demand, not through POD marketplaces directly.
- **#1 moves.** The registry is re-discovered every run; a stale
  registry entry is overwritten by the fresh auto-discovery only for
  YT/Etsy — social/KDP/Reddit registry entries stay until the user
  replaces them.
- **This is a loop, not a switch.** One run measures; beating #1 takes
  weeks of iteration. No outcome is promised — the plan gives the gap
  and the next actions, and the next run shows whether the gap closed.

## Files

- `src/lib/marketing/beat.ts` — registry, discovery, collection
  (YT/Etsy/Reddit/KDP/public-page), gap math, plan.
- `src/lib/marketing/goal-loop.ts` — `GoalStore.setNorthStar()`
  (creates the goal stub without touching history or max-targets).
- `src/app/api/v1/marketing/beat/competitors/route.ts` — GET/POST registry.
- `src/app/api/v1/marketing/beat/collect/route.ts` — POST collect.
- `src/app/api/v1/marketing/beat/analyze/route.ts` — POST analyze.
- `src/app/api/v1/marketing/beat/latest/route.ts` — GET latest plan.
- `n8n/workflows/digital-beat-the-top.json` (+ `scripts/gen-digital-beat-top.py`).
- `scripts/test-beat-top.ts` — 47/47, all fetches stubbed.

## Verification

- `test-beat-top.ts` **47/47**: parsers (counts, BSR, ASIN,
  og:description, followers, social handles), gap math both
  directions, full stubbed collect (YT 250K views, Etsy 8500
  favorites, Reddit 3400 upvotes, KDP BSR 1234 auto / 567 registry,
  IG registry handle 8100, X login wall -> no benchmark + warning,
  Pinterest skipped), analyze (behind 80%, beating, BSR inverted,
  unknown), north-star wiring (ledger updated, stub goal has no
  history), plan file round-trip.
- tsc/eslint/build green; `validate-workflows.py` passes the new
  workflow.
- NOT live-tested: no real collect has run (needs deploy + YOUTUBE /
  ETSY keys in `.env` + the n8n import). First real run is the Sunday
  09:00 IST sweep after deploy. The sandbox cannot reach Amazon or
  Instagram public pages reliably, so the first live KDP/social
  benchmarks will be measured on the VM.
