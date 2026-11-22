# AI Video Editor (Nafay 3D) — what was added

Analyzed 2026-11-10 from `ai-video-editor.zip` shared by the user (7 MB):
the **AI Video Editor** skill by Nafay 3D (youtube.com/@nafay3d), a Claude
Code skill that edits a **talking-head recording** end to end: Whisper
transcription (faster-whisper, local), silence + mistake cutting
(retakes, false starts) via an agent-written `edits.json`, motion
graphics in **7 styles** from the "Nafay 3D Style Library" drawn in a
headless Chromium canvas engine, SFX + captions, loudness −14 LUFS.
Everything runs **on the user's computer** (Windows/Mac/Linux), **16:9
only**, one continuous recording per edit.

This is the same editor family as the "Claude Video Editor Guide" PDF the
user shared on 2026-10-23 (VenomsTech.AI) — that guide's evaluation still
stands (see docs/video-enhancements.md "Guide #2 adoptions"); this zip is
the actual code + style library behind it.

## Where does OUR video get edited? (the user's question)

The user's video is **never one single 1-minute clip**. It is built from
**separate scene clips** and assembled in the **render stage** — on the
Oracle VM backend (Docker, Next.js worker + FFmpeg), never on the user's
PC, never in a browser.

The pipeline (each scene is its own clip):

| Stage | What happens | Where |
|---|---|---|
| Script | 5–7 scenes (brand_story) or 3–7 (other styles), each with its own narration + visual direction | backend, `src/lib/pipeline/script.ts` |
| Voice | **One MP3 per scene** (edge-tts → hf → pollinations → espeak), lead-in silence trimmed, **join fades** added (see below) | backend, `src/lib/pipeline/voice.ts` |
| Visuals | **One MP4 per scene** (AI image + FFmpeg camera motion, or AI-motion clip) | backend, `src/lib/pipeline/visuals.ts` |
| Captions | One SRT for the whole video, word timings from the real scene timeline | backend, `src/lib/pipeline/assets.ts` |
| **Render = the edit** | Scene MP4s normalized to 1080×1920@30 and **concatenated** (hard cuts, scene 1 fades in); scene MP3s **concatenated**; two-pass loudnorm −14 LUFS; end-card appended; captions + motion overlays burned in; ffprobe verifies | backend, `src/lib/pipeline/render.ts` (`renderFinalVideo`, steps 1–6) |
| QA + delivery | 16 checks (duration, hook-early, loudness-target, dm-cta-present…) → `final.mp4` → signed download URL | backend, `src/lib/pipeline/qa.ts` |

**So: the multiple clips come together in `renderFinalVideo` on the VM,
and the audio comes together in the SAME stage** (step 4: the scene MP3s
are concatenated, normalized, padded for the end-card, then muxed with
the video in step 5). Picture and audio are assembled separately and then
muxed — which is also why there is no A/V drift (the two timelines are
built from the same measured scene durations).

The premium vibe comes from the cuts themselves: a new scene every
~9–20s, each with its own camera motion (orbit/rush/macro), kinetic
word-highlight captions changing ~every second, the slam hook card, the
feature checklist, film grain, and −14 LUFS loudness. A single 60s clip
would feel flat; the multi-clip assembly is the point.

## What transferred from this editor

### 1. Anton + Fraunces fonts (the "Creator Motion Graphics" style)
The style's recipe: "Anton in caps for statements, set big (80–220px);
Instrument Serif italic in yellow for the one word that matters."
- `assets/fonts/anton-400.ttf` + `fraunces-700.ttf` copied from the zip
  (both SIL OFL 1.1, Google Fonts; render-use only, never sold
  standalone). The Dockerfile already copies `assets/fonts/` into the
  image, so no new install step was needed.
- **Gotcha (verified):** the packager renamed the families in these
  files — fontconfig reports **`CVE anton-400`** and **`CVE fraunces-700`**,
  not "Anton"/"Fraunces". The ASS overrides use those exact names
  (`assets/fonts/NAFAY-FONTS.md`). Using "Anton" would silently fall back
  to DejaVu Sans.
- The hook card now renders line 1 in Anton condensed caps (white) and
  line 2 in Fraunces serif (green) — the reference's exact pairing
  (serif accent word), in our green instead of their yellow.

### 2. Slam entrance for the hook card
Their style: "words slam in one at a time (large and blurred, settling
with an expo ease)." Our hook card previously rose + faded as whole
lines. Now (in `src/lib/pipeline/motion.ts`, brand_story only):
- Line 1 slams at t=0, line 2 at t=0.35s.
- Each line starts 25% oversize (`\fs120`) and settles to 96px in 180ms
  (`\t`), while rising 40px and fading in.
- Word-by-word slam (their exact version) is phase 2: it needs real
  per-word x-positions from font measurement (a bridge like the docs
  bridge), not char-count estimates — estimated widths would misalign
  and look cheap. Line-slam is the honest 80%.

### 3. Click-free audio joins
Their `cut.py` ramps **6ms at every join** so cuts have no clicks. Our
scene MP3s were concatenated raw — a tiny click/pop was possible at a
scene boundary. Now `applyJoinFades()` in `voice.ts` fades each scene's
head and tail by **15ms** right after the lead-in trim (non-fatal: on any
ffmpeg error the original file is kept — a fade is polish, never a
reason to fail a scene). Verified sample-by-sample: the join region dips
to near-silence with fades, stays loud without them
(`scripts/test-audio-joins.ts`).

### 4. Pace rule (no code — already true)
Their style card: "the hook lands in under 2 seconds, something new
happens every 0.5 to 1.5 seconds." Our pipeline already meets it: the
hook card slams at t=0, kinetic captions change words ~every second,
the checklist staggers at 0.6s. Noted here so it stays a design rule.

## What did NOT transfer (and why)

- **Whisper transcription (`transcribe.py`, faster-whisper).** Our
  videos have no recorded speech to transcribe — the voiceover is TTS
  generated from a known script, so word timings are already exact.
  (Also rejected 2026-10-23: slow on the 2-OCPU VM, HF inference no
  longer free.)
- **Headless-Chromium canvas engine (`engine/`, `render.py`).** Their
  graphics are drawn in a browser and recorded frame by frame. Swapping
  our FFmpeg+libass render for it was already rejected 2026-10-23 (risk
  exceeds benefit; FFmpeg covers the graphics). The *design* (fonts,
  slam, pace) transferred instead — the engine did not.
- **SFX / music (`SFX` kit: slam/pop/whoosh/boom, music drone).**
  Shariah filter — non-negotiable. The visual slam stays; its sound
  does not.
- **Local-PC execution.** The whole skill runs on the user's computer
  (setup.py installs Whisper + Playwright + a browser locally). Our
  system is cloud-only by the user's own rule — nothing runs on their PC.
- **Mistake/retake cutting (`cut.py` planning, `edits.json`).** There are
  no recorded takes in our pipeline — TTS is generated clean, so there is
  nothing to cut. Only the join-fade kernel transferred.
- **16:9 + center-crop.** Their editor is 16:9-only and center-crops
  vertical video. We are 9:16 native — nothing to take.
- **Rolling counters ("1,000+ happy creators").** Same as the "ONE
  editor" promo: their numbers are social proof. Ours must be verified
  features only — a count-up of a verified numeric feature is phase 2
  (needs a structured number from the script).
- **Other 6 styles** (Warm Canvas, Clean Tech, Chalk Talk, Data Story,
  Pop Info, Software Walkthrough): talking-head / tutorial / data
  styles. Our product ads need only the kinetic-type language, which
  Creator Motion Graphics already covers. The style files stay in the
  zip (not copied into the repo) — only the two fonts were taken.

## Verification

- `scripts/test-motion-graphics.ts` **40/40** (slam: `\fn` Anton/
  Fraunces, `\fs120`→`\t(0,180,\fs96)`, line-2 delay 0.35s, guards).
- `scripts/test-audio-joins.ts` **10/10** (real ffmpeg: faded join dips
  to near-silence vs loud control, MP3 smoke, too-short guard).
- `scripts/test-script-style.ts` 28/28, `test-kinetic-captions.ts`
  20/20, `test-guide-improvements.ts` 15/15.
- tsc/eslint/build green.
- Real FFmpeg probe (6s 1080×1920, real ASS): frame at 0.1s shows line 1
  mid-slam in condensed Anton caps (line 2 absent — stagger working);
  frame at 1.5s shows both lines settled at 96px (the `\t` settle
  persists after 180ms, verified visually) with the Fraunces serif
  accent in green. Frames verified visually.
- NOT live-tested: full end-to-end brand_story job (needs Postgres +
  deploy, same as the brand-story format itself). Backend redeploy
  needed for the new voice-stage fade + motion fonts (the Docker image
  rebuild picks up `assets/fonts/` automatically).
