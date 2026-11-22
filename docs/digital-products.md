# Digital Products — Ebooks + Template Packs (one workflow)

Built 2026-10-23 on the user's decision: ONE n8n workflow that creates
**two kinds of own digital products** — ebooks and Canva/digital
template packs — on the same free stack as the video platform.

## Pieces

| Piece | Where |
|---|---|
| Ebook generator | `src/lib/digital/ebook.ts` |
| Template-pack generator | `src/lib/digital/templates.ts` |
| Packaging (manifest + zip) | `src/lib/digital/package.ts` |
| PDF engine bridge (fpdf2) | `scripts/pdf_bridge.py` |
| API: ebooks | `POST /api/v1/digital/ebooks` |
| API: template packs | `POST /api/v1/digital/template-packs` |
| n8n workflow (single) | `n8n/workflows/digital-products.json` |
| Tests | `scripts/test-digital-ebook.ts` (14), `scripts/test-digital-templates.ts` (16) |

## How the workflow runs

Webhook `POST /digital-products` (header `x-n8n-secret`, same
timing-safe check as the main workflow) with `type: "ebook"` or
`type: "template_pack"` → IF route → the matching backend endpoint
(ebook timeout 15 min, templates 5 min) → normalized summary response
`{ok, type, title, dir, files, warnings}`. Env: `BACKEND_URL`,
`N8N_WEBHOOK_SECRET` — same as the main workflow.

### Ebook flow
1. Outline: one LLM call → JSON {title, subtitle, chapters[]} (3–12).
2. Chapters: one LLM call each (default 550 words, Roman Hinglish or
   English). Model numbering prefixes are stripped.
3. **Compliance gate per chapter** — price/banned-claim patterns (the
   canonical patterns in `src/lib/compliance.ts`); one rewrite attempt,
   then the whole request fails with `compliance_rejected`. Partial
   ebooks are never shipped.
4. Outputs in `storage/digital/<slug>-<ts>/`: `book.html` (styled),
   `book.pdf` (A5, cover + real TOC page numbers + chapters, via the
   fpdf2 bridge; missing engine → HTML still ships + warning),
   `book.spec.json`, `manifest.json`, and a `.zip` beside the folder.

Text generation is a **direct ordered failover** groq → gemini →
pollinations → hf inside the digital module. It deliberately does NOT
use `providers/fallback.ts`: that graph imports the voice providers
(edge-tts ships raw TS that Turbopack cannot bundle into App Routes),
and `pipeline/script.ts` is worker-side code. Same reason the patterns
moved from `pipeline/script.ts` into leaf module `lib/compliance.ts`
(script.ts re-exports them; qa.ts unaffected).

### Template-pack flow
1. Copy: one LLM call for the whole pack when available, else the
   built-in sample-copy bank (warning recorded). All copy is SAMPLE
   text — templates are sold to be edited.
2. Designs: deterministic layouts (quote / tips / announcement /
   checklist / promo) × sizes 1080×1080, 1080×1350, 1080×1920 × themes
   dark / light / sand (+ optional brand accent colour).
3. Outputs per design: editable `design-XX.svg` source + `design-XX.png`
   ready-to-post preview (ffmpeg librsvg render of the same SVG).
   Plus `pack-preview.html`, `manifest.json` (incl. delivery notes),
   and a `.zip`.

## The Canva truth (read before promising anyone anything)

There is **no API that creates real Canva designs** for arbitrary
accounts — Canva's own editor is where genuine Canva templates are
made, and sellers share them via "template links" created by hand.
So this system automates everything *around* that step:

- It generates complete, sellable template packs (editable SVG sources
  + PNGs). SVGs can be uploaded into Canva and edited there — subject
  to Canva's own plan rules (SVG upload has historically been a Pro
  feature); the pack's delivery notes say exactly this.
- If the user makes designs inside Canva manually, the delivery/listing
  side (packaging, PDFs, workflow) still applies unchanged — only the
  design source differs.

## Office / ebook / spreadsheet documents — DOCX, PPTX, EPUB, XLSX (added 2026-11-06)

The user asked what else can be added beyond ebooks + templates. The
addable set is now built; the impossible set is listed below it, honestly.

| Piece | Where |
|---|---|
| Docs generator (DOCX/PPTX/EPUB/XLSX) | `src/lib/digital/docs.ts` |
| Docs bridge (python-docx / python-pptx / EbookLib / openpyxl) | `scripts/docs_bridge.py` |
| API: documents | `POST /api/v1/digital/docs` (`format: docx \| pptx \| epub`) |
| API: spreadsheets | `POST /api/v1/digital/spreadsheets` |
| Tests | `scripts/test-digital-docs.ts` (19) |

How it works: content is supplied as structured data (sections /
slides / chapters / sheets) — by the caller, the ebook lane, or the
hub. The TS side validates + compliance-scans it (price/banned-claim
patterns; one hit fails the whole request, no partial docs), the
Python bridge renders a real file, and the result ships with
manifest + zip like every other digital product. `generateDocxFromEbook`
/ `generateEpubFromEbook` render already-generated ebook chapters into
DOCX/EPUB without re-generating text — the hub's ebook lane writes
chapters once, the docs lane renders every format from the same source.

Details that matter:
- DOCX: title + sections (headings, paragraphs, bullets).
- PPTX: clean 16:9 title slide + bullet slides (max 40), speaker notes kept.
- EPUB: reflowable book (title, author, chapters) — not fixed-layout.
- XLSX: titled sheets, bold headers, frozen panes, column widths from
  content. Numbers stay numeric (sums keep working); only text cells
  are compliance-scanned — a numeric cell is data, not a claim.
- Missing engine → typed warning + spec/manifest still ship; the file
  is reported as null, never faked. Deploy needs
  `pip install python-docx python-pptx EbookLib openpyxl` (already in
  `docker/Dockerfile.app`, which also copies `docs_bridge.py`).

### What still cannot be added (free stack, honestly)
- Real Canva / Figma `.fig` / PSD-layer / Illustrator files — no API
  creates them natively; SVG + PNG only (see Canva truth above).
- Real 3D model files (GLB/OBJ/FBX) — image models return 2D images.
- Music / songs / SFX — no music model in the free stack, and the
  Shariah filter blocks them anyway.
- Human avatar video, lip-sync, voice cloning — no free model; voice
  cloning was already rejected.
- Font files (TTF/OTF), native apps/games (APK/IPA/EXE), print-ready
  CMYK + bleed files, licensed stock/trademarked assets.
- **Interactive PDF forms** — fpdf2 has no AcroForm support, so this
  was deliberately NOT built (would need a different PDF engine).

### Verified (2026-11-06)
- `test-digital-docs.ts` 19/19: real DOCX/PPTX/EPUB/XLSX files
  generated by the bridge and reopened with python-docx / python-pptx /
  EbookLib / openpyxl to prove contents (title, headings, 3 slides,
  2 chapters, numeric cells 10+20=30); compliance rejection on price
  text; validation error on empty slides. Ebook 14/14 + templates 16/16
  still pass. tsc + eslint clean. `npm run build` green — which also
  required fixing a pre-existing build break (see below).
- Pre-existing build fix (same change, separate cause): `npm run build`
  failed its type-validation step on 9 routes that returned the raw
  string from `checkN8nSecret` (`return authErr;`) — Next 16's
  RouteHandlerConfig rejects `string` returns. Fixed with the pattern
  the other 5 routes already used: `return failure("unauthorized",
  authErr, 401);` in problem-miner, marketing goals (×3), reviews,
  strategist/plan, etsy-optimize, pinterest-volume, seo/articles.
  Side benefit: those routes now return a proper 401 envelope instead
  of a 200 with a bare string. No behaviour change for valid requests;
  the affected suites (problem-miner 14+16, goal-loop 31, strategist 18,
  etsy-youtube 10, pinterest-volume 8, seo-article 10) all still pass.

## Selling/delivery (not built — next step when the user says go)

Generation ≠ selling. Still needed for a full business loop: a store
surface (the catalogue website can list digital products), a payment
route (Gumroad: 10% fee, zero setup; or Razorpay: ~2% + one-time
₹199 KYC), and a payment-webhook → n8n → automatic email delivery flow.
None of that exists yet; do not describe it as built.

## Deploy requirements

- App image updated (`docker/Dockerfile.app`): `python3 + fpdf2`
  (bridge), `ffmpeg`, `zip` installed; `scripts/pdf_bridge.py` and
  `storage/digital/` included. NOT image-build-verified (no Docker in
  the build sandbox) — verify on the VM at deploy.
- Deploy-check: the Alpine ffmpeg build must list the `librsvg`
  decoder (`ffmpeg -decoders | grep librsvg`). Without it, template
  PNG previews are skipped with a warning; SVGs still ship.
- Quota note: one ebook ≈ 1 + N LLM calls; one template pack ≈ 1 call.
  These draw on the same free quotas as the video system — the monthly
  content budget is shared, not doubled.
- The workflow JSON is statically validated (11 nodes, connections,
  embedded JS syntax) but NOT import-tested in live n8n — same status
  as the 16 affiliate workflows; import test belongs to Phase 1.

## Verified samples (2026-10-23)

- Live ebook (real keyless chain): “Ghar Par Asaan Sehatmand Nashta:
  Simple Steps for a Balanced Start” — 4 chapters, 1,289 words,
  10-page PDF, zero warnings. In `~/workspace/digital-samples/`.
- Template pack sample: “Motivational Quotes Pack”, 6 portrait
  designs, SVG + PNG + zip. Same folder.
