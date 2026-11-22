# Auto-Generate — Fixed Weekly Schedule (2026-11-13)

**Decision (user, 2026-11-13):** sab digital products ki timing fix karo, kuch bhi manually
nahi karna. This REPLACES the 2026-11-08 rule "briefs are a queue, generation never
auto-starts — user picks". The queue is now auto-consumed every Monday; manual
triggering still works (every generation webhook stays callable directly).

## The weekly cycle (all IST)

| Day / time | What runs | Notes |
|---|---|---|
| Mon 07:00 | Problem Miner (`digital-problem-miner.json`, cron `30 1 * * 1` UTC) | Top-10 problems → `storage/problem-miner/latest.json` |
| Mon 07:30 | Idea Briefs (`digital-idea-briefs.json`, cron `0 2 * * 1` UTC) | Briefs queue → `storage/digital/briefs/latest.json` |
| **Mon 08:00** | **Auto-generate tick (`digital-auto-generate.json`, cron `30 2 * * 1` UTC)** | Picks top 3 briefs + supporting rotation, fires generation webhooks |
| Sun 08:00 | Marketing goal loop (`digital-marketing-goal-loop.json`) | Weekly sweep, unchanged |
| Sun 09:00 | Beat-the-Top (`digital-beat-the-top.json`) | Competitor collect, unchanged |
| Daily 07:30/08:30/19:30/20:30 | Marketing campaigns tick | Best-time slots, unchanged |

## What one tick does (16 webhook fires)

1. Reads the briefs queue. No file / empty queue → `ok:false, reason:"no_briefs"`,
   nothing fires. N8N env missing → `ok:false, reason:"webhook_unavailable"`,
   nothing fires.
2. Picks the **top 3 queued briefs by demandScore** that are not already in the
   ledger. For each brief it fires THREE webhooks (fire-and-forget, 30s timeout,
   all in parallel):
   - the product webhook for the brief's productType (template → `digital-template-generation`
     with `kinds`+`theme` from the brief; ebook → `digital-ebook-generation`
     `{topic: niche, title}`; planner → `digital-planners-generation`
     `{title, count: 4}`; spreadsheet → `digital-spreadsheets-generation`
     `{title, kind}` — kind by niche: workout/fitness → `workout`,
     client/business/freelance → `onboarding`, else `budget`);
   - a marketing toolkit companion (`digital-marketing-toolkit-generation`,
     `{productName: title, productType, niche}`);
   - a thumbnail companion (`digital-thumbnails-generation`,
     `{title, subtitle: niche}`).
3. Weekly supporting rotation from the **top brief's niche** (7 fires):
   POD design, prompt library, landing page, docs guide (`"<title> Guide"`),
   niche spreadsheet tracker (`"<title> Tracker"`), brand kit
   (`brandName: top title`), typography kit (`"<niche> Typography Kit"`).
4. Records every fire in the ledger `storage/digital/auto-generate/ledger.json`
   with status `triggered` / `failed` (never fakes a trigger).

## Dedup (ledger)

- A brief is generated **once ever** (briefId + productType). A same-week re-run
  fires nothing.
- Supporting items fire **once per ISO week** (week key + type). A failed fire
  does NOT block the next tick — it is retried the following week (and a manual
  re-run retries it immediately).

## Not in the tick

- **Website templates: NOT triggered.** Still disabled by the user's decision
  (`WEBSITE_TEMPLATES_ENABLED`, default off). Enable separately; then add it
  to the rotation.
- **LUTs / Lightroom presets / icon bundles: NOT in the weekly rotation.**
  They are deterministic one-time generic assets — regenerating them weekly
  would create identical duplicates. They stay on-demand.
- The generation workflows still run their own demand check: a brief with no
  miner match comes back `needs_validation` instead of generating.

## Volume + quota (estimates, not measured)

- Per week: 3 products + 3 toolkits + 3 thumbnails + 7 supporting = **16
  generations (~60/month)**.
- LLM calls/week ≈ 15–20 (ebook ~9 calls if an ebook brief is picked; toolkit
  2 each; docs/prompts/landing 1 each). Images/week ≈ 5 (POD 1, thumbnails 3,
  coloring book 24 if a coloring brief is picked — the tightest quota; watch
  Pollinations free scope).
- Products are KB–MB each — disk impact negligible next to video
  (12–22 GB/month).

## Files

- `src/lib/digital/auto-generate.ts` — `runAutoGenerateTick`, `isoWeekKey`,
  `spreadsheetKindForNiche`, `webhookForBriefType`, `bodyForBrief`,
  `readBriefsQueue`, `readLedger`, `latestAutoGenerate`.
- `src/app/api/v1/digital/auto-generate/tick/route.ts` — POST, `checkN8nSecret`.
- `src/app/api/v1/digital/auto-generate/latest/route.ts` — GET, `checkN8nSecret`,
  ledger tail (last 50 entries).
- `n8n/workflows/digital-auto-generate.json` — 3 nodes: schedule-trigger →
  tick → report. **First import needed.**
- `scripts/test-digital-auto-generate.ts` — **28/28** (stubbed fetch; hermetic —
  wipes its /tmp fixtures on every run).

## Deploy

1. Import `digital-auto-generate.json` (first import; active: False by default —
   activate after import).
2. Backend redeploy (2 new endpoints).
3. No new env vars — reuses `N8N_BASE_URL` + `N8N_WEBHOOK_SECRET` (already in
   `.env.example`).
4. First live tick: Monday 2026-11-16 08:00 IST (needs the miner + briefs runs
   the same morning — both also need deploy + import first).

## Tuning (constants at the top of `auto-generate.ts`)

- `AUTO_GENERATE_TOP_N = 3` — briefs per week.
- Supporting rotation list inside `runAutoGenerateTick` — add/remove types here.
