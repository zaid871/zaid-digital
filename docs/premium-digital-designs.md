# Premium Digital Designs (BlankBuilder system)

**Source:** [@blankbuilder.app](https://www.instagram.com/blankbuilder.app) (BlankBuilder · 3D Apparel, verified, 10K followers) — analyzed 2026-11-12 (logged-out profile + direct reel pages; grid clicks hit the login wall, no sign-in used).

## What the account is (nuance)

NOT a POD shop. It is a browser-based 3D apparel-design tool showing
production-ready tee/hoodie/shirt designs aimed at clothing brands and POD
sellers. Every reel is titled "…Pattern to 3D."; captions stress prints placed
"on the real sewing pattern at its real size", studio photos and print files,
DTF printing, halftone/vectorising, spec-sheet/export. Commenters ask the POD
questions directly ("is this useful in print on demand?", "Does it connect to
Etsy?"). No prices or buy links for the garments themselves.

## The 12 recent designs (7–11 Nov 2026)

Medallion tee (6.1K likes, top post — giant silver ornamental medallion
wrapping the side seam, black oversized tee), tribal dance tee (teal geometric
ornament + rust dancers, white tee), camo drip tee ("Back to nature"), chill
panda tee (orange, graffiti "STAY COOL"), teddy bear tee (graffiti bear,
"Hope"), leopard shirt, racing "Sir Lewis" tee, game-over pixel tee, abstract
face tee, rose ringer tee, dalmatian hoodie, v1.6 update reel.

## The repeatable premium system (what transferred)

1. **Seam-aware, wrap-around placement** — the print is not a centred chest
   graphic; it crosses the side seam, runs front-to-back, continues onto
   sleeves and collar.
2. **Full-garment coordination** — the same motif scaled and repeated (small
   chest, large back, sleeve/hem) with matching trims: one system, not one
   graphic.
3. **Construction details** — ringer collars, coloured/gradient rib trims,
   sleeve bands, printed inside-neck size/care labels.
4. **Photoreal studio scenes** — real fabric drape, a hanger, dark backdrops
   with leaf/fern or window-blind shadows.
5. **Restrained palette per design** — one garment base (black/white/orange)
   plus one or two accents (silver; teal + rust; orange camo; pink→blue).
6. **Production credibility** — "real sewing pattern at its real size",
   "see the real print dot for dot", spec sheets, print-ready files.

Grid covers: pale mint/sage, two-line bold sans title (black design name +
dark green "Pattern to 3D.") above a rounded-rect studio photo.

## What was built

### Premium design style for template packs (`src/lib/digital/templates.ts`)

- `designStyle: "standard" | "premium"` on `TemplatePackRequest` (default
  standard — existing packs unchanged) and on `BuildSvgOpts`.
- **Three new themes** (one base + one/two restrained accents):
  `onyx` (black #0B0B0D + silver #C9CDD3 / #7A7F88), `ember` (orange #E85A24
  + black), `tealrust` (warm white + teal #0F766E + rust #B4551F).
  `TemplateTheme` gained optional `accent2` (defaults to `accent`).
- **Premium rendering** (in `buildSvg`, both logo and social layouts):
  - trim bands — thick accent band on the top edge + thin second-accent band
    on the bottom edge (ringer collar / sleeve band);
  - studio shadow backdrop — diagonal "window-blind" stripes at 0.05 opacity
    + soft radial vignette;
  - motif echo — the kind motif at three scales: giant faded centre
    (scale 6, opacity 0.07, the "back print"), medium top-right (the
    "chest"), small top-left (the "sleeve"). `motifSvg` now covers ALL kinds
    (quote/tips/promo/announcement/chart/table/logo added) with a scale +
    opacity parameter; inner coordinates are non-negative (house test rule);
  - oversized display headline — 108px (portrait) vs 78px standard, tighter
    wrap (12 chars/line);
  - two-line label — kind label + niche subtitle line under it (the
    "Pattern to 3D." second line).
- `generateTemplatePack` passes `designStyle` + `subtitle: niche` through;
  the manifest records `designStyle`.

### POD prompt upgrade (`src/lib/digital/pod.ts`)

- `buildPrompt` is now exported and carries the premium placement language:
  "all-over print, motif echoed at two scales (large back print, small chest
  print), one garment base plus one accent colour, print-ready vector".
  "centered composition" is dropped — that is exactly what the premium
  designs don't do. Honest limit: the placement on the actual garment
  (seam wrap, sleeves) is Printify-side; the artwork itself carries the
  echo + restrained palette.

### Wiring

- `POST /api/v1/digital/template-packs` schema: `theme` enum gained
  onyx/ember/tealrust; `designStyle` added (default standard).
- `n8n/workflows/digital-template-generation.json` validate-input passthrough
  gained `designStyle` (re-import needed). Call with
  `{"niche": "...", "designStyle": "premium", "theme": "onyx"}`.

## Verification

- `scripts/test-premium-designs.ts` **30/30** — themes, standard-vs-premium
  SVG markers, POD prompt language, end-to-end pack (bank copy, no network),
  real FFmpeg render + pixel probes (top band silver #C9CDD3, bottom band
  dark silver #7A7F88, standard top pixel plain dark bg), workflow
  passthrough. One premium PNG was also visually checked (oversized headline,
  bands, blind shadows, giant faded quote echo).
- `test-digital-templates.ts` **45/45**, `test-digital-pod-gate.ts` 14/14,
  `test-pod-print-size.ts` 5/5. tsc/eslint/build green. validate-workflows
  PASS `digital-template-generation.json` (36 pre-existing legacy errors
  unchanged).

## NOT transferred (honest limits)

- No 3D garment mockups — our digital designs are flat SVG/PNG; the
  wrap-around/seam placement is a garment concept that transfers as
  motif-echo + trim bands, not literal 3D.
- No photoreal fabric/hanger studio scenes — the photo-background lane
  (Pollinations) still supplies imagery; the shadow backdrop is a subtle
  SVG approximation.
- No halftone/vectorise/upscale tool — our vector output is already SVG;
  DTF/spec-sheet language stays in captions, not in the files.
- BlankBuilder's own tool is not cloned; only its design language was
  transferred, as with the earlier creator references.
