DIGITAL WORKFLOWS — n8n IMPORT GUIDE (7 workflows)
==================================================

IMPORT (n8n UI -> Workflows -> ... -> Import from file):
  1. digital-ebook-generation.json
  2. digital-template-generation.json
  3. digital-pod-generation.json      (PATCHED: ab Printify draft auto-create NAHI hota)
  4. digital-ads-marketing.json (32 nodes, 2026-11-07: video complete hone par
     GET /api/v1/jobs/:id/result se signed URL lekar IG/FB Reels trigger karta hai)
  4a. digital-instagram-publishing.json (24 nodes, NEW 2026-11-07)
  4b. digital-facebook-publishing.json  (18 nodes, NEW 2026-11-07)
      Affiliate publishing ki node-for-node copies, alag webhooks
      digital/instagram + digital/facebook, NO affiliate disclosure.
      Affiliate files ko chhua nahi gaya.
  5. digital-presell-gate.json        (NEW - lever 1: pre-sell validation)
  6. digital-pod-approve.json         (NEW - lever 2: design-check approval)
  7. digital-ads-daily.json           (NEW - lever 3: roz 09:00 IST auto ads)

ENV (n8n -> Settings -> Variables, backend .env me bhi):
  N8N_WEBHOOK_SECRET   = <wahi secret jo backend .env me hai>  (REQUIRED)
  BACKEND_URL          = http://app:3000                       (n8n se backend ka URL)
  N8N_BASE_URL         = <n8n ka base URL>                   (ads-marketing se
                         digital publishing webhooks call karne ke liye, NEW)
  N8N_PUBLIC_URL       = http://localhost:5678                 (presell-gate/ads-daily
                         generation webhooks ko wapas call karne ke liye)
  DIGITAL_PRESELL_THRESHOLD = 10   (kitne hits par generation auto-fire ho)
  DIGITAL_ADS_QUEUE_JSON    = [{"productType":"ebook","productName":"...","productLink":"...","topic":"..."}]
  DIGITAL_ADS_AUTO_PUBLISH  = false  (true karne par hi auto-post; default video banta hai)
  N8N_BLOCK_ENV_ACCESS_IN_NODE ko kabhi true MAT karo (Code nodes $env use karte hain)

ACTIVATE: 7 workflows ko Active karo. Purana digital-products.json (combined)
           ko DEACTIVATE kar do (duplicate webhook se bachne ke liye).

LEVER 1 - PRE-SELL (pehle bikna, phir automation):
  Landing page (Carrd/Payhip free) par "Mujhe chahiye" button lagao jo POST kare:
    POST <n8n>/webhook/digital-presell   header x-n8n-secret: <secret>
    body: {"productType":"ebook","productName":"Sehatmand Nashta","topic":"..."}
  10 hits (ya DIGITAL_PRESELL_THRESHOLD) par generation webhook AUTO-FIRE hoga.
  Status: action:"status" bhejo. Reset: action:"reset".

LEVER 2 - DESIGN CHECK (POD):
  1. POST /webhook/digital-pod-generation {"niche":"..."} -> design banta hai,
     Printify draft NAHI banta. Response me slug milta hai.
  2. storage/digital/pod-<slug>/design-print.png KHUD check karo (AI text gadbad ho sakta hai).
  3. Pasand aaye to: POST /webhook/digital-pod-approve {"slug":"<slug>"}
     -> Printify UNPUBLISHED draft banta hai. Na-pasand ho to kuch mat karo.

LEVER 3 - ROZ KA ADS:
  digital-ads-daily roz 09:00 IST par queue me se product uthakar
  /webhook/digital-ads-marketing fire karta hai (fire-and-forget).
  DIGITAL_ADS_AUTO_PUBLISH=false (default) par sirf video banta hai, post nahi hota.

TEST:
  curl -X POST <n8n>/webhook/digital-ebook-generation -H "x-n8n-secret: <s>" \
    -H "Content-Type: application/json" -d '{"topic":"test"}'
  200 ok | 401 = secret galat | 400 = validation

NOTE: backend me POD changes (skipPrintify + /pod/publish) hain — backend
      REDEPLOY zaroori hai, warna purana backend skipPrintify ignore karega
      (aur Printify draft bana dega). Deploy ke baad hi lever 2 sahi chalega.

---
8. digital-pmf-survey.json (NEW - Sean Ellis PMF survey)
   POST /webhook/digital-pmf {product, action: answer|status|reset,
     answer: very_disappointed|somewhat_disappointed|not_disappointed}
   10+ responses par verdict: >=40% "very_disappointed" = pmf_ok,
   warna pmf_risk. Survey email (1 sawal) selling/email layer judne par lagega.

---
9. digital-marketing-goal-loop.json (NEW - target-driven self-improvement)
   Weekly Sundays 08:00 IST: POST /api/v1/marketing/goals/sweep ->
   har channel ka latest result uske MAX target se compare hota hai.
   <70% par LLM diagnosis (hypotheses + best-config re-apply).
   Metrics feed karo: POST /api/v1/marketing/goals/record
     {productKey, channel, metrics:{clicks:12}, config:{...}, primaryMetric:"clicks"}
   (x-n8n-secret header ke saath). Bina metrics ke loop ke paas check karne ko kuch nahi.

---
10. digital-problem-miner.json (NEW - Problem Miner v1)
   Weekly Mondays 07:00 IST: POST /api/v1/discovery/problem-miner ->
   Reddit (public JSON) + Google/Amazon Suggest (keyless) + Google Trends
   se top-10 problems. Niches: DIGITAL_MINER_NICHES env (comma-separated,
   default 'meal prep,budgeting,freelancing'). Log me top-10 aata hai —
   review karo, winners ko /webhook/digital-presell par bhejo.
   Deploy-check: pytrends app image me (Dockerfile me hai).

---
11. digital-marketing-strategist.json (NEW - Universal Marketing Strategist)
   POST /webhook/digital-strategist {productName, client?, kind, priceBand,
   audience, marketBreadth, goal, assets?, features?} → agency-grade plan:
   channel priority queue + 5 stages (validate→retain) + angles + hooks.
   Koi bhi product, koi bhi market. Client field se multi-client
   ("client:product" namespace) — future agency ke liye taiyaar.

---
12. digital-email-nurture.json (NEW - 7-point #1)
   POST /webhook/digital-nurture {email, name?, productName, freebieName, freebieUrl}
   → Brevo contact → email 1 (freebie) → wait 1d → email 2 (how-to)
   → wait 2d → email 3 (pitch, NO fake urgency). Env: BREVO_API_KEY,
   BREVO_SENDER_EMAIL, BREVO_SENDER_NAME. Brevo free = 300 emails/day.
13. digital-freebie-delivery.json (NEW - 7-point #6)
   POST /webhook/digital-freebie {email, freebieName, freebieUrl, productName?}
   → download link respond + nurture trigger. Tripwire page = selling layer (parked).
14. digital-review-request.json (NEW - 7-point #7)
   POST /webhook/digital-review-ask {email, productName, reviewUrl?} → 7 din wait
   → honest review ask email (no 5-star incentive). Callback:
   POST /webhook/digital-review-callback {email, product, rating 1-5, text}
   → backend record (verified flag sirf evidence par).
15. digital-pinterest-volume.json (NEW - 7-point #2)
   Weekly Wed 06:30 IST: DIGITAL_PINTEREST_QUEUE_JSON me products
   [{name, category, link, imageUrl, ...}] → 7 distinct pins/product.

---
16. digital-marketing-machine.json (NEW - Marketing Machine orchestrator)
   POST /webhook/digital-marketing-machine {productName, kind, priceBand, audience,
   marketBreadth, goal, assets?, features?[], client?, productLink?, imageUrl?,
   seoKeywords?[], presell?: {productType, productName}}
   → strategist plan → pre-sell gate check → 4 channels sequential:
   Pinterest volume (5 pins) → Etsy optimize → SEO article → report.
   Video ads: product ko DIGITAL_ADS_QUEUE_JSON me add karo (ads-daily).
   Scoreboard/auto-fallback: goal-loop weekly sweep (built-in).

---
17. digital-instagram-publishing.json + digital-facebook-publishing.json
    (NEW 2026-11-07 - affiliate publishing setup ki digital copies)
    Webhooks: POST /webhook/digital/instagram + /webhook/digital/facebook
    (ads-marketing se fire-and-forget trigger hote hain). Best-time gate,
    eligibility check, container/upload, publish, record-publish — sab
    affiliate jaisa, apne product ki caption ke saath, NO affiliate disclosure.
    Env: IG_USER_ID, IG_ACCESS_TOKEN, FB_PAGE_ID, FB_PAGE_TOKEN, N8N_BASE_URL.
    Import order: pehle ye dono, phir digital-ads-marketing.json.

---
18. TEMPLATE EXPANSION (NEW 2026-11-08 - premium upgrade)
    4 naye generation workflows, v2 pattern (demand pre-check + 1 retry):
    a. digital-docs-generation.json (20 nodes)
       POST /webhook/digital-docs-generation
         {"format":"docx"|"pptx"|"epub", "title":"...", "topic":"...",
          "sections":[...]|"slides":[...]|"chapters":[...]}
       Content do to direct render; content NA do to hub (long-doc pipeline)
       JSON sections/slides/chapters draft karke render karta hai.
       Premium: PPTX accent bar + footer, DOCX styled title + accent rule.
    b. digital-spreadsheets-generation.json (19 nodes)
       POST /webhook/digital-spreadsheets-generation
         {"title":"...", "kind":"budget|expense|inventory|sales|attendance|profit"}
         ya {"title":"...", "sheets":[...]}
       kind do to deterministic bank (headers + example rows + WORKING SUM
       formulas) se real XLSX banta hai. Premium: dark header fill + banded rows.
    c. digital-planners-generation.json (17 nodes)
       POST /webhook/digital-planners-generation
         {"type":"daily"|"weekly", "title":"...", "startDate":"2026-11-09",
          "count":7, "goals":[...], "habits":[...]}
       Printable A4 PDF (daily: Top-3 + hourly 06:00-22:00 + habits + notes;
       weekly: 7-day grid + goals). Hyperlinked/fillable digital planner NAHI.
    d. digital-thumbnails-generation.json (17 nodes)
       POST /webhook/digital-thumbnails-generation
         {"title":"...", "subtitle":"...", "backgroundPrompt":"...", "style":"dark"|"light"}
       1280x720 PNG: Pollinations FLUX background + FFmpeg drawtext title
       (title hamesha sahi spelling — AI image se text nahi likhwaya).
    Template packs bhi premium hue: 8 kinds (sale/event/testimonial naye),
    5 themes (forest/wine naye), footer accent rule.
    Backend redeploy zaroori hai: naye endpoints /api/v1/digital/planners
    aur /api/v1/digital/thumbnails + template/docs upgrades deploy par hi milenge.

19. CANVA ELEMENTS (NEW 2026-11-08 - template packs mein add hue)
    Template packs ab Canva-style elements dete hain:
    - Photo backgrounds: photoBackground:true -> ek AI image per pack,
      har design ki SVG mein embedded + PNG preview mein rendered.
      backgroundPrompt se apni image prompt do. Frame:true -> white border.
    - Charts: "chart" kind (10 kinds mein se) — sample bar chart SVG,
      chartData:[{label,value}] se apna data do.
    - Tables: "table" kind — label/value rows, tableData se apna data do.
    - Shapes/motifs: testimonial=star, checklist=check, sale=tag,
      event=calendar — har kind ka apna shape accent.
    Workflow: /webhook/digital-template-generation mein photoBackground,
    backgroundPrompt, frame, chartData, tableData pass karo.
    Nahi ban sakta: animations, videos, audio, forms, 3D, grids layout,
    mockups (POD flat mockup alag hai), stock photo library.

20. GAP BUILD (NEW 2026-11-08 - jo ban sakta tha, wo sab add hua)
    Template list ki analysis ke baad jo gaps bache the:
    a. digital-prompts-generation.json (17 nodes)
       POST /webhook/digital-prompts-generation
         {"topic":"...", "count":10, "category":"marketing"?, "useAi":true}
       AI draft (free text chain) ya built-in bank se prompt library:
       prompts.md + prompts.txt + prompts.json + zip. Har prompt ka
       compliance scan — violating prompt drop hota hai, ship nahi hota.
    b. digital-icons-generation.json (17 nodes)
       POST /webhook/digital-icons-generation
         {"theme":"dark"|"light", "accent":"#FF6B35", "includePatterns":true}
       16 stroke SVG icons + 4 seamless pattern tiles + sprite.svg,
       512px PNG previews. Deterministic (no AI). Icon shapes Feather
       Icons (MIT) par based hain — NOTICE.txt bundle mein hai.
    c. digital-landing-generation.json (17 nodes)
       POST /webhook/digital-landing-generation
         {"businessName":"...", "topic":"...", "tagline":"...", "features":[...],
          "ctaText":"Shuru karein", "theme":"dark"|"light"}
       Ek static index.html (hero + features + CTA, inline CSS). AI draft
       karta hai copy, ya supplied copy use hoti hai. Sirf ek page — theme/
       UI kit nahi.
    d. digital-luts-generation.json (17 nodes)
       POST /webhook/digital-luts-generation {"presets":["warm","cool",...]?}
       5 cinematic .cube LUTs (32^3 lattice, plain text): warm, cool,
       contrast, faded, teal-orange. Mathematical transforms hain — kisi
       film stock ka measured clone nahi.
    e. digital-presets-generation.json (17 nodes)
       POST /webhook/digital-presets-generation {"presets":["warm-glow",...]?}
       5 Lightroom looks as .xmp (XML text): warm-glow, moody-dark,
       bright-airy, faded-film, golden-hour. Photoshop Actions (.atn,
       binary) ab bhi nahi bante.
    f. Template packs: "logo" kind (11 kinds) + "card" size (business
       card 1050x600) — logo = centered monogram + wordmark, kisi bhi
       size par. Card pack mein chart/table rotate out hote hain (card
       chhota hai). Route enum update hua; workflow size pass-through
       karta hai (koi allowlist nahi).
    g. Thumbnails: format field — thumbnail 1280x720 (default), intro /
       outro 1920x1080 screens (intro.png / outro.png). Same chain
       (Pollinations bg + FFmpeg drawtext). Motion intros ab bhi nahi.
    h. Premium typography: Poppins (SIL OFL, assets/fonts/) — template
       SVG text + thumbnail drawtext ab Poppins use karte hain (DejaVu
       fallback). Dockerfile.app mein fonts install hote hain (fontconfig).
       Deploy-check: image build ke baad `fc-match Poppins` check karo.
    i. 3D models (ARRANGE, generate nahi): scripts/arrange-free-3d.ts
       <keyword> [count] — Poly Pizza search API (no key) se CC0/CC-BY
       GLB models download karta hai, har file ka glTF magic verify
       karta hai, manifest mein creator + licence + source URL likhta
       hai. CC-BY models ka attribution dena LAZMI hai (commercial use).
    Backend redeploy zaroori hai: naye endpoints /api/v1/digital/
    prompt-libraries, icon-bundles, landing-pages, luts, presets +
    template/thumbnail upgrades deploy par hi milenge.
    STILL NO: Notion templates (koi API nahi), Photoshop Actions (.atn,
    binary), motion graphics (.aep/.mogrt), Figma/UI kits, real Canva
    designs, hyperlinked digital planners, fonts as a standalone product
    (OFL: font akela becha nahi ja sakta — sirf apne rendering mein use).

21. IDEA BRIEFS (NEW 2026-11-08 - template/ebook ideas data se, guess se nahi)
    Problem Miner ke top-10 problems se sellable product briefs — har brief
    mein demand evidence + trend + catalog gap + 2 uniqueness angles.
    Schedule: digital-idea-briefs.json — Mon 07:30 IST (miner ke 30 min
    baad), 4 nodes: schedule -> build-body -> POST /api/v1/digital/briefs
    -> report. Env: DIGITAL_BRIEF_TYPES (default template,ebook).
    Briefs sirf QUEUE hain (storage/digital/briefs/latest.json) — generation
    AUTO nahi hoti. User brief pick kare, phir generation workflow chalaye.
    GET /api/v1/digital/briefs/latest se queue padho.
    Naye idea sources (miner mein): YouTube Suggest (client=chrome&ds=yt —
    client=youtube JSONP deta hai, res.json() fail hota hai) + Google Trends
    rising related queries (pytrends; sandbox mein Google block karta hai,
    VM par live data aayega; fail ho to {} — kabhi fake nahi).
    Kind/theme mapping: budgeting -> chart/table + forest; wedding/event ->
    event + wine; study -> tips/checklist + dark; fitness -> checklist/tips
    + forest; business -> promo/sale + dark. Ebook briefs mein 5-chapter
    outline (AI ya bank). Gap check sirf APNI catalog se hota hai (Etsy/
    Gumroad ka supply data nahi hai — ye limit hai, feature nahi).
    Backend redeploy zaroori hai: naye endpoints /api/v1/digital/briefs
    aur /api/v1/digital/briefs/latest + miner ke naye sources deploy par
    hi milenge.

22. BESTSELLER STYLE ANALYZER (NEW 2026-11-08 - gap ka matlab saaf hua)
    Gap sirf "humne kya banaya" nahi — jo templates/ebooks market mein
    full demand mein hain aur full bik rahe hain, unka STYLE kya hai,
    usme kya kami hai, usi style mein uniqueness daal kar apna launch.
    Har brief mein ab: styleProfile + marketGap + bestsellerEvidence +
    uniqueness angles usi style mein twist.
    Signals (free + legal): YouTube top videos by views (Data API v3,
    YOUTUBE_API_KEY optional, free key, 10k units/day; na ho to skip +
    warning) + miner problems + MANUAL competitors (request mein
    competitors:[{title, source, note}] — apni browsing se paste karo).
    IMAANDAAR LIMIT: Etsy/Gumroad ki SALES data ka koi free API nahi hai
    (proprietary); scraping ToS/ban risk hai, isliye nahi karte. Style
    signals (titles/phrases) se nikalta hai — competitor ki actual
    design file nahi dekhte. Workflow: digital-idea-briefs.json ab
    includeYouTube:true bhejta hai. Env: YOUTUBE_API_KEY (optional).

23. ETSY PLATFORM ANALYSIS (NEW 2026-11-08 - jahan templates bikte hain)
    Analysis ab usi platform se aati hai jahan templates bikte hain:
    Etsy Open API v3 (free key, key-only — OAuth nahi). Har brief mein
    Etsy top listings: title + favorites + reviews + shop total sales.
    Setup: developers.etsy.com par free app banao -> keystring + shared
    secret -> .env mein ETSY_API_KEY="keystring:shared_secret".
    IMAANDAAR LIMIT: API mein per-listing sales count NAHI hota (num_sold
    nahi hai) — popularity favorites + reviews + shop sales se napti hai.
    Creative Market ka koi public API nahi; Gumroad ka API sirf apni
    khud ki sales ke liye hai — unke liye manual competitors lane hai,
    scheduled scrape nahi. Workflow: digital-idea-briefs.json ab
    includeEtsy:true bhejta hai. Key na ho to Etsy step skip + warning.
    Live note: sandbox se openapi.etsy.com timeout hota hai — pehli live
    call VM par real key se hogi (deploy ke baad).

24. BEAT-THE-TOP LOOP (NEW 2026-11-11 - har field x har platform par #1 ko beat karna)
    Weekly sweep (Sunday 09:00 IST): digital-beat-the-top.json (4 nodes)
    schedule -> POST /api/v1/marketing/beat/collect -> POST
    /api/v1/marketing/beat/analyze -> report. Koi manual step nahi:
    #1 auto-discover hota hai — YouTube Data API (top video by views),
    Etsy API (top listing by favorites), Reddit public JSON (top weekly
    post), Amazon public pages (Kindle search -> #1 ASIN -> Best Sellers
    Rank); IG/FB/X/Pinterest ke public profile pages og:description se
    (browser User-Agent, logged-out numbers); social handles YT winner
    ki channel description se. Registry (POST /beat/competitors, ek
    baar set karo) jeetta hai IG/FB/X/Pinterest handles, Reddit
    subreddit aur KDP ASIN par. Gap per target (beating / closing /
    behind / unknown) + actions (bestseller style angles) + #1 ka metric
    goal-loop north star ban jata hai (Sunday goal-loop sweep gap flag
    karta hai). Plan: GET /api/v1/marketing/beat/latest.
    IMAANDAAR LIMIT: login/bot wall aaye to last-known value + warning,
    kabhi fake nahi; session tokens ya unofficial API se force nahi
    karte. X aksar login wall dega — uska lane kamzor rahega. POD ki
    sales data kahin public nahi — Etsy/YouTube/Reddit se napte hain.
    Env: YOUTUBE_API_KEY + ETSY_API_KEY (optional, pehle se hain);
    DIGITAL_MINER_NICHES se niches aate hain. Pehla live run deploy ke
    baad Sunday 09:00 IST.

25. MANUAL PROMOTE (NEW 2026-11-11 - dashboard se kisi bhi website/product ko abhi promote karo)
    Dashboard card "Manual promote" -> POST /api/v1/marketing/promote
    -> forward POST {N8N_BASE_URL}/webhook/digital-ads-marketing
    (wahi webhook jo ads-daily fire karta hai). Type: website (NEW),
    ebook, template_pack, pod. Publish on = video + post; off = sirf
    video. Extra platforms (pinterest/linkedin/x) khali ho to auto-route.
    n8n down ho ya env na ho to promotion QUEUED save hoti hai
    (storage/marketing/promotions.json) — kabhi fake "started" nahi.
    WORKFLOW CHANGE: digital-ads-marketing.json DOBARA IMPORT KARO —
    validate-input ab 'website' leta hai, publish category mein website
    hai, aur BUG FIX: publish=false ab IG/FB reels bhi rokta hai
    (pehle sirf multi-publish rukta tha, reels phir bhi post hote the).
    Env: N8N_BASE_URL (.env.example mein add hua) + N8N_WEBHOOK_SECRET.
    Pehla live promote deploy ke baad — video ~40 min.

26. MARKETING CAMPAIGNS (NEW 2026-11-11 - smart layer; manual promote ab iska override hai)
    Dashboard card "Marketing campaign": product daalo + optional target
    (metric views/clicks/posts/sales, value, deadline 1-90 din). System
    khud analyze karta hai (platform-fit: ebook/template -> Pinterest +
    LinkedIn high; POD -> Pinterest high; website -> broad) aur sirf
    fit platforms + sirf peak time (07:30/08:30/19:30/20:30 IST) par
    post karta hai; min gap 24h (urgent 12h) — hamesha marketing nahi.
    Pace: expected = target x elapsed/deadline; on-track >= 0.7,
    behind < 0.7 (saare fit platforms), urgent < 0.4 ya <25% time bacha
    (saare + X draft). Target poora -> done; deadline guzri -> missed.
    Workflow: digital-marketing-campaigns.json (3 nodes) — schedule
    cron "0 2,3,14,15 * * *" UTC -> POST /api/v1/marketing/campaigns/tick
    -> report. Har faisla reason ke saath save hota hai.
    Progress: posts hamesha napte hain; views/clicks ke liye metrics
    ledger mein feed karne hote hain (POST /goals/record) — warna
    "unknown", kabhi fake zero nahi. Sales measure nahi hota bina
    selling layer ke (parked) — campaign views ko proxy maanta hai aur
    dashboard par flag karta hai. IMAANDAAR LIMIT: koshish system ke
    haath mein hai (frequency, channels, timing), result product +
    market par hai — target ki guarantee koi nahi.
    Env: kuch naya nahi (BACKEND_URL + N8N_WEBHOOK_SECRET pehle se).
    Pehla live tick deploy + import ke baad.
---
27. PREMIUM DIGITAL DESIGNS (NEW 2026-11-12 - BlankBuilder system; template packs + POD prompt)
    digital-template-generation.json ko RE-IMPORT karo (validate-input
    passthrough me designStyle add hua hai). Baaki workflows untouched.
    Naya: POST /api/v1/digital/template-packs me designStyle: "premium"
    (default standard) + themes onyx (black+silver) / ember (orange+black) /
    tealrust (white+teal+rust). Premium = trim bands (upar accent, neeche
    accent2), window-blind shadow backdrop + vignette, motif echo teen
    scales par (bada faded centre, medium top-right, chhota top-left),
    108px oversized headline, kind label ke neeche niche subtitle line.
    POD image prompt me bhi premium placement language hai (all-over print,
    motif do scales par, ek base + ek accent, print-ready vector).
    Use: {"niche": "...", "designStyle": "premium", "theme": "onyx"}.
    IMAANDAAR LIMIT: flat SVG/PNG designs hain — 3D garment mockup ya
    seam-wrap placement nahi; wo Printify-side hai. Pehla live pack
    deploy + re-import ke baad.
---
28. NEW DIGITAL PRODUCTS (NEW 2026-11-12 - wedding invites + planners + SVG cut files + coloring books)
    digital-template-generation.json ko RE-IMPORT karo (validate-input
    passthrough me kinds add hua hai). digital-ebook-generation.json ko
    RE-IMPORT karo (validate-input passthrough me format + pages add hue
    hain). Baaki workflows untouched.
    Template kinds ab 14 hain: wedding_invite (SHADI, rings motif),
    planner_page (PLANNER, time-block rows) aur svg_cut (SVG CUT,
    scissors motif) — plus kinds filter: {"kinds": ["wedding_invite"]}
    se wedding-only pack banta hai; card size par chart/table/planner_page
    rotate out (khaali filter fallback karta hai).
    Video: scriptStyle "wedding_invite" — hamesha 4 scenes (Names →
    Functions → Date & Venue → Closing + RSVP), dmCta keyword RSVP,
    dashboard dropdown me bhi; no music, no faces/AI avatars, naam
    sirf TEXT; facts se bahar kuch invent nahi.
    Coloring: POST /api/v1/digital/ebooks me format "coloring_book"
    (pages 24-40, default 24) — line-art pages + 8.5x11in PDF
    (scripts/coloring_bridge.py), har design ke peeche blank page.
    Manifest me KDP notes: AI disclosure REQUIRED, low-content box DO
    NOT tick, max 2 titles/format/week.
    IMAANDAAR LIMIT: DXF nahi hai; hyperlinked planners nahi; wedding
    order form nahi (selling layer parked); images 1024px (~120 DPI).
    Pehla live render deploy + re-import ke baad. Doc: docs/new-digital-products.md.
29. COMPLETE PARTIAL PRODUCTS (NEW 2026-11-12 night - resume, brand kit,
    workout log, onboarding flow, wall art — jo aadhe the wo mukammal)
    digital-template-generation.json ko RE-IMPORT karo (passthrough me
    resumeData + steps add hue hain). digital-spreadsheets-generation.json
    ko RE-IMPORT karo (banks me workout + onboarding add hue hain).
    digital-brand-kit-generation.json ko PEHLI BAAR IMPORT karo (17
    nodes, template workflow ka clone — demand check + retry).
    Template kinds ab 17 hain: resume (RESUME, designed layout — naam,
    title, contact, sections; resumeData input; card size par rotate
    out), onboarding (ONBOARDING, numbered flow chart — steps input,
    max 6; card size par rotate out), wall_art (WALL ART, full-bleed
    photo/giant motif + caption) — plus naya size poster 2400x3000
    (8x10in @300dpi, print-ready PNG; poster size sirf wall_art deta
    hai). kinds filter ab 17 kinds cover karta hai.
    Brand kit: POST /api/v1/digital/brand-kits (brandName + brandColor
    #RRGGBB) — logo SVG+PNG, palette.svg (5 swatches + hex), typography.svg
    (Poppins specimen), brand-guidelines.html (logo usage, colours,
    typography, do/don't) + manifest + zip. Fonts: Poppins OFL.
    Spreadsheets banks ab 8 hain: workout (Workout Log + Summary,
    SUM/SUMPRODUCT formulas) aur onboarding (Onboarding Tracker +
    Checklist, COUNTA formula) — {"kind": "workout"} / {"kind":
    "onboarding"} se bante hain.
    IMAANDAAR LIMIT: Notion aur asli Canva abhi bhi nahi; hyperlinked
    planners nahi; DXF nahi. Pehla live render deploy + re-import ke
    baad. Doc: docs/complete-partial-products.md.
30. TYPOGRAPHY KIT + MARKETING TOOLKIT + WEBSITE TEMPLATE (NEW 2026-11-13)
    digital-typography-kit-generation.json aur
    digital-marketing-toolkit-generation.json ko PEHLI BAAR IMPORT karo
    (17 nodes each, template workflow ke clone — demand check + retry).
    digital-website-template-generation.json ko ABHI IMPORT MAT KARO —
    DISABLED hai (neeche dekho).
    Typography kit: POST /api/v1/digital/typography-kits (kitName) —
    har pairing ki specimen SVG (Anton+Poppins, Fraunces+Poppins,
    Poppins+Poppins) + pairing-guide.html. Font files kabhi included
    nahi hote (OFL — render use only).
    Marketing toolkit: POST /api/v1/digital/marketing-toolkits
    (productName) — sales-copy.md + faq.md + captions.md +
    social-templates/ (4 designs) + launch-checklist.md. Captions sales
    copy se bante hain (deterministic) — pipeline caption-pack module
    route me import NAHI karna (worker-side only; build todta hai).
    Website template: POST /api/v1/digital/website-templates —
    static 3-page site (index + about + contact). DISABLED BY DEFAULT:
    route 503 "disabled" deti hai jab tak deploy .env me
    WEBSITE_TEMPLATES_ENABLED=true na ho. Enable karne ke liye: flag
    true karo + digital-website-template-generation.json import karo.
    IMAANDAAR LIMIT: font files standalone kabhi nahi; website template
    ka pehla live render enable + deploy ke baad. Doc:
    docs/new-products-round2.md.
31. AUTO-GENERATE — FIXED WEEKLY SCHEDULE (NEW 2026-11-13)
    digital-auto-generate.json ko PEHLI BAAR IMPORT karo (3 nodes:
    schedule-trigger -> tick -> report). Yeh 2026-11-08 ke "briefs sirf
    queue hain, generation kabhi auto-start nahi" rule ko REPLACE karta
    hai — ab user ko kuch manually nahi karna.
    Schedule (IST): Mon 07:00 Problem Miner -> Mon 07:30 Idea Briefs ->
    Mon 08:00 AUTO-GENERATE TICK (cron "30 2 * * 1" UTC).
    Har tick: top 3 briefs (demandScore) — har brief ke liye product
    webhook + marketing-toolkit companion + thumbnail companion — PLUS
    top niche se weekly rotation: POD design, prompt library, landing
    page, docs guide, niche spreadsheet tracker, brand kit, typography
    kit. Kul 16 generations/week.
    Dedup: ek brief sirf EK baar banta hai (ledger
    storage/digital/auto-generate/ledger.json); supporting items hafte
    me ek baar (ISO week). Fail hua fire agle tick me dobara try hota
    hai. Briefs na hon ya n8n env na ho to tick kuch trigger nahi karta
    (ok:false + reason).
    Website templates tick me NAHI hain (disabled hi rehte hain);
    LUTs/presets/icons weekly nahi bante (deterministic one-time assets
    — dobara banane se duplicate bante hain).
    Deploy: workflow import karo + backend redeploy (2 naye endpoints:
    POST /api/v1/digital/auto-generate/tick, GET .../latest). Koi naya
    env var nahi (N8N_BASE_URL + N8N_WEBHOOK_SECRET reuse hote hain).
    Pehla live tick: Mon 2026-11-16 08:00 IST (us subah miner + briefs
    bhi chalne chahiye). Doc: docs/auto-generate-schedule.md.
32. SEASON MODE (NEW 2026-11-13)
    Season mode code me hai — koi naya workflow import nahi chahiye,
    sirf backend redeploy. Rule: season ko +25 boost milta hai, lekin
    kabhi absolute override nahi — season product se zyada chance wala
    dusra product hamesha jeetega (seasonal 60 -> 85, non-seasonal 90
    se haarta hai; seasonal 70 -> 95, non-seasonal 90 ko hara deta hai).
    Seasons (saal me repeat): Wedding Nov-Feb + Apr-Jun, New Year
    Planners Nov-Jan, Back to School Jun-Aug, Festive (Diwali) Oct-Nov,
    Ramadan & Eid (2026 dates — har saal ~11 din pehle shift hoti hain,
    aage badhani hongi ya storage/digital/seasons.json se override karo).
    Asar 3 jagah: (1) Somvaar tick top-3 briefs ko season score se
    chunta hai (ledger entry me season + score likha jata hai);
    (2) seasonal campaign ki pace 0.2 tez hoti hai — jaldi saare
    platforms par jata hai, reason me "season: ... — tez push" likha
    aata hai; (3) GET /api/v1/digital/seasons/current — abhi kaunsa
    season active hai + agla kab shuru hoga. Pehla live asar: Mon
    2026-11-16 tick (Nov 16 Wedding Season + New Year Planners ke
    andar hai). Doc: docs/season-mode.md.
33. MARKETING BRAIN (NEW 2026-11-13)
    User ki setting: affiliate roz 1 reel IG par; digital har product
    hafte me ek martaba zaroor promote ho; har digital product par reel
    zaroori nahi — agar uski marketing dusri taraf se ho rahi hai to IG
    par carousel kaafi hai; sirf trigger nahi — ek brain jo samjhe ki
    konse waqt konsa product promote karna hai, prediction almost sahi.
    Brain: roz 06:30 IST plan banata hai (affiliate ki reel + 4 slots
    + dailyAd) — score 0-100: demand 50 + season +25 + trend x1.15/0.85
    + past performance x0.7-1.3 + fresh +5 + coverage urgency (7 din se
    promote nahi hua to +30 — yahi hafte-wala rule enforce karta hai).
    Prediction ki accuracy MEASURE hoti hai (top-pick accuracy vs real
    views) — cold start par null, guarantee nahi. Affiliate: top ready
    video (COMPLETED + FinalVideo, published excluded) ko existing
    affiliate/instagram webhook se fire karta hai — AFFILIATE WORKFLOWS
    MEIN ZERO CHANGES. Carousel: Graph API (item containers -> CAROUSEL
    -> publish), pack PNGs public URLs se (GET /api/v1/digital/files/).
    Campaigns tick plan order me chalti hai; plan pick carousel ho to
    video ad ki jagah carousel (fail ho to video ad fallback); gap/pace
    untouched. NAYA workflow digital-marketing-brain.json (roz 06:30
    IST) — FIRST IMPORT. RE-IMPORT: digital-ads-daily.json (brain ka
    dailyAd pehle, queue fallback) + digital-instagram-publishing.json
    (carousel branch). Backend redeploy bhi chahiye. Doc:
    docs/marketing-brain.md.
    MULTI-CHANNEL (2026-11-13, user: "sirf IG ko hi mandatory mt rakho,
    jaha bhi product ki demand hai viewers ko us ki zarurat hai waha rakh
    do"): har brain pick me ab `placements` hain (channel + format +
    reason) — IG anchor, FB reels ke saath, Pinterest pin / LinkedIn
    post / X draft platform-fit (high/medium only) + pichle per-channel
    views as demand evidence. Brain decide karta hai KAHAN, pace decide
    karta hai KAB (post/wait + gap). Carousel pick: IG carousel +
    multiPublish() lib (Pinterest + LinkedIn + X draft, pack image ke
    saath); FB carousel ka raasta nahi (skip, reason ke saath).
    Affiliate daily reel: IG + FB dono webhooks. Multi-publish route ka
    logic src/lib/publishing/multi-publish.ts me nikala (route behavior
    same). Tests: brain 42/42, multi-platform 24/24, campaigns 35/35.
    Koi naya workflow import nahi — sirf backend redeploy.
