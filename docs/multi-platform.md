# Multi-platform publishing (Pinterest / X / LinkedIn / Reddit / Quora / Threads)

Analyze-then-promote: for each product the system ranks the six platforms
by fit, publishes automatically where a free API exists, and prepares a
manual draft where it doesn't. Funnel truth: Reels = discovery, the
intent channels (Quora / Reddit / X / LinkedIn / Threads) = intent +
conversion — ebooks and informational products sell where buyers are
already asking the question, not from watching a reel.

## The analyzer — `src/lib/publishing/platform-fit.ts`

Pure, deterministic rule table over the 8 discovery categories. `fitFor()`
returns all six platforms ranked high → low, each with reasons and a
`publishMode`:

| Product type | Pinterest | X | LinkedIn | Reddit | Quora | Threads |
|---|---|---|---|---|---|---|
| kitchen / household / useful_physical | **high** (visual search) | low | low | low/low/medium | low | medium |
| digital_products_templates | **high** | medium | **high** | medium | medium | **high** |
| computers_ai_tools | low | **high** (manual) | **high** | **high** | **high** | **high** |
| electronics / mobile_accessories | medium–high | **high** (manual) | medium/low | medium | medium/low | medium |

`autoPlatforms()` = high/medium fit with free API. `manualPlatforms()` = X + Quora.
Reddit carries a self-promotion warning in its fit `note` (see below).

## Publishers — `src/lib/publishing/`

All copy is compliance-scanned (price/banned patterns → publish blocked)
and gets the affiliate disclosure appended (`social-copy.ts`).

- **pinterest.ts** — `POST https://api.pinterest.com/v5/pins` (free, API v5).
  Image pin from a public URL + board. Needs `PINTEREST_ACCESS_TOKEN`
  (scopes `boards:read/write`, `pins:read/write`) and `PINTEREST_BOARD_ID`.
  Note: new apps start on **Trial** access — pins are visible only to you
  until Standard access is granted (requires an OAuth-flow demo).
- **linkedin.ts** — `POST https://api.linkedin.com/rest/posts` (free).
  "Share on LinkedIn" product, self-serve, scope `w_member_social`; posts to
  your own profile. `escapeLittleText()` escapes all 15 reserved characters
  (`\ | { } @ [ ] ( ) < > # * _ ~`) — unescaped, LinkedIn truncates/rejects
  the post. 150 requests/member/day, tokens ~60 days. A bare URL posts as
  clickable text (no preview card without an Images-API thumbnail upload).
- **threads.ts** — `POST https://graph.threads.net/{user-id}/threads` then
  `POST https://graph.threads.net/{user-id}/threads_publish` (free,
  official Meta API). Same container-then-publish shape as Instagram.
  Text-only posts, max **500 chars**; the copy builder trims the value
  text to fit and never drops the link or the disclosure (if even
  name + link + disclosure cannot fit, it throws `validation` instead
  of posting a broken post). Needs `THREADS_ACCESS_TOKEN` (scopes
  `threads_basic`, `threads_content_publish`) and `THREADS_USER_ID`.
  Limits: 250 API-published posts per profile per rolling 24h, max 5
  unique links per post (ours carry 1). Tokens last ~60 days. Single
  default profile for now — per-niche Threads profiles are a later
  step; the IG/FB accounts registry is not reused here.
- **x.ts** — **draft only, no API call.** Since 6 Feb 2026 the X API is
  pay-per-use for new developers: **$0.20 per post with a link** (~$10/mo for
  50 posts). The old free tier is closed. `buildXPost()` composes a ≤280-char
  post (t.co-counted); you post it manually in the X app (free).
- **intent-drafts.ts** — **drafts only, no API call, no fetch at all.**
  `buildIntentDrafts()` returns all three manual-lane drafts for one
  product: a Quora answer, a Reddit self-post draft, and an X thread.
  See "Intent channels (manual drafts)" below.
- **reddit.ts** — `POST https://oauth.reddit.com/api/submit` (free tier).
  **Dead code since 21 Nov 2026: the router no longer calls it.** Reddit
  closed self-service Data API access on 11 Nov 2025, stopped accepting
  new access requests on 31 Oct 2026, and ends public API access in
  Mar 2027 — no client ID/secret/token can exist for this app, so the
  router returns a manual draft instead (see below). Kept for the record;
  it fails honestly with `not_configured` if ever called without tokens.
  Link post by default (`kind=link`); text posts (`kind=self`) supported.
  Reddit access tokens last **1 hour**, so the publisher refreshes the token
  on **every** publish call from `REDDIT_REFRESH_TOKEN`
  (`POST https://www.reddit.com/api/v1/access_token`,
  `grant_type=refresh_token`, HTTP Basic auth). Needs `REDDIT_CLIENT_ID`,
  `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_USERNAME` (for the
  required descriptive User-Agent) and a target subreddit — per call via the
  route body's `subreddit`, or the `REDDIT_SUBREDDIT` env default. Titles
  carry the short `(affiliate link)` marker; text-post bodies get the full
  disclosure. Errors are typed (`token_missing` / `token_refresh_failed` /
  `submit_failed` with Reddit's returned detail) — never a fake success.

## Reddit — honest limits

- **BLOCKED 21 Nov 2026 — no API access obtainable for new developers.**
  Reddit closed self-service Data API access on 11 Nov 2025, stopped
  accepting new public API access requests on 31 Oct 2026, and ends
  public Data API access in Mar 2027. App creation fails with "Max
  clients have been reached" (tried 3×). No client ID/secret/token can
  exist for this app — the publisher below is **dead code until/unless
  Reddit reopens access**, kept for the record, never to be called
  without real tokens (it fails honestly with `not_configured`).
  Devvit does NOT help: it runs apps inside Reddit, it is not a
  server-side posting API.
- **Account exists for manual posting:** u/zaiddigitalofficial
  (https://www.reddit.com/user/zaiddigitalofficial/) — a human can post
  from it, the same way X drafts work (system prepares, human posts).
- **Self-promotion is policed by the community, not just the API.**
  New/low-karma accounts get auto-removed by many subreddits, and every
  subreddit has its own rules (some ban links outright, some require a
  karma/age minimum, some allow self-promotion only on certain days).
  A `published` result means Reddit **accepted** the submission — not that
  it survived moderation or stayed visible.
- **Post value-first.** Link posts that read as ads get downvoted/removed
  and can get the account flagged. Prefer subreddits where the product
  genuinely answers a question being asked.
- **No test post has been made** — the publisher is stub-tested only (see
  `scripts/test-publishing-reddit.ts`).

## Intent channels (manual drafts) — `src/lib/publishing/intent-drafts.ts`

**The funnel:** Reels create discovery, they don't close ebook sales.
Buyers come from intent — someone already asking the question the
product answers. `buildIntentDrafts(product, { question?, subreddit? })`
returns all three manual-lane drafts as pure text (no fetch, nothing
posted). Every draft is compliance-scanned (price/banned claims block
it) and carries the affiliate disclosure.

| Lane | Why manual | Draft |
|---|---|---|
| Quora | **No public API at all** (verified 21 Nov 2026) | `buildQuoraAnswer()` — value-first answer, ~150-250 words: direct answer first, what was checked, then the product as the resource. Never a bare link-drop. `question` (Problem Miner output) shapes the answer. |
| Reddit | Data API **closed to new developers** (see above) | `buildRedditDraft()` — title (≤300 chars, `(affiliate link)` marker) + self-post body. Subreddit is required from the caller or left **empty for the human to fill — never invented**. |
| X | API is **pay-per-use** ($0.20/post with link) | `buildXThread()` — 3-5 posts summarising the product's **key points** (features/benefits, one per post), not a teaser + link. Auto-posting a single link gets low reach; the thread carries the value and the link goes in the **last** post. Each post ≤280 chars (t.co counted). |

**Router behaviour:** `multiPublish()` returns status `"draft"` (never
`"published"`) for quora/reddit/x, with the draft text in `result.text`
(Reddit also gets `result.title` + `result.subreddit`). LinkedIn,
Pinterest and Threads still auto-publish via API. Quora + X join the auto-route as
manual drafts when fit is high/medium; Reddit stays explicit-only
(`platforms: ["reddit"]` + `subreddit`) — a fresh account auto-posting
links is exactly what gets flagged. The brain/campaigns never place
Quora or Reddit — the question/subreddit is a per-post human decision.

**Optional schedulers (not integrated):** Typefully, Buffer and Hypefury
can schedule the manual X drafts (and LinkedIn posts) from the human's
side — free tiers exist, but they are third-party tools the user may
use later. The built-in drafts cost $0 and need no integration, so
nothing is wired to them.

## Router — `POST /api/v1/publishing/multi-publish`

x-n8n-secret checked. Body: `{ product: { name, category, link, imageUrl?,
description?, features?[] }, platforms?: [...], subreddit?: "gadgets",
question?: "How do I...?" }`.
Omit `platforms` to auto-route by fit. `subreddit` is the Reddit target
(empty stays empty for the human). `question` is the real question the
Quora answer / X thread answers (Problem Miner output when available).
Response lists per-platform `published | draft | skipped | failed` —
failures are collected, never thrown. Low-fit platforms are skipped with
the reason.

## n8n — `affiliate/multi-platform-publish.json`

Webhook `POST /webhook/affiliate/multi-publish` → backend multi-publish →
structured log. X drafts print in full for copy-paste into the X app.
Generated by `scripts/gen-multi-platform.py` (connections + JS validated).

## Deploy checklist

1. Pinterest: business account → app → OAuth (`boards:read/write`,
   `pins:read/write`) → token → `PINTEREST_ACCESS_TOKEN`; pick/create a
   board → `PINTEREST_BOARD_ID`; apply for Standard access for public pins.
2. LinkedIn: developer app → enable "Share on LinkedIn" (+ Sign In with
   LinkedIn) → 3-legged OAuth (`openid profile w_member_social`) → token →
   `LINKEDIN_ACCESS_TOKEN`; author URN `urn:li:person:<id>` →
   `LINKEDIN_AUTHOR_URN` (from `/v2/userinfo` `sub`).
3. X: no API setup — post drafts manually (free).
4. Reddit: **manual drafts only** (API closed to new developers — see
   above). Account u/zaiddigitalofficial exists. The router returns a
   draft (title + body); the human picks the subreddit per post — check
   its rules first (see "Reddit — honest limits"). No tokens exist and
   none can be created; do not re-attempt app creation.
5. Quora: **manual drafts only** (no public API). No setup needed — the
   router returns a ready-to-post answer; the human posts it in Quora.
6. Threads: create a **NEW Meta app** with the **"Access the Threads API"**
   use case selected at creation (verified 2026-11-21: the use case
   CANNOT be added to the existing "Zaid Digital" app — no Threads
   product in Add Product, no `threads_basic`/`threads_content_publish`
   permissions for it) → OAuth sign-in (`threads_basic` +
   `threads_content_publish`) → long-lived token (~60 days) →
   `THREADS_ACCESS_TOKEN`; Threads user id → `THREADS_USER_ID`. Single default profile for now; no App
   Review needed for your own account (dev mode + tester, same as IG).
   **LIVE 2026-11-23:** new app "Zaid Digital Threads" created (App ID
   1119239517812340); OAuth done for @tech_fynd (scopes threads_basic +
   threads_content_publish); long-lived token installed in VM .env
   (expires ~2027-01-22) + `THREADS_USER_ID` verified via /me
   (username tech_fynd). CRITICAL: Threads API uses the **Threads App ID
   1031070893359741 + Threads App Secret**, NOT the Meta App ID/secret —
   the Meta App ID fails OAuth with error 4476002. @tech_fynd must be a
   Threads Tester and accept the invite (error 1349245 otherwise).
   Redirect URI: https://zaid-digital.duckdns.org/threads/callback
   (registered; its 404 page is expected — the code rides in the URL).
   All 6 Threads profiles exist (@tech_fynd, @crafted_pixels_1,
   @classic_books_1, @clear_budget_sheet, @daily_useful.gadgets,
   @printedtshirty.usa) and ALL 6 have live 60-day tokens (expires
   ~2027-01-22). **No live post made yet** — first real post
   needs the user's go-ahead. **Per-profile routing BUILT 2026-11-23:**
   `resolveThreadsCredentials(productType)` in threads.ts routes each
   product type to its own Threads profile via the account registry
   (SocialAccount.threadsTokenEnv + threadsUserId); multi-publish passes
   the resolved token/userId to createThreadsPost, falling back to the
   default (tech_fynd) when the account has no Threads credentials.
   **ACCOUNTS_JSON LIVE 2026-11-23:** 6 accounts (tech, gadgets, pod,
   templates, ebooks, spreadsheets) with IG user IDs + FB Page IDs from
   Meta Business Settings (business "Zaid Digital" 1980151423389664)
   and Threads tokens/userIds on every entry; routing verified live
   2026-11-23 (ebook/coloring_book→ebooks, template_pack/website→
   templates, xlsx→spreadsheets, pod/pod_design→pod, affiliate+tech→
   tech, affiliate+gadgets→gadgets — all 9 checks OK). NOTE:
   printedtshirty.usa's Threads profile did NOT exist until the user
   created it 2026-11-23 (Meta's Add People search only returned the
   different account printedtshirt.usa, "Men Fashion USA" — added by
   mistake, then removed); a Threads profile must exist before Meta
   can find the account as a Tester.
7. Import the n8n workflow; call it per product after verification
   (or wire it into the daily controller later).
