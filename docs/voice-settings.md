# Voice settings — human-sounding AI voiceover

Analyzed 2026-11-12 from 4 YouTube videos (full transcripts read). The
settings below are now live in the shared TTS layer, so they apply to
**both** the affiliate workflow and the digital-products marketing
workflow — both go through the same backend job pipeline
(`synthesizeScenes()` in `src/lib/pipeline/voice.ts`).

## The 4 videos

1. **Badar Munir — "How to Make Your AI Voice Sound 100% Real"**
   (Fish Audio) — https://www.youtube.com/watch?v=qS4EfRE84Q4
2. **Abhishek Side — "Make Your AI Voice Sound 100% REAL For Free"**
   (Cartesia AI + Lexis Audio Editor) — https://www.youtube.com/watch?v=NyrgeECYIpA
3. **Frame of Faizan — "100% Real AI voice - FREE AI VOICE Clone Unlimited"**
   (Cartesia AI + Adobe Podcast) — https://www.youtube.com/watch?v=Iw4Api-sWiA
4. **VideXpert — "How I Created My Ai Voice (EXPOSED)"** (ElevenLabs)
   — https://www.youtube.com/watch?v=l8-KUaKdBjU

## What each video teaches, and what transferred

| Video | Teaches | Transferred to our free stack | Did NOT transfer (why) |
|---|---|---|---|
| 1. Fish Audio | Emotion tags — one mood per sentence, tag at sentence start; Auto Tag; fix order = change model first, then tags, then regenerate; 3 mistakes (bad training audio, too many emotions in one sentence, first result = final) | **One mood per scene** — a voice role per scene purpose (below); fix order = change preset/voice → breaks/emphasis → regenerate | Voice cloning itself (separate service, own account + recordings; cloning already rejected 2026-10-23); HeyGen avatar (rejected); literal `(laughs)` tags — edge-tts would READ them aloud, so they are stripped, never sent |
| 2. Cartesia + Lexis | EQ: treble = brightness/clarity, bass = low end; Amplifier; Normalize (consistent volume) | **Clarity polish** — FFmpeg highpass 80 Hz + gentle +2 dB presence lift at 3 kHz (`applyVoicePolish`, non-fatal); **Normalize = the existing two-pass loudnorm** (-14 LUFS) | Cartesia cloning (separate service, not wired); exact EQ numbers — the video never speaks them, so the lift is my own conservative choice |
| 3. Cartesia + Adobe Podcast | Speed Normal (tweak only a little); small pauses between phrases; Hindi in Devanagari + English in English; Adobe Podcast enhance + reverb fix; remove random gaps; Normalize | **Speed Normal = presets stay near defaults** (small shifts only); **deliberate `<break/>` pauses** at sentence ends; remove random gaps = already have lead-in trim + 15 ms join fades | Cartesia cloning; Adobe Podcast (separate tool — our audio is synthetic-clean, no mic reverb to fix); Devanagari rule — our narration is Roman Hinglish by design, English words stay English; the "Unlimited" title is wrong (monthly limit exists) |
| 4. ElevenLabs | Do NOT read the script — emotion, pauses, fast parts per sentence; Voice Design prompt; V4 model; emotions in brackets; real sounds (cough/laugh/cry); never use an AI script as-is; "keep it in the middle"; generate in parts | **Voice Design prompt → per-role voice briefs** (below); **speakable-script rules** in `script.ts` (one idea per sentence, one mood per scene, speak like Indians speak); **generate in parts = already one file per scene**; "in the middle" = presets deviate only slightly from defaults | ElevenLabs (paid; ElevenLabs-free already rejected); bracket emotions / real sounds (no edge-tts equivalent — would be read aloud); the unnamed "secret website" (cannot use what is not named); the pinned-comment multi-account credit tip (account farming — not recommended) |

## Voice roles — kis jagah kaisi voice

`src/lib/pipeline/voice-presets.ts`. Scene purpose picks the role;
the role picks the prosody. Values are edge-tts `rate` / `pitch` /
`volume` plus an SSML `<break/>` between sentences and `<emphasis/>`
on the role's key sentence.

| Role | Scenes (purpose) | Rate | Pitch | Volume | Break | Emphasis | Brief |
|---|---|---|---|---|---|---|---|
| **hook** | `hook`, `hero` (scene 1) | +8% | +2 Hz | +2% | 400 ms | strong, first sentence | Young Indian creator, energetic and bright — the first line of a Reel |
| **body** | `ingredient`, `craft`, `ritual`, `use_case`, `banner_unroll` | +0% | +0 Hz | +0% | 250 ms | — | Calm and conversational — talking to a friend |
| **proof** | `feature_highlight`, `comparison`, `detail_closeup` | −5% | +0 Hz | +0% | 300 ms | — | Steady and clear — slightly slower so a feature lands |
| **cta** | `call_to_action` (last scene) | −3% | +0 Hz | +2% | 400 ms | moderate, last sentence | Firm and clear — action words stressed |

Unknown purposes fall back by position: first scene = hook, last = cta,
middle = body.

## How it works in the pipeline

- `synthesizeScenes()` computes the role per scene and passes
  `rate`/`pitch`/`volume` to edge-tts (the adapter already supported
  them; they were never passed before).
- **SSML goes only to edge-tts.** The edge-tts package interpolates
  text raw inside `<prosody>`, so `<break/>` and `<emphasis/>` pass
  through. The builder escapes everything first, then inserts only
  its own tags — a stray `<` or `&` in narration cannot break the XML.
- **Fallback providers (hf / pollinations-tts / espeak) get plain
  narration** — they do not understand SSML and would read the tags
  aloud.
- Post-chain per scene file: `trimLeadingSilence` → `applyVoicePolish`
  (highpass + presence lift) → `applyJoinFades` (15 ms). All three are
  non-fatal: on any ffmpeg error the original file is kept.
- The audio-provider label now carries the role
  (`edge-tts:hi-IN-SwaraNeural:hook`), so QA/logs show which voice
  was used where. `creative.ts` splits on `:` and takes `[0]`, so the
  suffix breaks nothing.
- Script prompt (`script.ts`) gained speakable-script rules: write for
  the ear (one idea per sentence), one mood per scene, natural
  connectors, no newsreader phrasing.

## Troubleshooting (video 1's fix order, adapted)

If a scene sounds robotic: (1) change the preset/voice first
(hook ↔ body, or SwaraNeural ↔ MadhurNeural via the voice override);
(2) adjust breaks/emphasis; (3) regenerate. Test 2–3 variations —
small changes make a big difference. Never treat the first render
as final.

## Verification (2026-11-12)

- `scripts/test-voice-settings.ts` — **69/69**: role mapping (all
  purposes + positional fallback), SSML escaping/breaks/emphasis,
  emotion-tag stripping, plain-text fallback (zero SSML), preset
  bounds, real-ffmpeg polish (duration preserved).
- Neighbour suites still green: test-script-style 63/63,
  test-audio-joins 10/10, test-guide-improvements 15/15,
  test-auto-dm 24/24, test-storyboard-chain 22/22.
- `tsc --noEmit` clean, `eslint` clean on changed files.
- **Not live-tested:** no real TTS call was made here (no provider
  keys in the sandbox). First live listen happens at deploy: run one
  job and check the hook (fast + bright) vs the CTA (firm + stressed).

## Deploy notes

- No migration, no new env vars, no n8n change. Presets are code
  defaults; the existing voice override (`VoiceOptions.voice`) still
  works and only changes *which* voice, not *how* it speaks.
- Files: `src/lib/pipeline/voice-presets.ts` (new),
  `src/lib/pipeline/voice.ts` (presets + polish),
  `src/lib/pipeline/script.ts` (speakable rules),
  `scripts/test-voice-settings.ts` (new), this doc.
