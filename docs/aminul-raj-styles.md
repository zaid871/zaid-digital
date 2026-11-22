# Aminul + Raj styles (2026-11-11)

Three techniques from two channels analyzed 2026-11-10, built 2026-11-11
after the user's "Haan, teenon add karo". UGC model format was NOT built
(default NO — AI faces clash with the no-fake-people rule).

## Sources

- **Aminul Visuals** — https://www.youtube.com/@aminulvisuals (20 subs;
  style, not audience). Videos watched: "AI Product Video Ads for E
  Commerce Brands" (29s) and "Hyper Realistic AI Product Commercial |
  VITAL FIZZ" (16s). Macro hero shots, condensation/ice/water, one
  colour world, slow push-in, pack design untouched, no voiceover,
  music-only. AI artefact seen: "SPRRKLING" misspelled on the can.
- **Raj Photo Editing and Much More** — https://www.youtube.com/@RajPhotoEditingMuchMore
  (3.66M subs). Videos watched: "Create AI Ads for FREE — Google Flow
  CODES" (392K views), "How to Make FREE AI UGC Ads" (369K views),
  "CGI Banner Unroll Ads" (71K views). Three-prompt chain (5 ideas →
  9-scene storyboard → video), free UGC ads (ZenTube → LMArena Nano
  Banana → Hailuo), banner unroll (closed/open stills → Flow
  Frames-to-Video).

## What was NOT transferred

- **Tools**: Google Flow / Veo 3.1 ("FREE*" = Jio SIM + ₹349 recharge,
  not free), Hailuo (100 credits/day ≈ 4 clips/day), ZenTube, LMArena —
  all website-only, paid, or conditional. No API for automation.
- **Music / no-voiceover format** (Aminul): Shariah rule — Hinglish
  voiceover + captions stay.
- **Discount text**: Raj's gym poster says "50% OFF" — never in our
  videos, captions, or banners (no prices rule).
- **UGC model format** (AI model holding the product): needs the user's
  explicit call — an AI face as a model clashes with the
  no-fake-people rule. Default NO.
- **Flow's product-look changes**: commenters flagged Flow altering the
  product — our image-to-video path keeps the pack untouched instead.

## 1. Macro-hero look — `scriptStyle: "macro_hero"`

Aminul's formula as a script style:

- **Structure**: Ingredient → Craft → Hero → Closing. 3 scenes when
  short (<30s), 4 at 30–60s (`sceneCountForStyle` in `script.ts`).
- **Ingredient**: extreme macro close-up — raw ingredient, texture,
  condensation droplets, shallow depth of field, slow floating push-in
  (`macro_zoom`, the existing `macro_detail` camera template).
- **Craft**: hands at work, the making of the product, dark cinematic
  workshop.
- **Hero**: product as the floating hero centerpiece, near-black
  background, single accent glow, rim light, reflections.
- **One colour world**: the product's own first colour is the single
  dominant colour of every scene (`accentColorFor`).
- **Pack untouched**: every macro-hero image prompt carries the rule
  "Keep the product's original design, logo, colours and packaging
  exactly as shown — do not redesign, relabel, or alter the pack."
  Storyboard compliance notes flag pack artefacts (misspelled pack
  text, redesigned logo) as a review fail — the SPRRKLING lesson.
- **No faces**: hands only when they touch the product.
- Dashboard: "Macro hero (Ingredient → Craft → Hero, pack untouched)".
- Water/ice MOTION (simulated water, tumbling ice) is NOT in this
  build — it needs true AI video (Wan 2.2 / LTX) after the 2026-11-14
  ZeroGPU unlock. The stills + macro_zoom work now.

Files: `src/lib/pipeline/script.ts` (style + prompt block),
`src/lib/pipeline/storyboard.ts` (`macroHeroVisualPromptFor`,
purposes), `src/lib/pipeline/camera-templates.ts` (purposes),
`src/lib/pipeline/creative.ts` (narrative + 15s floor),
`src/lib/schemas.ts`, `src/app/page.tsx`.

## 2. Storyboard chain — `storyboardChain: true`

Raj's ideas-first method, adapted to the pipeline:

- **Step 1** (`src/lib/pipeline/concepts.ts`, `generateAdConcepts`):
  one LLM call generates **5 distinct ad concepts** (title + hook +
  angle) and ranks them (`bestIndex` + `bestReason`). Compliance
  drop-doctrine: a concept tripping the price or banned-claim scan
  is DROPPED with a warning, never replaced with fallback copy. If
  the ranked best is dropped, the best surviving concept wins. If
  all 5 are dropped, the chain throws — no concept is invented.
  Text generation uses the digital module's direct failover
  (groq → gemini → pollinations → hf) with an injectable `textGen`
  for tests — never `providers/fallback.ts` (Turbopack lesson).
- **Step 2**: the winning concept feeds the script prompt
  (`WINNING AD CONCEPT` block — scene 1 MUST open with the concept
  hook) and the script is generated with **9 scenes**
  (`sceneCountForStyle` with `storyboardChain: true`).
- **Step 3**: the 9-scene storyboard is built by the EXISTING
  `buildStoryboard` step — unchanged, no rebuild.
- **Wiring**: `Job.storyboardChain` (Boolean, default false) +
  migration `prisma/migrations/20261111210000_storyboard_chain/`
  (apply at deploy via `prisma migrate deploy`) + `createJobSchema`
  + `createJob`/`serialize` + dashboard checkbox "Storyboard chain
  (5 ideas → best → 9-scene storyboard)". Chain jobs floor at 45s
  and cap at 70s (9 scenes × ~5–7s). The winning concept and all
  survivors are recorded on a `ad_concepts` job event for audit.
- The chain is style-orthogonal: it works with any `scriptStyle`.

Tests: `scripts/test-storyboard-chain.ts` 22/22.

## 3. Banner unroll — `scriptStyle: "banner_unroll"`

Raj's CGI banner-unroll shop ad, rebuilt as pure FFmpeg — no AI
video, no 3D software:

- **Structure**: always 3 scenes — Hook (shop/brand + one offer fact)
  → Unroll (the banner rolls down the facade revealing the poster)
  → Hold + CTA.
- **Two stills**: the storyboard flags scene 2 with `bannerUnroll:
  { bannerText }` (brand name only — a price-like brand string falls
  back to the product name). `generateSceneImages` generates the main
  still (banner closed/folded) plus an open-banner second still
  (`-open.png`) from the same building description. A failed open
  still falls back to a single-image scene, flagged — an unroll is
  never faked from one image.
- **Render** (`animateBannerUnroll` in `src/lib/providers/ffmpeg-motion.ts`):
  one `xfade=transition=wipedown` between the two stills — the open
  banner wipes in top → bottom over 2s, then holds for the rest of
  the scene. Output 1080×1920@30, ffprobe-verified.
- **Verification** (`scripts/test-banner-unroll.ts` 20/20): real render
  from synthetic stills; mid-wipe frame pixel-checked (top rows =
  open colour, bottom rows = closed colour) and visually inspected —
  clean horizontal wipe edge at ~50%, end frame fully open.
- **Banner text rule**: brand name only — never a price, discount,
  or offer (Raj's "50% OFF" is excluded by rule). Enforced in the
  script prompt block, the storyboard compliance notes, and the
  banner-text sanitizer.
- **Honest limit**: the two stills are generated independently, so
  the building may differ slightly between them — the wipe still
  reads as an unroll, but pixel-perfect consistency is not
  guaranteed. True start/end-frame interpolation (Flow Frames) would
  need AI video after the ZeroGPU unlock.

Files: `src/lib/pipeline/schemas.ts` (`bannerUnroll` on
`StoryboardScene`), `src/lib/pipeline/storyboard.ts`,
`src/lib/pipeline/visuals.ts`, `src/lib/providers/ffmpeg-motion.ts`,
`src/lib/pipeline/camera-templates.ts`, `src/lib/pipeline/script.ts`,
`src/lib/pipeline/creative.ts`, `src/lib/schemas.ts`,
`src/app/page.tsx`.

## Verification (2026-11-11)

- test-script-style 53/53 (was 28/28 — 25 new checks for macro_hero,
  banner_unroll, and the chain concept block).
- test-storyboard-chain 22/22 (new).
- test-banner-unroll 20/20 (new; real FFmpeg render + frame pixel
  checks + visual frame inspection).
- test-camera-templates 20/20, test-motion-graphics 43/43,
  test-kinetic-captions 26/26, test-comparison 5/5,
  test-guide-improvements 15/15, test-audio-joins 10/10,
  test-gif 30/30, test-llm-judge 6/6, test-caption-pack 11/11,
  test-visual-direction 13/13, test-premium-dark pass.
- `npx tsc --noEmit` clean, eslint clean on changed files,
  `npm run build` green.
- Full test suite re-run after the build (all `scripts/test-*.ts`).

## NOT live-tested

No complete job has run with any of the three on deployment
infrastructure: a full macro-hero / chain / banner-unroll video needs
Postgres + the backend redeploy on the Oracle VM, plus `prisma
migrate deploy` for the `storyboardChain` column. Water/ice motion
waits for the 2026-11-14 ZeroGPU unlock. Deploy checklist:
`docs/user-checklist.md`.
