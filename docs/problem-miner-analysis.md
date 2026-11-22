# Problem Miner Analysis (2026-11-03)

User ne problem-finding strategies bhejin (ebooks + templates + POD ke liye).
Deep analysis: kya gold hai, kya manual rahega, kya FREE me automate ho sakta hai.

## 1. Kya GOLD hai (strategy solid hai)

- **Amazon 3-star strategy:** bestselling books ke 2-3 star reviews = "theory
  achhi thi, step-by-step templates missing the" → seedha ebook topic. Manual
  research me gold.
- **Reddit goldmine:** "How do I...", "I'm struggling with...", "Is anyone
  else sick of..." — raw, unfiltered struggles. Top posts filter.
- **Marketplace deficiencies:** recent reviews me "wish it had X" = gap.
- **Hyper-specific pro-tip:** "How to be Healthy" nahi; "60-hour work week me
  $50 budget par meal prep" bikta hai. Specific problem = easy sell.
- **POD formula:** "That is so me" — 100 log jo obsess karen, everyone nahi.
- **Template golden rule:** time bachao ya chaos organize karo.

## 2. Kya MANUAL rahega (honest — automate nahi ho sakta)

- **Amazon/Udemy/Skillshare/Quora reviews scraping:** bot walls + ToS issues.
  Automated scraping = account/IP ban risk. MANUAL process rahega.
- **Facebook Groups / Discord:** login-walled, silent observe manual.
- **LinkedIn comments:** login-walled. Manual.
- **AnswerThePublic:** freemium, koi free API nahi → Google suggest API use karenge.
- **Upwork/Fiverr job boards:** bot protection. Manual spot-checks.

## 3. Kya FREE me AUTOMATE ho sakta hai (Problem Miner v1)

| Source | Method | Cost |
|---|---|---|
| Reddit problem scan | Public JSON API (`/r/{sub}/search.json`), no key, pain-pattern matching ("how do i", "struggling", "wish there was", "anyone else") + upvotes | $0 |
| Google suggest mining | `suggestqueries.google.com/complete/search` — question expansion ("how to X", "best Y for Z") | $0 |
| Amazon suggest (POD phrases) | `completion.amazon.com/search/complete` — long-tail buyer phrases ("greyhound dog mom shirt") | $0 |
| Google Trends | pytrends (unofficial API) — growing vs dying check | $0 |
| YouTube comments | YouTube Data API free quota (commentThreads.list = 1 unit, 10k/day) — "what system do you use" patterns | $0 |

TikTok comments: koi free API nahi → manual.

## 4. Proposed build: Problem Miner v1

`src/lib/discovery/problem-miner.ts` (pure, App-Route-safe):
- `scanReddit(subreddits[], patterns[])` → problems {text, upvotes, subreddit, url}
- `expandSuggest(seed)` → long-tail questions/phrases
- `trendDirection(keywords[])` → rising/stable/falling (pytrends via bridge, honest "unavailable" on failure)
- `scoreProblems()` → demand score (upvotes + suggest volume proxy + trend)
- Output: problem cards → **pre-sell gate** ko feed (validation) → product backlog

Ye **discovery module ke empty stubs** bharta hai (sources abhi stubs hain;
trendingScore abhi stub hai → real Trends data).

n8n: `digital-problem-miner.json` — weekly schedule → mine → score → top 10
problems report (chat/email) → user picks → pre-sell gate.

## 5. Kya NAHI banega

- Amazon/Udemy/Quora scrapers (ban risk — manual checklist doc me rahega).
- Koi bhi "guaranteed viral niche" claim — scores estimates hain, honest labels.

---

## BUILT — Problem Miner v1 (2026-11-03, user approved)

- `src/lib/discovery/problem-miner.ts`: scanReddit (public JSON API, top/month,
  pain-signal filter, per-subreddit fail-soft) + expandSuggest (Google +
  Amazon Suggest, keyless, pain-only) + trendDirection (pytrends bridge,
  ANY failure → "unknown", never faked) + scoreProblems (deterministic 0-100:
  pain hits, engagement, recency, trend bonus; no AI quota) + mineProblems
  (top-10, deduped).
- `scripts/trends_bridge.py`: pytrends, last-4w vs prev-8w avg (±20% threshold).
- `POST /api/v1/discovery/problem-miner` (x-n8n-secret): saves top-10 to
  `storage/problem-miner/latest.json`.
- `n8n/workflows/digital-problem-miner.json` (4 nodes, weekly Mon 07:00 IST,
  niches from DIGITAL_MINER_NICHES env).
- Review flow: log me top-10 → winners ko /webhook/digital-presell par bhejo.
- Verified: test-problem-miner 14/14 (mocked fetch), tsc/eslint clean.
  Live trends bridge: 429 → "unknown", exit 0 (fail-safe confirmed).
- Deploy-check: pytrends in Dockerfile.app.

## BUILT: Fix My Itch source (2026-11-05)

- `scanFixMyItch()` — live fetch `razorpay.com/m/fix-my-itch/` (15s timeout),
  server-rendered text se problem sentences + Itch Score + category parse
  karta hai. **Live verified in sandbox: 20 live hits, 0 seed, max 82.8.**
- Seed fallback — `FIX_MY_ITCH_SEED` (page se verified 20 problems, 2026-11-05).
  Fetch fail ya empty parse → seed, source label `fix-my-itch-seed` (honest).
- `classifyDigitalFit()` — deterministic ebook/template/both/none (keyword
  rules, no AI quota). Har card par `digitalFit` field.
- Scoring — itch bonus: `min(30, itchScore/3)` (82.8 → +27.6).
- `mineProblems` — itch hits niche-matched (keyword overlap) ya "general";
  `includeFixMyItch` option (default true); endpoint body += same field.
- Test `scripts/test-problem-miner-fixmyitch.ts` **16/16**; purana
  test-problem-miner **14/14** (no regression).
- Caveat: live page sirf visible ~20 problems deta hai (top-10 + first B2B
  page). Poori 10,000 list ke liye data endpoint/pagination abhi nahi mila —
  v2 me dekhenge. n8n workflow unchanged (endpoint same).
