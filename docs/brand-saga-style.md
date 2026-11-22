# The Brand Saga style — analysis + what transferred

Analyzed 2026-11-09 from https://www.youtube.com/@TheBrandSaga
(channel ID `UCBfSTYjdZgKiLowOySscDjA`, verified via channelMetadataRenderer —
note: the first `channelId` string in the page HTML belongs to a different
channel, "Reality Rundown"; always read `externalId`).

## The channel (verified)

- **The Brand SAGA** — Arpit Shukla (Instagram @me.arpitshukla, The_Brand_Saga).
- **50.1K subscribers** (2026-11-09). Indian brand/business-story Shorts, Hinglish.
- Cadence: near-daily Oct–Nov 2026. View counts vary wildly by hook/topic:
  538 views (latest) to 718,126 (top).
- Top video: "How BOHECO Turned India's Banned-Image Plant Into a Protein
  Business!" — **2:05 (125s), 718,126 views, 23,598 likes** (2026-10-14).
  Other strong ones: "How ₹10 Popcorn Became a ₹226 Crore Business" (220K),
  "How Red Tape Built a ₹7,000 Cr Footwear Empire" (174K),
  "How Jackfruit Became a ₹1 Crore Monthly Business" (154K).
- YouTube labels the top video **"Made with AI — Sounds or visuals were
  altered or fully generated"** and **"Auto-dubbed"**. So: AI-generated or
  AI-altered visuals + AI dubbing. Frame at 0:07 shows a staged live-action
  style shot (two men, hemp plant, BOHECO pack) — cannot tell from one
  frame how much is AI vs staged; the label is the honest evidence.
- Transcript could NOT be retrieved: the "Show transcript" panel opened
  but showed "No results found" (Hindi auto-generated captions listed).
  Narration pacing/wording below is inferred from the description +
  on-screen text, not from a transcript — stated, not assumed.

## Editing breakdown (what they do)

1. **Hook in frame 1, oversized.** Every video opens with a huge question
   or shocking number as on-screen text: "AREY, YE TOH PROTEIN HAI!",
   "GANJA OR PROTEIN?", "JUST ₹10", "₹1 CRORE / MONTH?!". White bold +
   neon-green accent, mid-screen, over the first scene.
2. **Thumbnail = same formula.** Dark cinematic base + one neon-green
   accent + hero product packshot + strong-emotion face + oversized hook
   text. 6 thumbnails checked, all identical in structure.
3. **Story beats, not feature list.** Hook question → origin (where it
   started / the problem) → twist (the turning point) → proof (numbers)
   → lesson. Description repeats the pattern: story + hook question
   ("Can changing how people see a product change an entire business?")
   + "Watch till the end" + hashtags + fair-use disclaimer (they reuse
   third-party footage/images under fair use).
4. **Burnt-in captions** at the bottom plus the big mid-screen hook text.
5. **Long Shorts.** Top video is 125s — YouTube Shorts now allow up to
   3 min. Our old 15s Premium Dark short format is a different genre.

## What transferred into this pipeline

New script style **`brand_story`** (`scriptStyle: "brand_story"`):

- `src/lib/pipeline/script.ts` — `ScriptStyle` gains `"brand_story"`;
  `sceneCountForStyle()` (shared with creative.ts): 5 scenes at 45–60s,
  6 scenes at 75–120s, 3 when short. Prompt STRUCTURE block maps the
  beats: Hook question → Origin → Twist → Proof → Lesson → CTA.
  The Proof beat is explicitly forbidden from inventing sales, revenue,
  funding, founder, or market numbers — only verified features.
  Scene-1 onScreenText: the hook as a short punchy question, max 40 chars.
- `src/lib/pipeline/creative.ts` — plan narrativeStructure gains the
  brand-story branch; duration clamp raised to **120s** for brand_story
  (60s cap unchanged for other styles); scene count uses the shared
  helper so plan and script always agree.
- `src/lib/pipeline/render.ts` + `src/lib/pipeline/motion.ts` — **hook
  card**: `hookCardAssEvents()` burns the scene-1 onScreenText onto the
  first scene for the first 2.5s as a motion-graphics ASS overlay (rise
  + fade, 96px bold, line 1 white, line 2 neon green `&H80DE4A&`, the
  channel's accent), centered mid-screen. UPDATE 2026-11-10: the original
  static drawtext version was replaced by this animated ASS version
  (docs/motion-graphics.md). Guards: empty → none; any price/offer
  mention (checked on the RAW text, before stripping, so ₹ is caught) →
  none; non-Roman chars stripped (no emoji boxes). Wired in
  `buildRenderInputs` only when `job.scriptStyle === "brand_story"`;
  other styles render exactly as before.
- `src/lib/schemas.ts` — `createJobSchema.scriptStyle` accepts
  `"brand_story"`. `durationSeconds` already allowed 15–180.
- `src/app/page.tsx` — dashboard "Script style" dropdown gains the
  "Brand story" option. Duration input already allowed 15–180.
- Tests: `scripts/test-script-style.ts` 28/28 (incl. brand-story beats,
  5 scenes @60s, 6 @90s, 3 @15s, price still rejected);
  `scripts/test-hook-card.ts` 18/18 (wrap, accent, guards, escaping).
  tsc/eslint/build green. Real FFmpeg probe: the exact filter string
  renders 1080x1920 h264, frame visually verified (white line 1 + green
  line 2, exactly the reference look).

## What did NOT transfer (honest gaps)

- **Real human faces.** Their thumbnails/videos lean on founder and
  reaction faces. We generate product renders, not people — an AI face
  presented as a real founder would be deceptive. No face generation.
- **Music / SFX.** They use both. Shariah rule: no music in our videos.
  Voiceover + captions carry the video.
- **Price hooks in thumbnails** ("JUST ₹10", "₹1 CRORE / MONTH?!").
  Our rule bans prices in videos; the hook QUESTION structure transfers
  without the price ("Ganja ya protein?").
- **Revenue/valuation numbers** ("₹226 Cr business"). Their numbers come
  from reporting; our pipeline must never invent them. The brand_story
  prompt forbids invented numbers in the Proof beat.
- **Fair-use footage.** They reuse third-party clips; we use AI visuals
  (Pollinations/Spaces/FFmpeg) — no copyright exposure, but also no real
  archival footage.

## How to use

- Dashboard: Script style → "Brand story", Visual style → Premium Dark,
  Duration → 60–120 (90 recommended for the full 6-beat arc).
- API: `POST /api/v1/jobs` with `scriptStyle: "brand_story"`,
  `visualStyle: "premium_dark"`, `durationSeconds: 90`.
- n8n: the digital ads-marketing workflow posts `scriptStyle: "numbered"`
  today — pass `"brand_story"` instead for story-style product ads.
- The hook card needs scene-1 onScreenText from the script model; if the
  model omits it, the video renders normally without a card (never fails).

## Not yet live-tested

Full end-to-end job with `brand_story` (script → TTS → render → QA)
needs Postgres + the deployed backend; the pieces are unit-tested and
the render filter is probe-verified, but no complete brand-story video
has been rendered yet. First live run should be on the VM after redeploy.
