# Digital Idea Briefs — idea kahan se aata hai

**Date:** 2026-11-08
**Status:** Built + verified locally (tests 18/18 + 20/20, tsc/eslint/build green). NOT live-import-tested; backend redeploy pending.

## Sawal

Template/ebook ka idea kahan se aaye — aur professional/premium tareeqe se:
kaunsa kind, kaunsa theme, logon ko kya pasand aa raha hai, usme kya kami
hai, aur hum uniqueness kaise add karein? Jawab: idea guess se nahi, data
se — aur analysis pehle, generation baad mein.

## Idea ke sources (Problem Miner, ab 6)

1. **Reddit** (public JSON) — pain posts ("struggling", "wish there was").
2. **Google Suggest** (keyless) — log kya type kar rahe hain.
3. **Amazon Suggest** (keyless) — khareedne wale phrases.
4. **YouTube Suggest** (NEW — `client=chrome&ds=yt`) — video-search demand.
   `client=youtube` JSONP deta hai (`window.google.ac.h(...)`), `res.json()`
   fail hota hai — isliye `client=chrome&ds=yt` (same YouTube dataset,
   plain JSON). Live-verified: "budget planner" par 13 real hits.
5. **Google Trends** (pytrends) — direction (rising/stable/falling) +
   **rising related queries** (NEW — kya abhi garam ho raha hai).
6. **Fix My Itch** (Razorpay) — 10,000+ verified Indian problems, Itch Score.

## Analysis — brief banne se pehle

`POST /api/v1/digital/briefs` (body: `productTypes`, `maxBriefs` 1–10,
`useAi`) miner ke latest run se ye banata hai:

- **Niche ranking:** problems ka total demand score + trend.
- **Kind/theme mapping (deterministic):** budgeting → chart/table + forest;
  wedding/event → event + wine; study → tips/checklist + dark; fitness →
  checklist/tips + forest; business → promo/sale + dark; social → quote/
  promo + dark; resume → announcement/tips + sand; planner → checklist/
  table + sand. Default: quote/tips + dark.
- **Gap check:** `storage/digital` (apni catalog) mein is niche par kya
  bana hua hai. "Koi pack nahi — pehla mover" ya "N packs hain — naya
  angle chahiye". **Limit:** ye sirf APNI catalog se hota hai — Etsy/
  Gumroad ka poora supply data hamare paas nahi hai.
- **Uniqueness angles:** ek LLM call (saare briefs ke liye ek saath) —
  har brief ko 2 angles; AI fail ho to bank fallback; price/banned-claim
  wala angle drop hota hai (bank se top-up, hamesha 2 angles).
- **Ebook briefs:** 5-chapter outline (AI ya bank) + formats pdf/docx/epub.
- **Analysis summary:** topKinds (kind → demand + trend), topNiches,
  gaps, risingQueries (max 10).

## Queue — generation auto nahi hoti

Briefs `storage/digital/briefs/latest.json` mein queue hote hain.
`GET /api/v1/digital/briefs/latest` se padho, user pick kare, phir
generation workflow (template/ebook/planner/spreadsheets) chalaye.
Miner nahi chala ho to briefs `[]` + `not_mined_yet` warning — kabhi
fake idea nahi.

## Workflow

`digital-idea-briefs.json` (4 nodes): schedule **Mon 07:30 IST**
(miner Mon 07:00 IST ke 30 min baad) → build-body
(`DIGITAL_BRIEF_TYPES` env, default `template,ebook`) → POST
`/api/v1/digital/briefs` → report (briefs + top kinds/niches + rising
queries + warnings). Zip mein shaamil (29 files).

## Verification

- `test-digital-briefs.ts` — **18/18**: mapping (budgeting chart/table +
  forest, wedding event + wine), gap, bank fallback, AI angles + outline,
  price-angle drop, not-mined case.
- `test-problem-miner.ts` — **20/20**: YouTube source (mock + live 13
  hits), risingQueries degrade, mineProblems mein `risingQueries` key.
- tsc + eslint clean, `next build` green, workflow graph + jsCode
  validated (`validate-workflows.py`: idea-briefs PASS; 2 v1-legacy
  files ke 36 errors pre-existing hain — purana format, is build se
  koi lena-dena nahi).

## Bestseller Style Analyzer (NEW 2026-11-08 — gap ka matlab saaf hua)

User ki correction: gap sirf "humne kya banaya" nahi hai. Asli gap ye hai:
**jo templates/ebooks market mein full demand mein hain aur full bik rahe
hain, unka style kya hai, usme kya kami hai, aur usi style mein uniqueness
daal kar apna launch karna** — template aur ebook dono ke liye.

### Kaise (aur kya nahi)

- **Sales data ka koi free API nahi hai** — Etsy/Gumroad/Creative Market
  ki sales numbers proprietary hain; unki pages scrape karna ToS/ban risk
  hai, isliye NAHI karte. Ye limit hai, feature nahi.
- **Best free, legal signals:** YouTube top videos by views (Data API v3
  — free key, 10k units/day, search = 100 units) + miner ke top problems
  (Reddit engagement + Suggest + Trends) + **manual competitor lane** —
  user apni browsing se bestseller ka title/note paste kare (request mein
  `competitors: [{title, source, note}]`).
- **Style analysis signals se hoti hai** (titles/phrases → formats:
  printable/bundle/Canva/editable; styles: minimal/aesthetic/dark/premium;
  audience: students/beginners/...) — competitor ki actual design file
  hum dekhte nahi (copyright + scraping).
- **Har brief mein ab:** `styleProfile` (bestseller style), `marketGap`
  (bestsellers mein kya kami hai), `bestsellerEvidence` (top YT titles /
  manual entries), aur uniqueness angles **usi style mein twist** (brief-
  level AI call ko style + gap prompt mein milta hai).

### Key

`YOUTUBE_API_KEY` — optional, `.env` mein (Google Cloud Console, free,
no billing). Na ho to top-videos step skip hota hai (`youtube_skipped_
no_key` warning), baaki analysis phir bhi chalta hai. Live-verified:
fake key par graceful `[]` (400/403 handle hota hai); real key ke bina
live top-videos verify nahi hue — VM par pehla run batayega.

### Verification (is add-on ki)

- `test-digital-bestsellers.ts` — **20/20**: style extraction, YouTube
  parse + views sort, no-key skip, manual competitor folding, AI
  whats-missing/uniqueness, bank fallback, price-angle drop.
- `test-digital-briefs.ts` — **22/22** (naya competitors integration
  section: style profile + market gap + evidence).
- tsc/eslint/build green. Workflow `digital-idea-briefs.json` regenerate
  hua (`includeYouTube: true` build-body mein) — validate PASS.

## Etsy — analysis us platform se jahan templates bikte hain (NEW 2026-11-08)

User ki requirement: analysis un platforms se aaye jahan templates bikte
aur sale hote hon. Verify karke banaya:

- **Etsy Open API v3 — ekmatra free, legal, programmatic source.**
  Etsy ki apni OpenAPI spec se verify kiya (live fetch): base
  `https://openapi.etsy.com/v3/application`; public listing search
  (`listings/active`) sirf **API key** se hoti hai — OAuth nahi chahiye.
  Header: `x-api-key: keystring:shared_secret` (free app:
  developers.etsy.com → Your Apps).
- **Kya milta hai:** title, price, `num_favorers` (Etsy popularity),
  tags, URL; shop ka `transaction_sold_count` (shop ki TOTAL sales —
  API ka sabse kareebi real sales number); reviews (count + rating).
- **Kya NAHI milta:** per-listing sales count — `num_sold` API mein
  hai hi nahi. Isliye "kya bik raha hai" favorites + reviews + shop
  sales se napta hai, exact "kitne bike" se nahi. Ye limit hai.
- **Creative Market:** koi public API nahi. **Gumroad:** API sirf apni
  khud ki sales ke liye (OAuth, own account) — competitors ke liye nahi.
  Dono ke liye lane: manual competitors (already built) + user ke
  kehne par one-off browser read — scheduled scrape nahi (ToS/ban risk).
- **Wire-in:** `etsy.ts` → `bestsellers.ts` (top 3 niches, query
  `"{niche} template"`, top 5 by favorites + shop sales + reviews) →
  briefs mein `bestsellerEvidence` (`Etsy: title — 2100 favorites —
  340 reviews — shop 3200 sales — url`). Route mein `includeEtsy`
  (default true); workflow build-body mein `includeEtsy: true`.
  Env: `ETSY_API_KEY="keystring:shared_secret"` (.env.example mein steps).

### Verification (is add-on ki)

- `test-digital-etsy.ts` — **15/15**: parse + favorers sort, price
  decode, shop sales + reviews enrichment, no-key skip, 401/429
  warnings, throwing-fetch graceful.
- `test-digital-bestsellers.ts` — **24/24** (Etsy lane section nayi).
- `test-digital-briefs.ts` — **22/22**, miner 20/20, tsc/eslint/build
  green, workflow validate PASS.
- **Live probe (imaandaar):** sandbox se `openapi.etsy.com` tak egress
  timeout hota hai (proxy CONNECT ke baad hang) — fake key par
  `etsy_timeout` warning aayi, graceful skip. Isliye real key ke saath
  pehli live call VM par hogi (deploy ke baad). Code official spec +
  mocked tests se verified hai; endpoint/fields spec se liye gaye hain.

## Caveats (imaandaar)

- **Rising queries live-verify nahi hue:** sandbox mein Google Trends
  block karta hai (pytrends install karne ke baad bhi `unknown`/`[]`) —
  bridge sahi degrade karta hai, lekin pehla real rising data VM par
  Monday ke run mein aayega.
- **Gap = apni catalog, poori market nahi.** Etsy/Gumroad bestseller
  data ke liye koi free API nahi hai; scraping ToS/ban risk hai.
- **Deploy pending:** naye endpoints + miner sources sirf redeploy ke
  baad milenge; tab tak briefs workflow `mine_failed`/warning dega.
- **Live n8n import test nahi hua.**
