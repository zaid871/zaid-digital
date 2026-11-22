# Social accounts guide — IG, FB, Pinterest, LinkedIn, X, YouTube

What the system needs from each platform, step by step, and who
does what. Written 2026-11-20. Keys and tokens are NEVER pasted in
chat — file method (like the Groq/Gemini keys) or Secure Vault.

## Status right now

| Platform | System use | Status |
| --- | --- | --- |
| Instagram | Affiliate reel daily + digital reels/carousels | Tokens INSTALLED + verified live 2026-11-20; Tester invites pending in IG apps |
| Facebook | Reels alongside IG | Tokens INSTALLED + verified live 2026-11-20 |
| Pinterest | Pins (weekly volume) | Trial access DENIED 20 Nov 2026 (website not registered to company) — fix = real domain + /privacy page → resubmit |
| LinkedIn | Posts | DONE — app + tokens installed + verified 21 Nov 2026 |
| Reddit | Posts (explicit-only) | Account u/zaiddigitalofficial DONE; API BLOCKED — no new access since 31 Oct 2026 |
| Quora | Answers/Spaces (manual) | No public API — manual only, autoposting impossible |
| X | Drafts only — you post from the app | No key needed |
| YouTube Shorts | Optional publishing | NOT SET — optional |

Publishing workflows are HELD (20 workflows) until IG/FB tokens
exist — running them without tokens would burn quota on failed
publishes. When tokens go live, the publishing switch is flipped
only with your "haan", because real posts start going out then
(the brain fires a daily affiliate reel).

## Part 1 — Instagram + Facebook (Meta): the main one

Instagram and Facebook share one setup: a Facebook Page linked to
an Instagram Business account, plus one Meta developer app. Do it
in this order.

### Step 1 — Facebook Page banao (aap)

1. facebook.com/pages/create par jao.
2. Page name = brand name, category chuno (e.g. "Digital Creator"
   / "Education"), bio + profile picture lagao.
3. Page publish karo. Free hai, koi review nahi. (Naam baad mein
   change ho sakta hai, limits ke saath.)

### Step 2 — Instagram account Business banao + Page se link karo (aap)

- **Agar account hai:** Instagram app → profile → Settings →
  Account type → "Switch to professional account" → **Business**
  chuno (Creator nahi — API publishing ko Business chahiye).
- **Agar naya account banana hai** (e.g. digital products ke liye):
  signup par Instagram 6 cheezein maangta hai:
  1. unique email ya phone — ek email/phone = ek account, to 4
     product-type accounts (Templates, Ebooks, Spreadsheets, POD)
     ke liye 4 alag emails/phones chahiye;
  2. username (unique handle);
  3. display name;
  4. password — Secure Vault se, kabhi chat mein nahi;
  5. date of birth (age check);
  6. verification code (email/SMS par aata hai).
  - **Gmail +alias shortcut:** `name+templates@gmail.com` Instagram
    ke liye alag email gina jata hai, aur saare codes ek hi inbox
    mein aate hain. Agar Instagram kabhi alias reject kare to alag
    emails chahiye honge.
  - Kabhi-kabhi Instagram signup par CAPTCHA/phone check maangta
    hai — isliye account aapke apne browser session mein banana
    sabse safe hai; verification code aap se aayega (ya connected
    Gmail se, aapki approval par).
- **Link karo:** Instagram → Settings → Accounts Centre → Pages →
  Step 1 wali Page add karo. (Ya facebook.com par Page Settings →
  Linked accounts → Instagram.) Confirm karo: Page Settings →
  Linked accounts mein IG dikhna chahiye, aur IG profile par
  "Professional dashboard" dikhna chahiye.

### Step 3 — Business Portfolio banao (aap, optional lekin recommended)

1. business.facebook.com → top-left menu → "Create a business
   portfolio" → naam (public business name) + apna naam + business
   email → email confirm karo.
2. Free hai, **koi paid plan nahi, koi approval nahi**. Ek profile
   2–3 portfolios bana sakta hai. Profile purani + active + 2FA on
   honi chahiye, warna Create option nahi dikhega.
3. Portfolio mein Page + IG account add karo (Business Settings →
   Accounts → Pages / Instagram accounts → Add). Isse ek hi jagah
   se sab manage hota hai — 4 accounts ke liye yahi panel kaam
   aata hai.

### Step 4 — Meta developer app (main karta hoon, aapki login se)

1. developers.facebook.com → My Apps → Create App.
2. App mein Instagram product add karo, permissions:
   `instagram_business_basic` + `instagram_business_content_publish`.
3. Facebook side ke liye permissions: `pages_manage_posts` (+
   `pages_read_engagement`, `pages_show_list`).
4. Apna IG account **Tester** banao (App Roles → Testers) — apne
   brand account ke liye **koi app review nahi chahiye**; dev mode
   hi kaafi hai (ye pehle bhi verify ho chuka hai, 2026-10-20).
5. App ko Live karne ki zaroorat nahi — dev mode mein apna
   account kaam karta hai.

### Step 5 — Tokens (main karta hoon) — flow samajh lo

1. **Short-lived user token (1 ghanta)** — Graph API Explorer se
   ya login flow se.
2. **Long-lived user token (60 din):**
   `GET graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}`
3. **Page token (kabhi expire nahi hota):**
   `GET graph.facebook.com/me/accounts?access_token={long-lived-token}`
   — har Page ke saath uska `access_token` aata hai.
4. **IG user ID:** Page ke `instagram_business_account.id` se milta
   hai.
5. Env vars: `IG_USER_ID`, `IG_ACCESS_TOKEN` (long-lived),
   `FB_PAGE_ID`, `FB_PAGE_TOKEN` → VM `.env` → app + worker
   restart → test call (sirf read) — koi real post nahi.
6. **Expiry:** IG token ~60 din, phir refresh; FB Page token
   kabhi expire nahi hota. **Error 190** aaye to token mar chuka
   hai — flow dobara chalana padta hai (main kar dunga, dobara
   details nahi chahiye hongi).

### Step 6 — Verify karo (main karta hoon)

- IG: `GET /{ig-user-id}?fields=id,username,account_type` →
  `account_type` = BUSINESS aana chahiye.
- FB: `GET /{page-id}?fields=id,name` → Page ka naam aana chahiye.
- Dono pass → setup ready. Real post tabhi jab aap "haan" kaho
  (brain roz affiliate reel fire karta hai — switch aapki "haan"
  par hi ON hota hai).

### Step 7 — Auto-DM webhook (deploy par manual)

Comment-to-DM ke liye Meta app mein comments webhook subscription
lagana padta hai — ye deploy-time manual step hai, main tab
karunga. Iske bina publishing chalti hai, auto-DM nahi.

### Troubleshooting

- **"Already linked to another Page"** — IG pehle kisi aur Page se
  linked hai. IG → Edit profile → Page → Disconnect karo, phir
  nayi Page link karo. Ek IG = ek Page (1:1).
- **Error 190 / token invalid** — token expire ho gaya; Step 5
  dobara chalao.
- **Permissions missing** — app mein permissions add nahi hain ya
  Tester role nahi hai (Step 4).
- **IG personal account hai** — Business mein switch karo (Step 2).
- **Portfolio create nahi ho raha** — profile nayi hai ya 2FA off
  hai; purani profile + 2FA on karo.

## Part 2 — Pinterest

**DONE 2026-11-20 ~23:25 IST:** business account
"Zaid Digital" (@zaiddigitalofficial,
https://www.pinterest.com/zaiddigitalofficial/,
sahz7890@gmail.com) — ye pehle printedtshirty.usa tha;
delete karne par 7-day grace period mein login se wapas
active ho gaya, to user ne rename chuna. 6 boards bane:
Tech, Useful Gadgets, Printed Tshirts, Templates, Ebooks,
Spreadsheets. Developer app "Zaid Digital" bani (App ID
1642147). Website/privacy abhi temporary hain — Creator
Spring store URL (my-store-f1160f.creator-spring.com),
baad mein badle ja sakte hain. Icon temporary "ZD" wala hai.

**DENIED 23:24 IST 2026-11-20 — Trial access review fail:**
Pinterest ne "Update to your application status" email mein
kaha — website requirements poori nahi hui: website online
+ accessible honi chahiye, social media site nahi honi
chahiye, aur uska URL tumhari company ke naam par
registered hona chahiye. Creator Spring subdomain (kisi aur
ki domain) aur /privacy-policy wala nakli link is wajah se
fail hue (likely cause — Pinterest ne exact URL nahi bataya).
**Fix:** asli domain (DuckDNS — free, instant — ya eu.org,
weeks lagte hain) + store par asli /privacy page → app ki
URLs badlo → Trial dobara submit karo. Approval ke baad:
OAuth flow → tokens VM .env mein
(PINTEREST_ACCESS_TOKEN + PINTEREST_BOARD_ID). 24-hour
read-only test token mila tha (21 Nov 23:24 IST ko expire)
— publishing ke liye nahi hai.

**Trial vs Standard:** Trial access mein pins sirf aapko
dikhte hain. **Standard access** (pins sabko dikhen) ke
liye claimed domain + app review chahiye (use-case writeup).
Claimed domain ke liye wahi domain decision chahiye jo
store ke liye pending hai (DuckDNS ya eu.org).
System Pinterest par weekly volume chalata hai (Wed 06:30
IST, 7 pins) — tokens aate hi.

## Part 3 — LinkedIn

**App + tokens DONE 21 Nov 2026 ~00:20 IST (verified live):**
- Developer app **"Zaid Digital"** — App ID 264286132, Client ID 869rlhr7o17z16, logo ZD placeholder icon.
- Products on hain: **Share on LinkedIn** (w_member_social) + **Sign In with LinkedIn using OpenID Connect** (openid/profile).
- Account: **AI Tooler** (linkedin.com/in/ai-tooler-140922273/), author URN `urn:li:person:cTXZwpWFiZ`.
- Access token 60 days ka hai (expires ~19 Jan 2027); `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN` + Client ID/Secret VM .env mein installed aur running container mein verify ho gaye; health ok hai.
- **Refresh token nahi milta:** LinkedIn ka exchange refresh token deta hi nahi is app ko — renewal ke liye ~2 months baad wahi auth-code flow dobara karna hoga (user apne browser mein Allow karega, main server se exchange karunga).
- **Deploy lesson:** VM par bare `docker compose up -d` FAIL hota hai — compose file mein n8n service ka image `n8nio/n8n:1-latest` hai, jo Docker Hub par exist hi nahi karta. Hamesha scope karke recreate karo (`docker compose up -d app worker`).

1. **Account (aap):** personal LinkedIn account hi kaafi hai;
   Company Page optional hai.
2. **OAuth (main karta hoon):** developer app → permission
   `w_member_social` → access token (60-day) + refresh token.
3. Limit: 150 posts/day — system usse bahut neeche rehta hai.

## Part 4 — X (Twitter)

Kuch nahi chahiye. System sirf **draft** banata hai, post aap
khud app se karte ho. X ka API pay-per-use hai ($0.20/post with
link) — free-first rule ke hisaab se reject hai.

## Part 5 — YouTube Shorts (optional)

Sirf agar aap Shorts par publish karna chahte ho: channel + OAuth
token (`youtube.upload` scope). Ye optional hai — bina iske bhi
system chalta hai.

## Part 6 — Reddit (publishing)

**Code BUILT 21 Nov 2026, API ACCESS BLOCKED — no tokens can exist:**
- Publisher `src/lib/publishing/reddit.ts` (refresh-per-call, link/text
  posts) + wiring + tests 23/23 — **dead code for now**: Reddit closed
  self-service Data API access 11 Nov 2025, stopped accepting new access
  requests 31 Oct 2026, ends public API Mar 2027. App creation fails
  "Max clients have been reached" (3× tried). Devvit does not help (apps
  run inside Reddit, no server-side posting API).
- **Account EXISTS for manual posting:** u/zaiddigitalofficial
  (reddit.com/user/zaiddigitalofficial/) — human posts from it, X-drafts
  style. Explicit-only gate stays (auto-posting off).
- Env vars stay documented (`REDDIT_CLIENT_ID` etc.) for the record.

## Ek login se multiple accounts?

Ek Instagram account **ek waqt par sirf ek Facebook Page** se link
ho sakta hai — link 1:1 hota hai. Doosri Page link karne par Meta
"Already linked to another Page" error deta hai; pehle purani link
todni padti hai. Ek Page par bhi ek hi IG account link hota hai.

Lekin management ek jagah se ho sakta hai: **Meta Business Suite
(Business Portfolio)** mein ek hi login se multiple Pages + multiple
IG accounts manage karte ho — har Page ke saath uska apna IG
account. Ek hi Meta app + ek hi user token se multiple IG accounts
par publish bhi ho sakta hai (har account ka apna IG_USER_ID hota
hai). Matlab: **login/app/token ek ho sakta hai, accounts alag
chahiye** — ek handle se 4 alag brands/feeds nahi chal sakte.

System ki taraf se: aaj publishing workflows sirf ONE IG account ko
hardwire karte hain (env vars). Multiple accounts par publish karne
ke liye accounts registry + routing build chahiye — abhi bana nahi
hai. Practical raasta: ek hi IG account se shuru karo, alag accounts
tab banao jab ek niche mein sustained volume/sales dikhe.

## Registry + routing (technical, built 2026-11-20)

System ek se zyada accounts ko kaise sambhalta hai — code level:

- **Registry:** `ACCOUNTS_JSON` env var (ek JSON line, deploy-time
  config). Har entry: `key`, `label`, `kind` (affiliate/digital),
  `productTypes` (ebook, template_pack...), `niches` (wedding,
  money...), `igUserId`, `fbPageId`, aur optional `igTokenEnv` /
  `fbTokenEnv` (default `IG_ACCESS_TOKEN_<KEY>` /
  `FB_PAGE_TOKEN_<KEY>`). **Tokens kabhi registry mein nahi** — sirf
  `.env` mein.
- **Routing** (`src/lib/publishing/accounts.ts`): affiliate
  products pehle NICHE se route hote hain (affiliate side niche
  accounts hain — Tech, Useful Gadgets), phir pehla affiliate
  account; digital products product type se (explicit
  `productTypes`, phir built-in key map: ebooks → ebook/
  coloring_book; templates → template_pack/website; spreadsheets →
  xlsx; pod → pod/pod_design), phir niche match, phir pehla digital
  account (catch-all). Koi registry nahi ho to purane
  single-account env vars hi "default" account hain — purana setup
  bina badle chalta hai. Brain affiliate fire mein niche bhejta hai
  (ProductResearch.category se).
- **Flow:** publishing workflows (4: digital + affiliate × IG + FB)
  best-time gate ke baad, pehle Graph call se pehle
  `POST /api/v1/publishing/resolve-account` call karte hain
  (`{productType, niche, accountKey?}`) aur mile hue credentials
  se publish karte hain. Galat/unknown account par chupchaap galat
  account par post nahi hota — resolve fail hota hai.
- **Callers:** ads-marketing mein `niche` field add hai; brain
  affiliate fire mein `productType: "affiliate"` bhejta hai;
  carousel route bhi account resolve karta hai.
- **Add karna:** `.env` mein `ACCOUNTS_JSON` entry + us account ke
  token vars daalo, app + worker restart karo — code change nahi
  chahiye. Workflows repo mein update hain; live n8n mein agle
  re-import par aayenge.
- **Limits:** sweep/analytics abhi bhi default account ke tokens se
  chalte hain (per-account insights baaki hai); PublishRecord mein
  account save nahi hota.

## Aapse kya chahiye — checklist

- [ ] **IG/FB:** affiliate ke liye **2 pages** — Tech Finds (IG
      tech_fynd) + Useful Gadgets (IG daily_useful.gadgets); POD:
      Printed Tshirts (IG printedtshirty.usa). Sab Business
      Portfolio mein connected hain (2026-11-20). Digital ke 4
      type-accounts (Templates, Ebooks, Spreadsheets, POD) baad mein.
- [ ] Har page ki details: username, display name, email/phone,
      DOB, password (Secure Vault)
- [ ] **Pinterest:** business account banaya ya main guide karoon?
- [ ] **LinkedIn:** account hai? (optional)
- [ ] **Domain:** DuckDNS ya eu.org — Pinterest Standard + store
      dono ke liye

## Karne ka order

1. FB Page + IG Business + link (aap, 15–20 min)
2. Meta app + tokens (main, aapki approval par)
3. Pinterest business account (aap) + OAuth (main)
4. LinkedIn (optional, aakhar mein)
5. Publishing switch ON (aapki "haan" par — tabhi real posts)

## Yaad rakhne wali baatein

- Password kabhi share nahi hota — access sirf tokens se milta
  hai, jo scoped hote hain aur kabhi bhi revoke ho sakte hain.
- Ek IG account = ek email/phone. 4 accounts ke liye 4 emails.
- IG token ~60 din mein expire hota hai; FB Page token nahi hota.
- App review sirf tab chahiye jab doosron ke accounts par post
  karna ho — apne brand account ke liye nahi.
