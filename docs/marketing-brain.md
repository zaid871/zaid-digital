# Marketing Brain (2026-11-13)

**User's setting:** affiliate = roz 1 reel IG par; digital = har product hafte me
ek martaba zaroor promote ho; har digital product par reel zaroori nahi — agar
uski marketing dusri taraf se ho rahi hai to IG par carousel kaafi hai; aur
sirf trigger se kaam nahi — ek **brain** hona chahiye jo samjhe ki konse waqt
konsa product promote karna hai, aur uski prediction almost sahi ho.

## The brain, in one line

Har subah 06:30 IST ek plan banta hai: affiliate ki aaj ki reel (top ready
video), digital ke 4 best-time slots (07:30/08:30/19:30/20:30) ke picks, har
pick ka format (reel ya carousel), aur ads-daily ka product. Plan ke hisaab
se campaigns tick aur ads-daily execute karte hain — brain decide karta hai,
executors chalate hain.

## Prediction — honest version

Score 0–100, har component visible (har pick apne reasons ke saath aata hai):

- **Demand** 50 (neutral base; campaigns ke liye abhi koi demand feed nahi —
  v2: campaigns ko briefs se link karna)
- **Season** +25 (seasons.ts — wedding/planner etc.)
- **Trend** ×1.15 rising / ×0.85 falling
- **Past performance** ×0.7–1.3 (goal-loop history vs median views; cold
  start = 1.0 neutral)
- **Fresh** +5 (7 din se naya)
- **Coverage urgency** — 7 din se promote nahi hua → +30; 4 din → +15;
  kabhi promote nahi hua → +15. **Yahi hafte-wala rule enforce karta hai:**
  ek product jitna zyada din chhupa rahega, utna upar aayega.

**"Almost sahi" ka matlab:** prediction ek guarantee nahi hai. Brain apni
predictions plan me save karta hai, aur `calibrate()` unhe real views se
compare karta hai — **top-pick accuracy** (kitne din top-scored pick ne
sach me sabse zyada views liye). Cold start par accuracy null hoti hai;
jaise-jaise real data aata hai, score ka performance signal seekhta hai.
Accuracy `GET /api/v1/marketing/brain/latest` me dikhti hai. Jo brain
claim kare ki wo pehle din se almost sahi hai, wo jhooth bolega — ye
nahi bolega.

## The three rules, enforced

1. **Affiliate roz 1 reel:** brain har subah top ready affiliate video
   chunta hai (DB: COMPLETED jobs + FinalVideo, published jobs excluded)
   aur `affiliate/instagram` webhook fire karta hai — **affiliate workflows
   ko chhoya nahi gaya** (sirf existing webhook call hota hai; workflow ka
   apna best-time gate exact minute tay karta hai; caption wahi pattern hai
   jo ads-marketing ka build-reels-payload use karta hai). Agar aaj ki reel
   pehle hi publish ho chuki hai → dobara nahi (publishRecord check).
   Agar koi ready video nahi → honest reason, reel nahi (chain se video
   aane ka intezar). **Ye guarantee chain ki throughput par depend karti
   hai** — roz discovery + render ko 1 video dena hoga (40–50/month ka
   design ~1.5/day deta hai).
2. **Digital hafte me ek martaba:** coverage urgency (+30) unpromoted
   products ko slots me dhakel deti hai; plan me `coverage.unpromoted7d`
   list hoti hai.
3. **Reel zaroori nahi — carousel:** agar product pichle 7 din me Pinterest/
   LinkedIn/X/Facebook par promote hua hai (goal-loop history), to IG par
   **carousel** (pack ki 4 PNGs, public file URLs se); nahi to **reel**.
   Carousel images na milen → reel (fallback, reason ke saath).

## Carousels

- `src/lib/publishing/carousel.ts` — Graph API: item containers
  (is_carousel_item) → CAROUSEL container → publish. 2–10 images, caption
  2200 chars. Publish "not ready" kahe to ek retry (10s wait). Koi bhi
  step fail ho to step + API ka error — kabhi fake publish nahi.
- `POST /api/v1/publishing/carousel` — backend route (env creds).
- `GET /api/v1/digital/files/<path>` — pack PNGs ke public URLs (digital
  root ke andar + image extensions only; IG server-side fetch karta hai,
  jaise video downloadUrl).
- Digital IG publishing workflow me carousel branch (webhook-entry →
  if-carousel → call-carousel; reels ka raasta untouched).

## Wiring (kya badla, kya nahi)

- **NEW workflow `digital-marketing-brain.json`** — roz 06:30 IST (cron
  `0 1 * * *` UTC) → POST /api/v1/marketing/brain/daily → report.
  **First import needed.**
- **`digital-ads-daily.json`** — get-plan node add hua; pick-today pehle
  brain ka dailyAd leta hai, na mile to queue rotation (fallback kabhi
  block nahi karta). **Re-import needed.**
- **`digital-instagram-publishing.json`** — carousel branch add hui.
  **Re-import needed.**
- **Campaigns tick** — plan ke slot order me campaigns chalti hain; plan
  pick carousel ho to tick video ad ki jagah carousel fire karta hai
  (fail ho to video ad fallback). Anti-spam gap (24h) aur pace logic
  untouched — brain unhe override nahi karta.
- **Affiliate workflows: ZERO changes** (mtimes untouched). Brain sirf
  existing `affiliate/instagram` webhook ko call karta hai.

## Endpoints

- `POST /api/v1/marketing/brain/daily` — plan banao + save karo + affiliate
  reel fire karo (agar due ho). Returns {plan, affiliateFired, affiliateReason}.
- `GET /api/v1/marketing/brain/latest` — plan + calibration + coverage
  (campaigns tick aur ads-daily isse padhte hain).
- `POST /api/v1/publishing/carousel` — IG carousel publish.
- `GET /api/v1/digital/files/<path>` — public image URLs.

## Files

- `src/lib/marketing/brain.ts` — score/format/plan/calibrate + plan
  persistence + affiliate fire.
- `src/lib/publishing/carousel.ts` — Graph API carousel.
- `src/lib/marketing/campaigns.ts` — tick carousel branch + plan ordering.
- Routes: brain/daily, brain/latest, publishing/carousel,
  digital/files/[...path].
- `scripts/test-marketing-brain.ts` — **30/30**; `scripts/test-publishing-carousel.ts` — **12/12**.

## Verification

- Brain 30/30, carousel 12/12, campaigns 35/35, auto-generate 28/28,
  seasons 27/27 (regressions green).
- tsc exit 0, eslint clean, `npm run build` green.
- validate-workflows: **42 PASS + 2 pre-existing v1-legacy FAILs**
  (brain/ads-daily/IG-publishing sab PASS).
- NOT live-tested: pehli live plan + affiliate reel — brain workflow
  import + backend redeploy ke baad, agle din 06:30 IST.

## Multi-channel placements (2026-11-13, user: "sirf IG ko hi mandatory
mt rakho, jaha bhi product ki demand hai viewers ko us ki zarurat hai
waha rakh do")

IG is the anchor, never the only channel. Every brain pick now carries
`placements` — per channel, with its format + reason:

- **Instagram** — always (reel, ya carousel agar dusre channel par
  marketing ho rahi hai).
- **Facebook** — reel picks ke saath (FB reels mirror IG). Carousel
  picks FB skip karte hain — FB par carousel ka raasta nahi hai (plan
  me reason ke saath likha hota hai, chhupaya nahi).
- **Pinterest / LinkedIn / X** — platform-fit se (high/medium only,
  low skip) + pichle per-channel views/posts as demand evidence.
  Pinterest = pin, LinkedIn = post, X = draft hamesha (paid API —
  manual posting free hai).

**Division of labor:** brain decide karta hai KAHAN (placements), pace
decide karta hai KAB/KYA (post/wait + gap). Pehle tick pace ke channels
(top 1 jab on-track) use karta tha — ab plan pick ho to brain ki
placements jeet-ti hain; bina plan ke purana behavior.

**Executors:**
- Reel pick → promote() → ads-marketing → IG + FB reels + multi-publish
  (placements ke platforms).
- Carousel pick → IG carousel + `multiPublish()` lib call (Pinterest pin
  + LinkedIn post + X draft, pack ki pehli image ke saath).
- Affiliate daily reel → IG **aur** FB dono webhooks (same video) —
  affiliate chain dono trigger karta tha, brain ab dono fire karta hai.

**Refactor:** multi-publish route ka logic `src/lib/publishing/multi-publish.ts`
me nikala (`multiPublish()` — route ab use call karta hai, behavior same;
test-multi-platform 24/24 green). Tick use directly import karta hai.

## Honest limits (v2)

- Campaign scoring me demand feed nahi (base 50) — briefs se link karna
  baaki hai.
- Affiliate ranking me discovery score nahi (base 50 + season + freshness).
- Carousel publishes `publishRecord` me nahi likhe jate (records schema
  sirf reels allow karta hai — DB enum change chahiye); brain ledger +
  campaign actions me record hota hai.
- Prediction accuracy cold start par null; pehle 1–2 hafte ke baad hi
  meaningful number aayega.
- FB par carousel ka raasta nahi — carousel products FB tak nahi pahunchtay.
