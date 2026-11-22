# AIpreneur style

Analyzed 2026-11-10 from https://www.youtube.com/@AIpreneur2176
(channel ID `UCGs1DLZeVPYk053LbgNd0Og`, verified via channelMetadataRenderer
externalId). **36.1K subscribers, 59 videos.** "Infopreneur" channel: make
money online with AI, AI side hustles, faceless YouTube automation,
ChatGPT tutorials, NotebookLM channel engines.

## Top videos (Popular sort, 2026-11-10)

1. "Stop Copying YouTube Channels. Use This AI Automation Instead!" — 223K views, 13:42
2. "I Turned NotebookLM Into a History Channel Engine (Full Workflow)" — 199K views, 9:42
3. "The Secret NotebookLM Workflow Every YouTuber Needs!" — 178K views, 14:16
4. "I Made Insane 3D Motion Graphics With Claude (Free)" — 169K views, 9:02
5. "How to Create High-Quality AI Videos Faster" — 164K views, 10:03

Two motion-graphics videos watched in detail (openings + middle sections):
#4 above and "I Made These Motion Graphics Videos Inside One Claude
Chat" (21K views, 10:05).

## The editing style (verified from the videos)

- **Format:** faceless 16:9 long-form tutorials (9–14 min), AI voiceover,
  visible cursor, screen recordings of Claude / Google Flow. NOT Shorts.
- **Hook:** opens straight on the finished demo montage — no title card,
  no presenter. Video 1: cream background, huge black kinetic type
  "HOLE / PULLING / GAP", grey marble 3D brain with a glowing orange
  hole, tiny running man. Video 2: pink background, three phone mockups,
  bold black "The algorithm", red/green style labels flashing.
- **Captions:** tutorial narration has burned-in captions — bold white
  sans-serif, 1–2 lines, centred at the bottom on a semi-transparent
  black bar, whole lines at once (NOT word-by-word). The demo clips have
  their own kinetic captions instead: black-on-white sticker words,
  orange keyword highlights, torn-paper cards.
- **Motion graphics:** 3D-kinetic-typography demos — giant words
  slam/scale in, camera zooms into the orange hole to change scene. Five
  named styles in video 2 (YouTube-clean, neo-brutal/sticker, editorial
  collage…): each keyword "slams on as a coloured sticker"; neo-brutal
  demo "STOP WAITING FOR MOTIVATION" lands as black-on-white stickers
  with yellow highlighting, stars, and a pop-up Like/Subscribed/bell
  animation; editorial-collage demo has an orange paper strip sweeping in
  and lines landing on torn-paper cards with keywords fading in orange.
- **Transitions:** hard cuts dominate; demo scene changes use a zoom
  (into the hole) or slide/sweep entrances. No whip pans or glitches.
- **Pacing:** demo montage cuts every 1–3 seconds; tutorial sections a
  new screen/prompt/highlight every ~5–15 seconds. No continuous music
  bed; SFX are designed per moment (their SFX table: entrance "cartoon
  whoosh-up", key word "sticker slam / heavy thud", exit "quick
  swish-drop", each mapped to an exact time).
- **Colours:** demo — cream/off-white, black, grey marble, glowing
  orange; tutorial UI — Claude white/cream + orange asterisk. Orange is
  the recurring accent.
- **Thumbnails:** high-contrast busy collages — huge condensed all-caps
  sans-serif (often red/white/yellow/green highlight blocks, e.g.
  "CLONE ANY CHANNEL", "3D MOTION GRAPHICS"), UI screenshots / phone
  mockups / graphic elements on dark or plain light backgrounds; faces
  rare. Banner: dark navy/black with a gold "AP" logo.
- **"Made with AI" label:** no on-screen badge was seen; the AI origin
  is explicit in titles, narration and hashtags (#ClaudeAI
  #MotionGraphics #ClaudeSkills).

## What transferred into this pipeline

All brand_story-only (same gating as the motion kit):

1. **Sticker-highlight kinetic captions.** The current word now renders
   as a black-on-yellow sticker — black text with a thick yellow outline
   (`\1c` black + `\3c` yellow + `\bord8`, reset after the word) — the
   neo-brutal sticker look. `cuesToKineticAss` gained `stickerHighlight`;
   `render.ts` sets it for brand_story jobs only. Standard/numbered jobs
   keep the orange word highlight. (A true background box per word is
   impossible in ASS without measuring word positions — the thick-outline
   sticker is the honest equivalent, verified visually.)
2. **Hook underline sweep.** The hook card's accent line now gets a
   green bar (560×10px) that slides in from the left in 300ms and lands
   under line 2 — the paper-strip sweep language, adapted to our green
   accent. Implemented as a `{\p1}` drawing event in `hookCardAssEvents`
   (2-line hooks only). The bar sits 248px below the block top so it
   clears the accent line even while the line is still rising.
3. **Thumbnail title font → Anton.** `thumbnails.ts` font candidates now
   try Anton first (condensed all-caps — the channel's thumbnail type).
   The title box + orange accent bar were already there. In the sandbox
   it still falls back (no system Anton); on the VM the Docker image
   already ships Anton.

## What did NOT transfer (honest gaps)

- **3D-kinetic-typography demos** (marble brain, zoom into the hole).
  Real 3D renders need a 3D engine (Claude/Flow in their case); our
  image chain does 2D stills + FFmpeg motion. The zoom-into-hole scene
  transition is phase 2 (needs a split + zoompan tail on scene segments;
  our per-scene camera motion already provides the zoom language, and a
  transition zoom on top risks visual clutter + duration drift).
- **Demo-first montage hook.** Their long-form tutorials open with a
  showreel of finished clips. Our 60–120s ads open with the hook card
  instead — a montage would eat the whole first scene. Same idea, right
  scale for the format.
- **Whole-line captions on a black bar** (their tutorial captions). Our
  kinetic word-highlight captions are the better fit for Reels/Shorts —
  a black bar eats vertical screen space.
- **SFX table** (whoosh-up / sticker slam / swish-drop per moment).
  SFX are banned by the Shariah filter — the visual slam stays, its
  sound does not. The *mapping* idea (one named motion per moment) is
  already how our motion kit is built.
- **16:9 tutorial format, screen recordings, cursor.** We make 9:16
  product ads, not tutorials — nothing to take.
- **Five named demo styles as a system** (YouTube-clean, neo-brutal,
  editorial collage…). Only the sticker + sweep languages transferred;
  the full style system is a Claude-canvas product, not an FFmpeg one.

## Verification

- `scripts/test-motion-graphics.ts` **43/43** (sweep event: `\p1`,
  slide `\move(-60,928,540,928,0,300)`, starts 0.35s, absent for 1-line
  hooks; long hook now 3 events).
- `scripts/test-kinetic-captions.ts` **26/26** (sticker: black text +
  yellow `\bord8` + reset; default mode keeps orange, no sticker).
- `scripts/test-script-style.ts` 28/28, `test-audio-joins.ts` 10/10,
  `test-guide-improvements.ts` 15/15, `test-digital-thumbnails.ts`
  15/15.
- tsc/eslint/build green.
- Real FFmpeg probe (6s 1080×1920, real ASS with sticker captions):
  frame at 0.5s shows the green bar mid-slide from the left, clear of
  the rising text, and the sticker word "ek" black-on-yellow; frame at
  1.5s shows the bar landed centered under "PROTEIN HAI!" and the
  sticker word "powder". Frames verified visually. (First probe caught
  the bar overlapping the rising text by ~12px — moved down 20px and
  re-verified.)
- NOT live-tested: full end-to-end brand_story job (needs Postgres +
  deploy). Backend redeploy needed (render + assets changes).
