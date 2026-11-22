# Attar-luxury style (ATTAR ad, user-shared 2026-11-11)

## The reference

User-shared MP4 (`workspace/user/media_library/video/9b/9b60f8c4…mp4`),
12.08s, 720×1280 @ 24fps, H.264 + AAC stereo. Frames + cut points
verified with ffprobe/ffmpeg in the sandbox (not guessed from a
thumbnail):

| Shot | Time | What happens |
| --- | --- | --- |
| 1 Hero | 0–3.5s | Faceted amber bottle on dark oud wood, rose petals, scalloped arch glowing behind, mashrabiya lattice light on the right; slow push-in |
| 2 Drop | 3.5–7.1s | Extreme macro: glass dropper, one golden oil drop falls onto a red rose petal |
| 3 Ritual | 7.1–9.5s | Hands only apply the product to a wrist with a petal; bottle small, soft-focus behind; lattice shadows everywhere |
| 4 End card | 9.5–12.1s | Hero close-up, warm bokeh; serif title `ATTAR` (wide-tracked caps) + italic tagline `the essence that stays` |

No on-screen text except the end card. No burnt-in captions. Audio
track exists (AAC, mean −18.8 dB) but speech was **not** transcribed
here — no voiceover or caption cue is visible in any frame, so the ad
works as a silent/music-only visual piece. That matters for what
transfers (below).

## What transfers (built)

New `scriptStyle: "attar_luxury"` — always **4 scenes** (the 4-beat
structure IS the style, even at 15s), 15s duration floor like
macro-hero/banner-unroll, dashboard dropdown entry.

- **Script** (`src/lib/pipeline/script.ts`): Hero → Drop → Ritual →
  End card. Scene 4 onScreenText is ONE short tagline (≤60 chars)
  built ONLY from a verified feature — the prompt explicitly forbids
  invented longevity/strength/efficacy claims (`no 'lasts all day',
  no 'strongest', no 'best'`). The reference tagline "the essence
  that stays" is a longevity claim — in our pipeline that wording is
  only allowed if it comes from a verified product fact.
- **Storyboard** (`src/lib/pipeline/storyboard.ts`): purposes
  `hero → ingredient → ritual → call_to_action`. New purpose
  `ritual`. Visual prompts: warm golden-hour light, one warm colour
  world (product's own first colour), scalloped arch + mashrabiya
  lattice shadows, oud wood + rose petals as props. Pack-untouched
  rule in EVERY prompt; the 900-char cap can never cut it (the hero
  prompt carries the rule early — a test caught a truncation once).
  Compliance notes: pack artefacts (misspelled pack text, redesigned
  logo) are a review fail; end-card tagline must come from verified
  facts only.
- **Camera** (`src/lib/pipeline/camera-templates.ts`): `ritual →
  classic_dolly` (calm dolly-in); ingredient → macro_detail
  (macro_zoom, the slow push-in); hero → classic_dolly.
- **Serif title card** (`src/lib/pipeline/motion.ts` +
  `render.ts`): the end card's brand title in wide-tracked Fraunces
  serif caps (`CVE fraunces-700`, 88px, `\fsp14`, gold `&H41B3E3&`)
  + italic tagline (44px, white) under it, top-centered, fading in
  over the last scene. Title from research brand (else product name);
  tagline from the last storyboard scene's onScreenText[0]. Guards:
  price in the tagline drops the tagline only; price in the title (or
  empty title) drops the whole card. Gated to attar_luxury only.
- **Schema/wiring** (`src/lib/schemas.ts`,
  `src/lib/pipeline/types.ts`, `src/lib/pipeline/creative.ts`,
  `src/app/page.tsx`): enum + narrative structure + 15s floor +
  dashboard option `Attar luxury (Hero → Drop → Ritual → serif end
  card)`. No DB migration — scriptStyle is a plain string in Job.

## What does NOT transfer

- **Music**: the reference is music-only. Music/SFX stay banned
  (Shariah rule). Our Hinglish voiceover + captions stay — that is
  the system's identity, same call as the Aminul verdict.
- **The exact tagline**: "the essence that stays" is the reference
  brand's own line. Ours is generated per product from verified
  facts only.
- **Faces**: the reference shows none (hands only in the ritual
  shot). The ritual prompt enforces hands-and-wrist only, no faces,
  no full body — consistent with the no-fake-people rule.
- **Water/ice motion**: not in this ad; the ZeroGPU unlock (14 Nov)
  still gates true AI motion.

## Verification (2026-11-11)

- `scripts/test-attar-luxury.ts` **38/38** (new): purposes order,
  all four visual prompts (arch/lattice/props/pack rule/no faces),
  camera mapping, serif-card events (font, tracking, gold, timing),
  price guards, schema accept/reject.
- `scripts/test-script-style.ts` **63/63** (was 53/53; +10 attar
  checks: 4 scenes at 15s and 45s, STRUCTURE block beats, longevity
  ban, tagline instruction, price rejection).
- Serif title card visually verified: real FFmpeg burn of the ASS
  onto a warm still — gold spaced caps `ATTAR` + italic tagline,
  captions clear of the title, no overlap.
- tsc/eslint/build green (see delivery message for the run).

## Not live-tested

No complete attar_luxury job has rendered on deployment
infrastructure yet — needs Postgres + backend redeploy on the Oracle
VM (no migration needed). Fonts arrive via the Docker image rebuild
(Fraunces is already in `assets/fonts/`).
