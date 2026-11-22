# Partial products — completed (2026-11-12 night)

Five products that were "haan, lekin basic/aadha" are now complete.
User: "in he bhi mukammal taur pr add kr do na".

## 1. Resume layouts — designed (was: basic DOCX only)
- New template kind `resume` (17 kinds now): designed one-page resume
  layout — accent side bar, name (W-relative 72px), title, contact line,
  then sections (Experience / Education / Skills) with heading + lines,
  dividers, height-clamped so nothing overflows.
- Input: `resumeData: { name, title, contact, sections: [{ heading, lines }] }`
  on the template-packs route + workflow passthrough; `DEFAULT_RESUME_DATA`
  sample ships when omitted. `kinds: ["resume"]` makes a resume-only pack.
- Card size rotates resume out (too short); square/portrait/story work.
- The basic DOCX resume (docs lane) still exists — this is the visual one.

## 2. Brand kits — full kit (was: logo kind + color + themes only)
- New generator `src/lib/digital/brandkit.ts` + `POST /api/v1/digital/brand-kits`:
  logo (SVG + PNG, brand color as accent) + palette.svg (5 swatches with
  hex codes) + typography.svg (Poppins specimen, 3 sizes + rules) +
  brand-guidelines.html (logo usage, colours table, typography, do/don't,
  file list) + manifest (type `brand_kit`) + zip.
- Input: `brandName`, `brandColor` (#RRGGBB, required), `tagline?`,
  `niche?` (demand-check key), `accentColor?`, `handle?`, `theme?`,
  `designStyle?`. Fonts: Poppins OFL — render use; font files are never
  sold standalone.
- New workflow `digital-brand-kit-generation.json` (17 nodes, cloned from
  the template workflow: demand pre-check on niche/brandName + one retry).
  First import needed.

## 3. Workout logs — ready preset (was: generic sheet only)
- Spreadsheets workflow banks gained `workout` (kinds now 8):
  Workout Log sheet (Date/Exercise/Sets/Reps/Weight kg/Notes, 5 sample
  rows, TOTAL SETS/REPS with `=SUM` formulas) + Summary sheet
  (total sets/reps via cell refs, total volume via `=SUMPRODUCT`).
- Call: `{"title": "My Workout Log", "kind": "workout"}` — no sheets needed.

## 4. Client onboarding flows — full (was: tracker or DOCX guide only)
- Now three lanes, one product story:
  - Template kind `onboarding`: flow-chart design — numbered steps down
    a connecting line (input `steps`, max 6; `DEFAULT_ONBOARDING_STEPS`
    = Inquiry → Discovery call → Proposal → Contract → Kickoff).
  - Spreadsheets bank `onboarding`: Onboarding Tracker sheet
    (Client/Stage/Start Date/Documents/Next Step/Status + TOTAL CLIENTS
    `=COUNTA`) + Checklist sheet (5 steps, Done Yes/No).
  - Docs lane (unchanged): DOCX onboarding guide.
- Card size rotates onboarding out (too short).

## 5. Wall art — print resolution (was: 1080px social-grade PNG)
- New size `poster` (2400×3000 = 8×10in @300dpi) + new kind `wall_art`
  (full-bleed photo or giant centred motif + small caption).
- Poster size forces the wall_art kind (social layouts would render tiny
  at that scale); other sizes render the same art smaller.
- SVG is vector (any size); the PNG preview is now genuinely print-ready.

## Verification (2026-11-12 night)
- `test-digital-templates.ts` **68/68** (+13: resume/onboarding/wall_art
  SVGs, 17-kind cycle, poster pack all-wall_art, poster PNG 2400×3000
  via IHDR header check, resume-only filter, card exclusions).
- `test-digital-brandkit.ts` **21/21** (new: monogram ZK, brand color in
  logo + palette, Poppins specimen, guidelines do/don't, manifest type,
  zip, validation errors).
- `test-spreadsheet-banks.ts` **17/17** (new: workflow JS executed
  against stubs — validate accepts workout/onboarding, rejects unknown;
  banks return the right sheets/formulas; bank sheets → real XLSX,
  reopened with openpyxl, formula strings intact).
- Regressions: docs 19/19 (note: PPTX/EPUB failed first — python-pptx +
  EbookLib were missing in this sandbox session; installed, then green),
  coloring 16/16, script-style 74/74, ebook 14/14.
- tsc exit 0; eslint clean; validate-workflows: all three touched
  workflows PASS (37 PASS total; only pre-existing v1-legacy errors);
  `npm run build` green.

## Deploy notes
- Re-import: `digital-template-generation.json` (resumeData + steps
  passthrough), `digital-spreadsheets-generation.json` (workout +
  onboarding banks). First import: `digital-brand-kit-generation.json`.
- Backend redeploy (new brand-kits route + templates/brandkit libs).
- NOT live-tested: first real resume pack, brand kit, workout/onboarding
  sheets, wall-art poster print — all wait for deploy + re-import.

## Still NO (unchanged)
- Notion templates (koi API nahi), real Canva designs (koi API nahi),
  hyperlinked planners, DXF export for svg_cut, fonts standalone.
