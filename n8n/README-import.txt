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

21. AUTO-GENERATE TICK (NEW 2026-11-13 - Somvaar ki subah khud generation)
    digital-auto-generate.json (3 nodes, cron `30 2 * * 1` UTC = Mon 08:00 IST)
      Schedule -> top 3 queued briefs (demand + season boost) + weekly
      supporting rotation (POD, prompt library, landing page, docs guide,
      niche spreadsheet, brand kit, typography kit) -> generation webhooks.
      First import; active: False by default — import ke baad ACTIVATE karo.
      No new env vars (N8N_BASE_URL + N8N_WEBHOOK_SECRET reuse hote hain).
      Pehla live tick: Mon 2026-11-16 08:00 IST — usi subah Problem Miner
      (07:00) + Idea Briefs (07:30) bhi chalne chahiye, warna tick
      "no_briefs" dekar kuch trigger nahi karega. Website templates is
      tick mein NAHI hain (abhi disabled hain).

22. MARKETING CAMPAIGNS (NEW 2026-11-11 - target-driven smart marketing)
    digital-marketing-campaigns.json (3 nodes,
      cron `0 2,3,14,15 * * *` UTC = 07:30/08:30/19:30/20:30 IST)
      Har campaign: product URL + title + type + optional target (views/
      clicks/posts/sales, value, deadline 1-90 days). Platform-fit analyzer
      tay karta hai kahan post ho; peak windows + 24h gap tay karte hain
      kab; pace math tay karta hai kitni zor se. First import; import ke
      baad ACTIVATE karo. Sales measure nahi hoti jab tak selling layer
      parked hai (views proxy se chalta hai).

23. BEAT-THE-TOP LOOP (NEW 2026-11-11 - har field/platform ka #1 track karo)
    digital-beat-the-top.json (4 nodes, cron `30 3 * * 0` UTC = Sun 09:00 IST)
      Schedule -> POST /beat/collect. #1 ka metric goal-loop ka NORTH STAR
      banta hai. Login/bot wall aaye to last-known + warning, kabhi fake
      number nahi. First import; import ke baad ACTIVATE karo.

24. BRAND KIT GENERATION (NEW 2026-11-12 - partial products, mukammal)
    digital-brand-kit-generation.json (17 nodes)
      POST /webhook/digital-brand-kit — brand kit (logo, palette, fonts,
      social templates). First import; same 17-node pattern jaise ebook/
      template generation (demand pre-check + 1 retry on transient failure).

25. TYPOGRAPHY KIT + MARKETING TOOLKIT (NEW 2026-11-13)
    digital-typography-kit-generation.json (17 nodes)
      POST /webhook/digital-typography-kit — 3 font pairings, specimen SVG
      + pairing guide. Font files kabhi include/sell nahi hote.
    digital-marketing-toolkit-generation.json (17 nodes)
      POST /webhook/digital-marketing-toolkit — sales copy (buyer-
      psychology edition) + FAQ + captions + 4 social templates + launch
      checklist. Dono first import; import ke baad ACTIVATE karo.

26. WEBSITE TEMPLATE — ABHI IMPORT MAT KARO (DISABLED)
    digital-website-template-generation.json (17 nodes)
      POST /webhook/digital-website-template — static 3-page site.
      Route WEBSITE_TEMPLATES_ENABLED se band hai (default off, 503 deta
      hai). Sirf tab import karo jab user kahe workflows theek chal rahe
      hain (flag true + tab import). Zip mein file is liye hai taaki
      enable karte waqt dhoondna na pade — import list mein nahi hai.

27. SEASON MODE (NEW 2026-11-13 - koi workflow change/import NAHI)
    Season = +25 boost, kabhi absolute override nahi (seasonal 60 -> 85,
    non-seasonal 90 se haarta hai; seasonal 70 -> 95, non-seasonal 90 ko
    harata hai). 5 seasons: Wedding (Nov-Feb + Apr-Jun), New Year
    Planners (Nov-Jan), Back to School (Jun-Aug), Festive/Diwali
    (Oct-Nov), Ramadan & Eid (2026 dates, config se badli ja sakti hain).
    Sirf backend redeploy chahiye — koi naya workflow import nahi, koi
    naya env var nahi. Pehla live asar: Mon 2026-11-16 ke tick par
    (Wedding Season + New Year Planners dono active hain).

NOTE (2026-11-13): digital-workflows-4-pack.zip ab 36 files hai — upar
  wale 7 naye workflows (21-25 + website-template file) add hue. Purana
  Nov-8 zip use mat karo, usme auto-generate/campaigns/beat-the-top
  nahi hain. Deploy par import hamesha n8n/workflows/ se karo, zip se
  nahi — zip sirf convenience copy hai.

28. CROSS-TRANSFER (NEW 2026-11-13 - affiliate <-> digital techniques)
    User: "affiliate k jitne techniques hain un sb ko digital me add kr do
    aur digital k jitne hain sb k sb affiliate me dal do" (digital-specific
    marketing — campaigns, email nurture/freebie/review, landing pages,
    presell/PMF, auto-generate, machine+strategist, beat-the-top — EXCLUDED).
    Techniques existing workflows me integrate ki gayi hain; sirf 2 naye
    workflows hain. Live n8n par 2026-11-13 import ho gaya: 57 -> 59,
    sab inactive, koi duplicate nahi. Detail: docs/cross-transfer.md.

    FIRST IMPORT (2 naye):
      affiliate/pinterest-volume.json — affiliate Pinterest queue (Wed
        06:30 IST, 7 pins); env AFFILIATE_PINTEREST_QUEUE_JSON.
      digital-error-recovery.json — digital error sweep webhook
        digital/error-sweep (affiliate/error-recovery ka clone).
    RE-IMPORT / REPLACE (11 edited — live row pehle delete karo, phir
    import karo; sirf import karne se DUPLICATE banta hai):
      digital-marketing-goal-loop.json — weekly report branch (GET
        /api/v1/marketing/reports/weekly, optional REPORT_WEBHOOK_URL post).
      digital-ads-marketing.json — link validation + QC gate (validate-link
        -> create-ad-job; reels-ready -> qc-check -> pass/review/fail);
        trigger-ig/fb ab jobId bhejte hain.
      affiliate/weekly-reporting.json — gather stub ki jagah real GET
        reports/weekly + sweep-goals fork (goal-loop gaps sweep).
      affiliate/product-discovery.json — season-rank step (neutral
        demandScore 50 + season +25; ranking nudge hai, gate nahi).
      affiliate/instagram-auto-dm.json — DIGITAL LANE (media-based branch):
        DM_DIGITAL_LINK_MAP_JSON wali media ko DM_DIGITAL_TEMPLATE, bina
        affiliate disclosure. Meta ek app ko ek webhook URL deta hai, is
        liye alag digital workflow kabhi comment events receive nahi kar
        sakta. DM_KEYWORDS me digital keywords (jaise RSVP) add karo.
      affiliate/quality-control.json — trigger-website ab jobId bhejta hai.
      affiliate/website-listing.json — mark-listed jobId passthrough +
        trigger-ig/fb jobId.
      affiliate/instagram-publishing.json, affiliate/facebook-publishing.json,
      digital-instagram-publishing.json, digital-facebook-publishing.json —
        record-publish ab jobId bhejta hai (productId FK hai, name/slug
        bhejne se FK violation hota; sirf jobId safe hai).
    BACKEND REDEPLOY chahiye (4 naye routes + brain/analytics changes):
      GET /api/v1/marketing/reports/weekly, POST /api/v1/publishing/validate-link,
      POST /api/v1/publishing/qc-check, POST /api/v1/discovery/season-rank;
      brain daily route ab plan se pehle analytics collect karta hai.
    ENV (naye, sab optional/commented in .env.example):
      DM_DIGITAL_LINK_MAP_JSON, DM_DIGITAL_TEMPLATE,
      AFFILIATE_PINTEREST_QUEUE_JSON, REPORT_WEBHOOK_URL.
    HONEST CAVEAT — errorWorkflow: repo files me "errorWorkflow" field hai
      (digital-error-recovery / affiliate-error-recovery), lekin n8n 2.43.7
      ka CLI import is field ko SILENTLY DROP kar deta hai — live ID dene
      par bhi (2026-11-13 verify: 11 re-imports, export me 0 workflows ke
      paas errorWorkflow). Error routing live NAHI hai; chahiye to REST API
      (PATCH, API key) ya n8n UI se set karo. Isi liye baaki digital
      workflows ko sirf errorWorkflow ke liye re-import NAHI kiya gaya.
    REGEN CAVEAT: gen-auto-dm.py aur gen-digital-goal-loop.py hi errorWorkflow
      emit karte hain; baaki digital gen-scripts regenerate karne par field
      kho jayega. gen-auto-dm.py ab long-form connections emit karta hai
      (n8n 2.x import ko type+index chahiye; short form reject hota hai).

§29  ORPHAN CLEANUP + ERROR ROUTING (2026-11-16, user: "gaps fix karo")
  Audit (docs/workflow-chain-audit.md) found 10 orphan webhook workflows
  with no caller. RETIRED — live rows deleted via DB surgery, repo files
  moved to n8n/workflows/_retired/ (preserved, with a README on when to
  re-import). Live: 59 -> 49 workflows, all inactive, no duplicates.
  Retired: affiliate-analytics-collection + affiliate-link-validation
  (superseded by backend routes), hub-run + digital: marketing-strategist
  (thin wrappers, API route is the entry), digital: marketing-machine +
  digital: presell-gate (one uncalled pair; no brief source; brain +
  campaigns + ads-daily are the live marketing loop), digital: pmf-survey
  + digital: review-request + digital: pod-approve (need the selling
  layer / live POD), product-video-main (backend POST /api/v1/jobs +
  BullMQ worker is the live path).
  ERROR ROUTING — LIVE NOW (was 0). n8n stores it in workflow SETTINGS
  (settings.errorWorkflow = target workflow ID), NOT as a top-level
  field and NOT in a dedicated column — that is why CLI import drops the
  repo files' top-level "errorWorkflow" field AND why the export shows it
  under "settings" (check settings.errorWorkflow, not top-level).
  Set via DB surgery 2026-11-16 (stop n8n, copy DB+wal, UPDATE settings
  JSON, bump versionId/versionCounter/updatedAt, checkpoint TRUNCATE,
  copy back, sudo rm stale -wal/-shm, restart; backup in
  ~/workspace/n8n-db-backup-2026-11-16/): 17 affiliate workflows ->
  affiliate-error-recovery, 29 digital workflows -> digital-error-recovery,
  both recovery workflows -> product-video-errors (terminal logger, no
  loop), product-video-errors itself -> none. Both recovery workflows
  carry an Error Trigger node + retry logic (max 3, 5-min backoff, spend
  guard, POST /api/v1/jobs/:id/retry exists). Verified via fresh export:
  49 total, 48 with settings.errorWorkflow, 0 active, 0 duplicates.
  NOTE: the workflow_dependency index still shows 0 errorWorkflow rows
  (stale index, rebuilds on save); execution reads settings directly,
  so routing works regardless.
