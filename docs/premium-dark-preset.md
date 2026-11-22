# Premium Dark preset

Dark cinematic ad look for product videos — the "premium ad" recipe:
near-black backgrounds, one brand accent color, hero product with rim
light, film grain, bold display captions, short 15s format.

## How to use

Dashboard → new job → **Visual style: "Premium Dark (cinematic ad look)"**
→ Duration: 15 (seconds). Or via API:

```json
POST /api/v1/jobs
{ "productUrl": "https://…", "visualStyle": "premium_dark", "durationSeconds": 15 }
```

Accepted spellings: `premium_dark`, `premium-dark`, `premium dark`
(case-insensitive). Any other `visualStyle` string keeps the legacy
generic prompt treatment.

## What changes in the pipeline

| Stage | Standard | Premium Dark |
|---|---|---|
| Image prompts (`storyboard.ts`) | Clean studio, gradient background | Near-black studio, floating hero product, dramatic rim light, single brand accent glow (product's own first color, else vivid cyan-blue), reflections, atmospheric haze |
| Script (`script.ts`) | 4–7 scenes, 15–25 words/scene | 3 scenes, 8–12 words/scene (only when target < 30s) |
| Duration clamp (`creative.ts`) | 30–60s | 15–60s |
| Creative plan | Hook → features → use-case → close-up → CTA | Hook → hero showcase → CTA |
| Render (`render.ts`) | Clean mux | Subtle temporal film grain (`noise=alls=7:allf=t`) |
| Captions (`assets.ts` → ASS) | 48px regular, marginV 150 | 62px **bold**, marginV 175 |

## What it does NOT do

- No kinetic 3D titles or complex motion-graphics transitions (free tier can't).
- No character animation, no music (Shariah constraint — narration only).
- The 15s short format is a different ad genre from the 30–60s voiceover
  format: punchy hook + hero showcase + CTA, not a full explainer.

## Verification (2026-10-15)

`scripts/test-premium-dark.ts` — 20/20 checks pass: preset matching,
dark prompt markers, short-format scene count/duration, ASS bold flag,
and a real ffmpeg render proving the grain filter changes pixels on a
dark clip. `tsc`, `eslint`, and `next build` are green.
