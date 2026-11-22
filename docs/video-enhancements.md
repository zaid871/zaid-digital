# Video enhancements — camera templates, kinetic captions, loudness & QA

Added 2026-10-23, adapted from a review of an external "claude-video-generator"
tour (Higgsfield-style local tool). Only the free, halal-compatible, cloud-fit
ideas were adopted; see the rejection list at the bottom.

## Camera templates (`src/lib/pipeline/camera-templates.ts`)
8 named templates; storyboard assigns one per scene purpose
(`cameraTemplate` on each storyboard scene). Each template = a Tier B FFmpeg
base motion + a Tier A video-prompt description + an image-prompt suffix.
Templates are honest recipes: a still image cannot truly orbit/fly/splash —
the prompt text asks the AI tier for the look, the FFmpeg tier renders the
closest real 2D move.

- premium-dark: hook → `rush_push` (new `zoom_in_fast`), feature/CTA →
  `orbit_luxury` (pan_right + light sweep), detail → `macro_detail`
  (new `macro_zoom`), use_case → `swoop_reveal` (new `pan_down`)
- standard: classics (`classic_dolly` zoom_in, `classic_pullback`,
  `saga_pan`) + macro for close-ups; `rise_reveal` (new `pan_up`) available
- New FFmpeg motions: `zoom_in_fast`, `macro_zoom`, `pan_up`, `pan_down`
  (real-render smoke-tested)

## Kinetic captions (`cuesToKineticAss` in `src/lib/pipeline/assets.ts`)
Word-by-word highlight ASS: cues split into ≤3-word chunks, one event per
word, current word in accent orange (#ff6b35). Word timings are ESTIMATED —
distributed over each cue's real window proportionally to word length (exact
narration + real scene timings are known; per-word TTS alignment is not).
Wired: `RenderOptions.captionMode`; premium-dark jobs render kinetic,
others standard. Burn-in verified visually against libass.

## Loudness
Render voice normalization is now `loudnorm=I=-14:TP=-1.5:LRA=11`
(previously bare `loudnorm` = -24 LUFS default, too quiet for Reels).
Verified live: quiet source measured -14.03 LUFS after normalization.

## QA additions (`src/lib/pipeline/qa.ts`)
- `loudness-target` (review-level): measures final MP4 via loudnorm
  analysis; pass = -14 ±2 LUFS and true peak ≤ -1.0 dBTP.
- `hook-early` (review-level): first caption cue starts ≤ 1.0s and the
  opening narration line is ≤ 30 words.
Both degrade to "skipped (non-blocking)" when measurement is unavailable —
never invented results.

## Rejected from the source tour (and why)
- **Beat-sync editing to music + synchronized SFX peaks** — music/SFX are
  banned by this system's halal filter (§5). Non-negotiable.
- **60fps minterpolate pass** — deliverable spec is 1080x1920@30; motion is
  generated natively at 30fps; interpolation on a 2-OCPU VM is very slow
  and artifact-prone for marginal gain.
- **Separate render+mux with 50ms offset** — our single-pass mux has no
  drift problem; QA `av-sync` already verifies < 0.5s. A deliberate offset
  would create the error it claims to fix.
- **CapCut draft export** — third-party editor, not automatable in the
  cloud pipeline.
- **The tool itself** — runs locally on a Windows PC (D: drive); this
  system is cloud-only by design.
- **"4K / 8k Hasselblad" claims** — marketing tags; deliverable is
  1080x1920 per spec.
- **FLUX/HF as the image engine** — HF free inference ended 2026-10-21;
  our Pollinations-first chain already supersedes it. Wan2.1/LTX already
  exist here as Tier A / pollinations-video.
- **@sachdeva.ai "clean luxury" templates** — earlier verified analysis:
  sachdeva is a talking-head tips creator, not a product-ad reference.
  @spideyy.in templates were adopted (orbit/rush).
- **Numeric 9.5/10 QA score** — cosmetic; our pass/fail + NEEDS_REVIEW
  gate is stricter. Its useful kernels (loudness target, hook check)
  were adopted above.

---

# Guide #2 adoptions (VenomsTech.AI "Claude Video Editor Guide", 2026-10-23)

A talking-head editing playbook (film yourself → Claude Code edits locally).
Four ideas transferred to this generated-product-ad pipeline:

1. **Measured Instagram safe zone** (guide: text inside x 90–930,
   y 200–1560 on the 1080×1920 canvas). Caption styles in both ASS
   builders now use MarginL 90 / MarginR 150 (right action rail avoided),
   and render caption margins rose: standard MarginV 150→380, premium
   175→400 (text bottom now sits at/above y≈1560, clear of the platform
   caption/CTA overlay zone).
2. **TTS lead-in silence trim** (`trimLeadingSilence` in voice.ts): the
   guide's "hook opens on dead air" mistake applied to us — TTS files
   often start with 0.1–0.5s silence. Each scene file is now trimmed
   (silenceremove, -50 dB, 0.05s kept) BEFORE duration probing, so
   timings and captions start at the first spoken word. Non-fatal on
   ffmpeg errors.
3. **Two-pass loudnorm** (`src/lib/pipeline/loudnorm.ts`): measure →
   apply with measured values + linear=true; single-pass fallback when
   measurement/linear is impossible. Render stage 4 uses it; QA's
   loudness-target check verifies the result.
4. **Numbers as words** in the script prompt: digits are mispronounced
   by TTS, so narration must spell numbers out ("do ghante", never a
   price — compliance rules unchanged).

Already present before this guide: 1–3-word highlight captions, the -14
LUFS target, hook-early QA, separate picture/audio assembly then mux
(our render already works this way — the guide's drift warning does not
apply), verified-facts-only claims.

Rejected / not applicable: SFX-on-every-visual + generated music score
(halal filter); avatar videos and voice cloning (we make product ads,
not talking heads; good clones need paid slots); filming technique
(our footage is generated, not shot); HyperFrames/GSAP engine swap
(FFmpeg+libass covers our graphics; swap risk > benefit); Claude Code
paid-plan setup (this stack is free-first; the guide itself warns it
costs money); hashtags-in-first-comment (we post via direct Graph API,
not a mangling connector — revisit at the Phase 7 live test);
faster-whisper word timing (our kinetic timings are estimated from real
cue windows; local Whisper on a 2-OCPU VM is slow and HF inference is
no longer free).
