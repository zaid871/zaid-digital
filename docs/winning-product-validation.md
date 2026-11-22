# Winning Product Validation — Utkarsh Gose

Source: Utkarsh Gose, "How To Find A Winning Digital Product"
(25:27) — https://www.youtube.com/watch?v=NW5u7d4Z3iM

## The method (from the video)

A winning product is the right MATCH of product + customer (key and
lock), not hidden treasure. Ask what need already exists that people
pay for.

1. **Paisa Trail** — competition = demand signal. Where people already
   spend money, look there first. Don't copy — differentiate (Angle Shift).
2. **Meta Ad Library (free)** — search the words sellers use in ads
   ("e-book", "templates", "bundle", "instant download"), in English
   AND Hindi. It does NOT show sales — use the Three Signal Test to infer.
3. **Three Signal Test** — Time (how long has the ad run? weeks/months
   = likely working; beware forgotten low-budget ads), Versions (how
   many DIFFERENT ads for the same product? 15 versions = actively
   testing/improving), Crowd (how many DIFFERENT unrelated pages sell
   the same kind? 5–6 = demand; 500 = too late).
4. **Proof List** — 10 ideas with all three signals, backed by market
   evidence, not guesses.
5. **Shikayat Mining** (complaint mining) — 3 places: (a) Instagram
   comments on sellers' reels (price/link questions = buying intent;
   complaints = feature gaps); (b) YouTube search autocomplete +
   comments on high-view videos (repeated questions = opportunity);
   (c) reviews — DON'T just read 5-star ("very good, nice" = useless)
   or 1-star (angry); **3-star reviews are gold**.
6. **Lekin Line** — in 3-star reviews customers write "achha hai
   lekin..." (good BUT...). E.g. "good but too long", "good but
   examples aren't Indian", "good but not for beginners". Collect 5
   such complaints — they reveal the gap. Keep customers' EXACT words
   (don't paraphrase) for ads/sales copy later.
7. **Angle Shift** — 3 ways to stand out: (a) narrow the audience
   (resume templates → specifically for freshers with no experience);
   (b) change language/examples (English/foreign examples → easy
   Hinglish + Indian examples); (c) change the format (a 200-page
   ebook people call too long → the same info as a checklist or
   ready-made template; an ebook tells WHAT to do, a template helps
   DO it faster). Never copy someone else's content; don't compete on
   price alone.
8. **4D Filter** (4 questions, 10 min) — Dard (is the problem
   bothering the customer RIGHT NOW?), Demo (can you show the result
   in 5 seconds?), Daam (full price math — ad cost + GST + gateway
   fees + refunds; can a useful second product improve total
   earnings?), Delivery (can YOU build it in ONE WEEK with current
   skills, good enough for real benefit? how fast does the customer
   see the benefit?). 4/4 yes → proceed; 3/4 → fix the weak one
   first; ≤2/4 → reconsider before investing.
9. **₹1000 Test** — a small paid Meta ads test (3 ads, funnel-stage
   diagnosis). **NOT built — paid ads conflict with free-first.**
10. **When to drop** — try 3 different angles/hooks; if people scroll
    past every time, drop it and try the next Proof List idea. Attach
    to the customer's PROBLEM, not your product.

(All ₹ figures above are the video's own examples, labelled as such.
The system itself never puts prices in generated output.)

## What was built

| File | What it does |
|---|---|
| `src/lib/digital/briefs.ts` — Winning-product validation section | Pure Three Signal Test scorer (ad age, version count, seller count + saturation cap, default 500; per-signal pass/partial/fail + evidence, score 0–6, verdict strong / moderate / weak / saturated; `formatProofList()` formats 10 ideas with signal evidence; `adSummaryToInput()` maps Ad Library summaries into scorer input) AND the pure 4D Filter gate (four 0–1 scores with a short reason each; verdict proceed / fix_weak / reconsider + weakest D + guidance; the video's exact rule 4/4, 3/4, ≤2/4). Consolidated 2026-11-20 from `three-signal.ts` + `four-d-filter.ts` (deleted) per the consolidate-don't-duplicate rule. |
| `src/lib/digital/bestsellers.ts` — Lekin Line section | Pure Lekin Line extractor. Input: review text + stars. Output: the "but" gap clause in the customer's exact words, or null. Handles Hindi (lekin, par, magar, phir bhi — Roman + Devanagari) and English (but, however, although, though) markers. `collectGaps(reviews, limit=5)` prefers 3-star reviews, dedups, returns top 5. NEVER invents review text. Consolidated 2026-11-20 from `lekin-line.ts` (deleted) per the consolidate-don't-duplicate rule. |
| `src/lib/digital/prompts.ts` — Angle Shift section | Angle Shift strategies (`narrow_audience` / `language_examples` / `format_change`) with description + the video's example + prompt line each. `recommendAngle(gaps, productKind)` picks the best angle from Lekin Line gaps ("too long" → format_change, "examples aren't Indian" → language_examples, "not for beginners" → narrow_audience); null when no gap matches. Consolidated 2026-11-20 from `angle-shift.ts` (deleted) per the consolidate-don't-duplicate rule. |
| `src/lib/discovery/meta-ad-library.ts` (273 lines, own file — kept) | Meta Ad Library adapter (`GET https://graph.facebook.com/v21.0/ads_archive`, token from env `META_AD_LIBRARY_TOKEN`). `searchAds(keywords, country)` returns per-ad {startedAt, page, creative body/title, active}; `summarizeAds()` aggregates into oldest-ad age / distinct creatives / distinct sellers — the Three Signal inputs. Never throws; no token / 401 / 429 / bad JSON → warnings. Kept as its own file: a distinct external data source, the same pattern as `osm-businesses.ts` (Overpass source, own file, not in the discovery barrel); forcing it into `filter.ts` (compliance pre-filter) or `problem-miner.ts` (keyless suggest/Reddit sources) would mix unrelated concerns. |
| `src/lib/digital/briefs.ts` (+fields) | Optional `threeSignal` and `fourD` fields on `Brief`, plus a pure `attachValidation(brief, scores)` helper. The brief generation flow is unchanged — scores are attached after separate scoring. |
| `src/lib/digital/ebook.ts` (+angle) | Optional `angle?: AngleShift` on `EbookRequest`; a short angle instruction line goes into the outline + chapter prompts when set (no angle = unchanged behaviour). Recorded in the manifest. |
| `src/lib/digital/templates.ts` (+angle) | Optional `angle?: AngleShift` on `TemplatePackRequest`; the line goes into the AI-copy prompt when set. Recorded in the manifest. |

No n8n workflow was changed. No route was changed (the `angle`
field is lib-level for now; route exposure is future work — the
auto-generate tick sends no angle, so scheduled generation is
unaffected).

## How it fits the existing systems (complementary, not replacements)

- **Problem Miner** finds problems; the Three Signal Test validates
  whether sellers already make money on them.
- **Fix My Itch** finds product ideas from complaints; the Lekin Line
  mines complaints about COMPETING products (their gaps = our angle).
- **Customer Finder** finds buyers; Shikayat Mining finds what
  buyers complain about.
- **Beat-the-Top** tracks #1 per field; the Proof List is the
  pre-build version of the same instinct (evidence before investing).
- The 4D Filter is the gate BEFORE a brief becomes a build; the
  brief's `threeSignal`/`fourD` fields carry the evidence for the
  human pick.

## Usage

```ts
import { searchAds, summarizeAds } from "@/lib/discovery/meta-ad-library";
import {
  scoreThreeSignals,
  adSummaryToInput,
  formatProofList,
  runFourDFilter,
  attachValidation,
  type Brief,
} from "@/lib/digital/briefs";
import { collectGaps } from "@/lib/digital/bestsellers";
import { recommendAngle } from "@/lib/digital/prompts";
import { generateEbook } from "@/lib/digital/ebook";
import { generateTemplatePack } from "@/lib/digital/templates";

// 1. Demand evidence from the Ad Library (needs META_AD_LIBRARY_TOKEN).
const found = await searchAds(["ebook", "templates"], "IN");
const summary = summarizeAds(found.ads);
const input = adSummaryToInput(summary);
const three = input ? scoreThreeSignals(input) : null; // strong | moderate | weak | saturated

// 2. Gaps from real 3-star reviews → angle.
const gaps = collectGaps(reviews /* {text, stars}[] */, 5);
const angle = recommendAngle(gaps.map((g) => g.gap), "ebook"); // null when no match

// 3. Gate the idea before investing.
const fourD = runFourDFilter({
  dard: { score: 1, reason: "complaints show it hurts now" },
  demo: { score: 1, reason: "before/after in 5 seconds" },
  daam: { score: 0, reason: "ad cost eats the margin" },
  delivery: { score: 1, reason: "buildable in one week" },
}); // → fix_weak, weakest = daam

// 4. Attach to a brief for the human pick; pass `angle` into generation.
const brief: Brief = attachValidation(brief, { threeSignal: three ?? undefined, fourD });
await generateEbook({ topic, angle: angle?.angle ?? undefined, ... });
await generateTemplatePack({ niche, angle: angle?.angle ?? undefined, ... });
```

## Test results (run 2026-11-20, all local, no live calls)

Consolidated suites (merged into the target modules' test files —
`test-winning-*.ts` deleted 2026-11-20):

| Test file | Passed |
|---|---|
| test-digital-briefs.ts (was 22; + Three Signal 28 + 4D Filter 12) | 62/62 |
| test-digital-bestsellers.ts (was 24; + Lekin Line 21) | 45/45 |
| test-digital-prompts.ts (was 12 executed; + Angle Shift 14) | 26/26 |
| test-discovery.ts (was 27; + Meta Ad Library 26, mocked fetch) | 53 checks, 0 failed |
| **New total (the 101 Utkarsh tests)** | **101/101** |

Regression (edited files): test-digital-ebook 14/14,
test-digital-templates 68/68.
`npx tsc --noEmit`: 0 errors. `npx eslint` on all changed files:
0 errors, 0 warnings.

## Consolidation (2026-11-20)

Per the user's consolidate-don't-duplicate rule (2026-11-20): the
5 Utkarsh modules built as separate files were merged into the
existing modules for their concerns, and the separate files were
deleted. `three-signal.ts` + `four-d-filter.ts` → `briefs.ts`
(Winning-product validation section); `lekin-line.ts` →
`bestsellers.ts` (Lekin Line section); `angle-shift.ts` →
`prompts.ts` (Angle Shift section); the 5 `test-winning-*.ts`
suites were merged into the target modules' test files. All
exported function/type names and signatures are identical — a pure
move, no behaviour change. `meta-ad-library.ts` was KEPT as its own
file: it is a distinct external data source, the same pattern as
`osm-businesses.ts` (Overpass source, own file, not in the discovery
barrel); forcing it into `filter.ts` or `problem-miner.ts` would mix
unrelated concerns. `briefs.ts` grew to 674 lines (was 440) — the
validation section is cohesive, but if it grows further it should be
split by concern, not by source video.

## What was NOT built, and why

- **₹1000 Test** — a paid Meta ads test. Paid ads conflict with
  free-first; the rest of the method (free Ad Library + complaints +
  4D Filter) is the free equivalent. Never auto-build a paid test.
- **The video's paid Masterclass pitch** — a sales pitch for the
  creator's paid course, not a method. Not transferred.
- **Revenue/earnings claims** — the video's claims about what sellers
  earn are the creator's, unverified. Nothing in this build repeats
  them as fact.
- **Shikayat Mining collectors** (Instagram comments, YouTube
  autocomplete/comments) — the video's places 1–2 need live
  platform access (IG comments need a token; YouTube comments need
  the API). The Lekin Line extractor is built and ready to run on
  any review text; the collectors are future work, not invented here.
- **Route/workflow wiring for `angle`** — the angle field is
  lib-level; no route or n8n workflow passes it yet. Deliberately
  small: scheduled generation is unaffected.

## Honest limits

- **Meta Ad Library adapter is NOT live-tested.** It needs
  `META_AD_LIBRARY_TOKEN` in the VM `.env` (file method, never
  chat). Until a real search returns ads, treat it as code-complete
  only. The token is a Meta Graph API token — not the Cloudflare
  token, not an IG/FB publishing token.
- **The Ad Library shows no sales.** Spend/impressions exist only
  for political ads. Time/Versions/Crowd are inference, not proof —
  and a long-running ad can also be a forgotten low-budget ad (the
  video's own warning).
- **Thresholds are the video's numbers** (30 days, 10 versions,
  500 sellers) — judgement calls, exported as constants so they can
  be tuned. They are not measured facts.
- **Lekin Line needs real review text.** The system has Etsy
  review-count validation, but `ETSY_API_KEY` is still pending, so
  live Lekin Line on Etsy reviews is future work. Never feed it
  invented reviews — it extracts only from supplied text.
- **"par" is ambiguous** (Hindi "but" vs "on"). In review text it
  usually means "but"; a wrong extraction is possible. The 3-star
  preference and dedup limit the damage; a human still reads the
  gaps before acting.
- **International targeting:** all patterns are locale-agnostic
  (English + Hindi markers, no hardcoded currency). The video's ₹
  figures appear in this doc only as the video's own examples.
