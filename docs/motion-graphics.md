# Motion graphics — "ONE editor" promo style

Analyzed 2026-11-10 from the user's uploaded clip (21.4s screen recording,
1366x766, of the YouTube video "How to edit videos using Claude | AI Video
Editing Masterclass", chapter "Sound design and licensing", 10:24/13:06).
The clip is a promo for an AI video editor ("ONE editor"); the analysis is
of its MOTION-GRAPHICS language, not of the Claude tool itself.

## What the reference does (verified from the file's frames)

- **Kinetic typography.** "Drop your *footage*." — white sans + blue italic
  serif accent word + sparkle. "Raw in. *Remarkable* out." Same device:
  one word in italic serif, the rest in bold sans.
- **Progress + counting.** "We cut. 18/100" → "We grade. 56/100" →
  "We caption. 89/100" → "We sound. 98/100" → "We motion. 100/100" →
  "Done ✓" with a glowing blue progress bar.
- **Step-list reveal.** Timeline blocks labelled "cut. / grade. / caption. /
  sound. / motion." in italic serif on coloured blocks (blue/white/cyan/
  purple), revealed one by one.
- **Format carousel.** "Made for YouTube. / Shorts. / Reels. / Ads. / Docs."
  — same line, the format word swaps, portrait still in a rounded frame.
- **Animated counters.** "298+ → 896+ → 1,000+ happy creators." then
  "1,000+ happy founders / brands" + logo row (Cisco, Razer, Microsoft…).
- **UI mockups.** File card ("raw_footage_FINAL.mov, 4.2 GB · 47 clips ·
  1h 12m" + "Send to editor" pill), preview window ("final_cut_v3.mp4",
  caption "THIS CHANGED EVERYTHING" with the key word in a blue pill).
- **Look.** Near-black background, blue glow top-centre, dark navy cards.
  Same premium-dark family as our Premium Dark preset, blue accent instead
  of product-colour accent.

## What transferred into this pipeline

New module `src/lib/pipeline/motion.ts` — motion-graphics overlays as ASS
Dialogue events, burned in with the captions in the same subtitles pass
(no extra ffmpeg step, no new dependency, no new provider):

1. **Motion hook card** (replaces the static drawtext card from
   2026-11-09). The scene-1 hook question as 96px bold display type —
   line 1 white, line 2 neon-green accent — rising 40px and fading in
   over the first 0.4s, visible 0–2.5s. UPDATE 2026-11-10 (Nafay 3D
   editor, docs/ai-video-editor.md): the card now **slams** — line 1 at
   t=0, line 2 at 0.35s, each starting 25% oversize and settling to 96px
   in 180ms — and uses the editor's fonts: line 1 in Anton condensed
   caps, line 2 in Fraunces serif (real families "CVE anton-400" /
   "CVE fraunces-700"). UPDATE 2026-11-10 (AIpreneur,
   docs/aipreneur-style.md): the accent line now gets a **green underline
   sweep** — a 560×10px bar sliding in from the left in 300ms, landing
   under line 2. Same guards as before (price on the raw text
   disables it; non-Roman stripped).
2. **Feature checklist reveal.** Up to 4 verified features as "✓ ..."
   lines on the last product scene, appearing one by one 0.6s apart
   (fade + rise), staying till the scene ends. Source: the creative
   plan's `sellingPoints` (verified features only — never invented).
   Price lines are skipped.

Both are **brand_story-only** (gated in `buildRenderInputs`), so
standard/numbered jobs render exactly as before. Wiring:
`render.ts` step 5 appends the events via the new `extraEvents` option
on `cuesToAss` / `cuesToKineticAss` (`assets.ts`); the checklist window
is computed from the real scene durations in `renderFinalVideo`.

## What did NOT transfer (honest gaps)

- **Animated counters ("1,000+ happy creators").** Their numbers are
  social proof. Our product ads must never invent such numbers. A
  count-up of a *verified numeric feature* (e.g. capacity) is possible
  later, but it needs a structured number from the script — phase 2,
  not built.
- **Progress bar / processing UI** ("We cut. 18/100"). It demos an
  editor product processing footage; it has no honest place in a product
  ad. The step-list reveal covers the same motion language.
- **"Made for X" carousel + logo row.** The carousel needs use-case
  labels (not structured in our scripts yet); the logo row needs real
  client logos (we have none, and fake logos would be deceptive).
- **Italic serif accent word.** The reference sets one word in italic
  serif; our caption font is DejaVu Sans only. The hook card uses bold
  display type + green accent instead — same emphasis, no new font.
- **Full Remotion motion scenes.** The video pool already has a Remotion
  lane, but building whole motion-graphics scenes in Remotion is a
  bigger job (React scenes + render service). The ASS kit covers the
  highest-impact moves with zero new infrastructure.

## Bug found by the probe (fixed same day)

`escapeAssText` escaped commas to `\,` — but a comma needs no escaping
in an ASS Text field (it is the last field), and libass renders `\,`
literally. The probe frame showed "AREY\, YE TOH". Fixed in `assets.ts`
(comma no longer escaped); this also fixes a latent bug in ALL captions
(any narration comma previously rendered with a backslash). Regression
tests added in `test-motion-graphics.ts`.

## How to use

Same as brand_story: Script style → "Brand story", Visual style →
Premium Dark, Duration → 60–120s. The motion hook card and the feature
checklist appear automatically; no new option to set. If the script
model omits scene-1 onScreenText, the video renders normally without a
card; if the plan has no selling points, no checklist — never fails.

## Verification

- `scripts/test-motion-graphics.ts` **36/36** (hook events, checklist
  stagger/caps/guards, ASS escaping regression).
- `scripts/test-script-style.ts` 28/28, `scripts/test-kinetic-captions.ts`
  20/20 (escape change did not break captions).
- tsc/eslint/build green.
- Real FFmpeg probe (6s 1080x1920 clip, real ASS incl. kinetic captions):
  frames at 0.2s (hook mid-fade, still rising), 1.5s (hook full: white
  line 1 + green line 2, comma clean), 4.5s (checklist lines 1–2 visible,
  ✓ green, staggered as designed). Frames verified visually.
- NOT live-tested: full end-to-end brand_story job (needs Postgres +
  deploy, same as the brand-story format itself).
