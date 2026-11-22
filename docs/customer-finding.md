# Customer Finding — what was added from the four repos

**Date:** 2026-11-16. **Status:** built, tested (42 + 11 checks), tsc 0.
**Licences:** first-customer-finder MIT, gosom/google-maps-scraper MIT,
ECC MIT, sellbird AGPL-3.0 (design only — no sellbird code in this repo).

## Why this exists

The system could find PROBLEMS (Problem Miner) and decide WHAT to market
(Marketing Brain), but it had no loop that finds the actual BUYERS for a
product — the first customers. The four repos the user sent all converge
on that one gap: finding customers / leads. This build adds that loop in
the form that fits this system (skill + lib + tests + docs), under the
user's own rules (free-first, no auto-outreach, no fake claims, no
ToS-violating scraping).

## What was added

### 1. Skill — `~/workspace/custom-skills/first-customer-finder/SKILL.md`
Adapted from Kappaemme-git/codex-first-customer-finder-skill (MIT, v2):
product brief → public-signal search plan (5 query buckets) → buying
signals on the prospect's own site → weighted qualification → draft-only
outreach → report + saved history → feedback refinement. Adapted for
Muse: Hinglish allowed, halal rules, no auto-send, history at
`workspace/customer-finder/<product-slug>/`, the repo lib replaces the
upstream Python helpers.

### 2. Lib — `src/lib/marketing/customer-finder.ts`
- `scoreProspect()` — weighted 0–100 (pain 25, fit 25, timing 20,
  reachability 15, evidence 15); bands strong ≥80 / promising ≥65 /
  plausible ≥50 / exclude <50. `applyScoreCaps()`: unknown signal date
  caps timing at 2/5; no verified contact route caps reachability at 1/5.
- `CustomerProspect` — stable id (hash of product + canonical entity
  URL, never a rank), stage (`high_intent` / `problem_aware` /
  `trigger_present` / `potential_fit`), evidence ledger (signal date
  kept separate from checked date), warm path, draft (≤90-word opener,
  CTA, role observed/inferred), feedback + outcome status.
- `BusinessLead` + `normalizeBusinessLead()` — gosom Entry record
  (title, categories, address, website, phone, review count/rating,
  lat/lng, plus code, status, timezone, price range, data id); accepts
  both `longitude` and legacy `longtitude`.
- `BUYING_SIGNALS` — 26-signal catalog curated from sellbird's 29
  (discovery/profile/people/contact), every one free to check, each with
  a plain-language meaning.
- `matchCohort()` — cohort-as-query: must-have signals, disqualifiers,
  numeric ranges.
- History: `emptyHistory` / `applyFeedback` (keep/maybe/reject + reason;
  a rejected company is not a rejected industry) / `recordOutcome`
  (new/contacted/replied/not_interested/customer — only the user supplies
  it) / `excludeSeen` (canonical-URL dedup) / `unseenProspects`.
- `publicUrl()` / `canonicalUrl()` — validation + dedup form (strip
  www., twitter→x, default ports, utm_/fbclid/gclid).
- `prospectsToCsv()` — spreadsheet-safe CSV with formula-injection
  escaping (cells starting `= + - @` get a leading `'`).

### 3. Discovery — `src/lib/discovery/osm-businesses.ts`
`searchOsmBusinesses()` — free, legal, keyless discovery via the public
Overpass API (OpenStreetMap), the source sellbird defaults to. Category →
OSM tags (dentist, roofer, plumber, restaurant, gym, salon, hotel…),
bbox search, results normalized to `BusinessLead`. Never throws: HTTP/API
failure returns `{ leads: [], error }`. Honest coverage warning: OSM maps
premises, so some trades are barely present — the function says so when a
search comes back empty instead of padding the list.

### 4. Tests
- `scripts/test-marketing-customer-finder.ts` — 42/42 (scoring + bands +
  caps, ids/urls, lead normalization, signals, cohort, history/feedback,
  CSV escaping/quoting).
- `scripts/test-discovery-osm-businesses.ts` — 11/11 (stubbed Overpass:
  happy path, way center coords, unnamed drop, HTTP 500, fetch throw,
  bad JSON, empty coverage error).

## What was deliberately NOT added (and why)

- **Google Maps scraping at scale (gosom).** The scraper itself was not
  built into the system: scraping Google Maps at scale violates Google's
  ToS, and this system steers away from unofficial routes (same reason
  the unofficial Meta AI route and the automated Reddit/X/LinkedIn
  outreach plan were rejected). What transferred instead: the lead record
  model + the validate-small-first pattern. Discovery uses OpenStreetMap.
- **Sellbird's code (AGPL-3.0).** AGPL code would attach share-alike
  obligations to anything it touches. Only the DESIGN transferred:
  signal catalog, pipeline stages, cohort-as-query, email-verification
  statuses, approval gate. No sellbird code is in the repo.
- **Sellbird's sending + reply handling.** The pipeline's write/send and
  reply-handling stages were not built: this system never sends outreach
  automatically, and cold-email sending to scraped addresses is a consent
  problem. Drafts only; the user approves and sends.
- **ECC (agent harness).** ECC is a Claude Code/Codex/Cursor harness
  (104 MB, hundreds of agent skills) — a tool for coding agents, not a
  business tool. Its marketing-ish skills (`lead-intelligence`,
  `market-research`, `marketing-campaign`) need paid APIs (Exa, X API,
  Apollo/Clay) — against free-first — and duplicate what the other three
  repos give better. One principle transferred: prefer a warm
  introduction path over a cold one (`warmPath` field). Nothing else.
- **Paid discovery sources.** Sellbird lists DataForSEO/Serper/Scavio
  ($0.002–$1.00 per 1,000). Not wired in — free-first. They are named in
  the skill's limits as a future paid opt-in, never a default.

## How it plugs into the existing system

- **Problem Miner → Customer Finder:** the miner finds the problem; the
  finder finds the people/businesses publicly showing that problem for
  the chosen product. Input: a product + its problem; output: a scored
  shortlist with drafts.
- **Fix My Itch:** the pending first-product pick (SME payment-terms
  pack, 82.8) is the first natural subject for a finder run once the
  user picks it.
- **Marketing Brain:** prospect scores are a demand input the brain can
  consume later (not wired — brain v2 candidate).
- **No n8n workflow yet:** finder runs are manual/skill-driven for now;
  a scheduled finder workflow is a later decision, not auto-added.

## Sources (downloaded to `~/workspace/external-repos/`)
- `first-customer-finder-skill/` — Kappaemme-git, MIT.
- `google-maps-scraper-gosom/` — gosom/google-maps-scraper, MIT (topic
  page `github.com/topics/google-maps-scraping` lists 56 repos; the
  top-starred one was taken as the representative).
- `sellbird/` — ethanplusai/sellbird, AGPL-3.0 (design only).
- `ECC/` — affaan-m/ECC, MIT (harness; not integrated).
