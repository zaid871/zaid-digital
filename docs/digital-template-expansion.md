# Template Expansion (2026-11-08) — premium upgrade

User ne ~25 template categories bheji; jo ban sakta tha wo sab add kiya — aur
sirf add nahi, premium quality ke saath. Jo nahi ban sakta wo ab bhi nahi
banta (neeche "Still NO" dekho — imaandaar report).

## Kya add hua

### 1. Template packs — premium (existing generator, upgraded)
`src/lib/digital/templates.ts` — ab **8 kinds** (quote, tips, promo,
announcement, checklist + **sale, event, testimonial**) × 3 sizes × **5
themes** (dark, light, sand + **forest, wine**) + footer accent rule +
top accent dot. Route enum bhi update hua
(`src/app/api/v1/digital/template-packs/route.ts`).
- Sale = offers, Event = invitations, Testimonial = reviews.
- Test: `test-digital-templates.ts` 21/21 (5 naye checks).

### 2. Docs generation — NEW workflow + premium render
`n8n/workflows/digital-docs-generation.json` (20 nodes, v2 pattern:
demand pre-check + 1 retry).
- `POST /webhook/digital-docs-generation`
  `{"format":"docx"|"pptx"|"epub","title":"...","topic":"...",` +
  `"sections":[...] | "slides":[...] | "chapters":[...]}`.
- Content do → direct render via `POST /api/v1/digital/docs`.
- Content na do → hub `long-doc` pipeline JSON draft karta hai, `parse-draft`
  shape validate karta hai (bad JSON = loud fail, fake doc nahi), phir render.
- Premium render (`scripts/docs_bridge.py`): PPTX accent bar + footer
  ("Title • N"), DOCX styled title (28pt) + italic subtitle + accent rule +
  colored headings, XLSX dark header fill + white bold + banded rows.
- Test: `test-digital-docs.ts` 19/19 (deploy engines python-pptx/EbookLib
  Dockerfile.app mein pehle se hain; sandbox mein install karne pade).

### 3. Spreadsheets generation — NEW workflow
`n8n/workflows/digital-spreadsheets-generation.json` (19 nodes).
- `POST /webhook/digital-spreadsheets-generation`
  `{"title":"...","kind":"budget|expense|inventory|sales|attendance|profit"}`
  ya `{"title":"...","sheets":[...]}`.
- Kind → deterministic bank: headers + example rows + **working formulas**
  (`=SUM(...)`, `=B3-C3`, `=C3*E3`) — openpyxl unhe real formulas likhta hai.
- Premium: dark header fill, banded rows (bridge polish, §2).
- Bank probe verified live (budget sheet, TOTAL row formulas).

### 4. Planners — NEW backend + endpoint + workflow
`src/lib/digital/planner.ts` + `scripts/planner_bridge.py` (fpdf2) +
`POST /api/v1/digital/planners` + `digital-planners-generation.json` (17 nodes).
- `{"type":"daily"|"weekly","title":"...","startDate":"YYYY-MM-DD",` +
  `"count":7,"goals":[...],"habits":[...]}`.
- Daily page: Top-3 priorities (checkbox) + hourly schedule 06:00–22:00 +
  habits + notes. Weekly page: 7-day grid + goals + notes. A4, real PDF.
- Test: `test-digital-planner.ts` 13/13 (pypdf se page count verify).
- Fix note: fpdf2 core fonts Latin-1 only hain — "•" crash karta tha;
  bridge mein `_safe()` sanitizer hai (•/—/… map hote hain).
- Honest limit: **printable only** — hyperlinked/fillable digital planner
  nahi (fpdf2 mein AcroForm nahi).

### 5. Thumbnails — NEW backend + endpoint + workflow
`src/lib/digital/thumbnails.ts` + `POST /api/v1/digital/thumbnails` +
`digital-thumbnails-generation.json` (17 nodes).
- `{"title":"...","subtitle":"...","backgroundPrompt":"...","style":"dark"|"light"}`.
- Pollinations FLUX background + FFmpeg drawtext title (bold, accent bar).
  Title FFmpeg se render hota hai — AI image se nahi — is liye spelling
  hamesha sahi hai.
- Fix note: Pollinations kabhi 1024×576 deta hai; filter chain mein
  `scale=1280:720` pehle lagta hai, output hamesha 1280×720.
- Test: `test-digital-thumbnails.ts` 7/7 (live Pollinations call, ffprobe
  se 1280×720 verify).
- Honest limit: still image only — motion intros/outros/transitions nahi.

## Kya cover hua (categories)
YES: social templates, ebooks/workbooks, printable planners, XLSX trackers,
marketing kits, AI products (prompt libraries + n8n JSON), SOPs/calculators,
SVG icons/bundles, YouTube thumbnails, presentations (basic PPTX), resumes/
office docs (basic DOCX), logos/cards/flyers (basic SVG), invitations
(simple layouts), intro/outro screens (static PNG).
PARTIAL (basic version, premium design nahi): PPTX design, DOCX visual
resumes, brand kits, website themes (koi code generator nahi).
Contracts/forms: DOCX banta hai lekin AI-drafted legal documents bechna
risky hai — bina human legal review ke mat bechna.

## Canva elements (2026-11-08) — jo add ho sakta tha wo add kiya
User ne Canva ke elements panel (Shapes, Graphics, Animations, Photos,
Videos, Audio, Charts, Forms, Sheets, Tables, Frames, Grids, Mockups, 3D)
ki screenshot bheji; jo capability thi wo add ki:
- **Photo backgrounds**: `photoBackground: true` → ek AI image per pack
  (Pollinations FLUX, pack ke size mein), har design ki SVG mein base64
  embedded + dark overlay (text readable) + PNG preview mein rendered.
  `backgroundPrompt` se apni prompt do. Live verify: real photo render,
  preview PNG mein 13,361 distinct colors. Failure → text-only pack +
  warning (pack kabhi fail nahi hota).
- **Frames**: `frame: true` → photo designs par white inset border.
- **Charts**: 9th kind — sample bar chart SVG; `chartData: [{label, value}]`
  se apna data do (max 8 bars).
- **Tables**: 10th kind — label/value rows; `tableData: [{label, value}]`
  se apna data do (max 8 rows).
- **Shapes/motifs**: har kind ka apna accent — testimonial=star,
  checklist=check, sale=tag, event=calendar.
- Route + workflow: `POST /api/v1/digital/template-packs` aur
  `digital-template-generation` webhook dono naye options pass karte hain.
- Test: `test-digital-templates.ts` 33/33 (12 naye checks).
- **Nahi ban sakta**: animations, videos, audio (Shariah rule bhi),
  forms, 3D, grids layout (2×2 layout engine change chahiye — table kind
  se partial cover), mockups (POD flat mockup alag hai), stock photo library.

## Still NO (nahi ban sakta)
Notion templates (koi API nahi), Lightroom presets / Photoshop actions /
LUTs / fonts (binary/proprietary formats), motion graphics / overlays
(.aep/.mogrt), 3D models (GLB/OBJ), Figma/UI kits (koi API nahi),
hyperlinked digital planners, real Canva designs (API se nahi banta).

## Deploy
- Backend redeploy zaroori: naye endpoints `/api/v1/digital/planners` aur
  `/api/v1/digital/thumbnails` + template/docs upgrades deploy par hi milenge.
- n8n: 4 naye JSON import karo (zip mein hain), `N8N_WEBHOOK_SECRET`,
  `BACKEND_URL`, `N8N_BASE_URL` env set karo. `N8N_BLOCK_ENV_ACCESS_IN_NODE`
  kabhi true mat karo.
- Pack: `n8n/digital-workflows-4-pack.zip` — 23 files (19 purane + 4 naye).
- Generator: `scripts/gen-digital-expansion.py` (workflows regenerate karne
  ke liye). Tests: `test-digital-{templates,docs,planner,thumbnails}.ts`.

## Gap build (2026-11-08, is doc ke baad) — "jo ban sakta hai wo sb banado"

User ne template list phir bheji aur kaha jo ban sakta hai wo sab banao, aur
jo free mein arrange ho raha hai wo bhi arrange karke banao. Dusri chat mein
bana hua hissa DOBARA NAHI banaya — sirf gaps banaye:

### 1. Prompt libraries — NEW backend + endpoint + workflow
`src/lib/digital/prompts.ts` + `POST /api/v1/digital/prompt-libraries` +
`digital-prompts-generation.json` (17 nodes, v2 pattern). Topic → AI draft
(free text chain) ya built-in bank (12 topic-parameterised templates) →
prompts.md + prompts.txt + prompts.json + zip. Har prompt ka compliance
scan — violating prompt DROP hota hai, ship nahi hota. Test:
`test-digital-prompts.ts` 12/12. Bank ke 2 items apne hi scan mein phanse
the ("guarantees", "review" trigger words) — wording fix ki, ab bank
clean hai.

### 2. Icon + pattern bundles — NEW backend + endpoint + workflow
`src/lib/digital/icons.ts` + `POST /api/v1/digital/icon-bundles` +
`digital-icons-generation.json` (17 nodes). 16 stroke SVG icons (24x24,
Feather-style geometric set) + 4 seamless pattern tiles (dots, grid,
stripes, chevron) + sprite.svg, 512px PNG previews (ffmpeg librsvg).
Deterministic — no AI. Icon shapes Feather Icons (MIT) par based hain —
bundle mein NOTICE.txt hai. Test: `test-digital-icons.ts` 14/14 (PIL se
har PNG mein ink check — toota hua path blank render karta, pakda jata).

### 3. Logo + business card — template pack extension
`src/lib/digital/templates.ts`: 11th kind "logo" (centered monogram disc +
wordmark + tagline, kisi bhi size par) + 4th size "card" 1050x600
(business card 3.5x2 in, compact layout). Card pack mein chart/table
rotate out hote hain (card chhota hai); buildSvg mein chart height aur
table rows clamp hain (kabhi negative/overflow nahi). Route enum update
hua; template workflow size pass-through karta hai (koi allowlist nahi).
Test: `test-digital-templates.ts` 45/45 (33 se badha).

### 4. Intro/outro screens — thumbnails extension
`src/lib/digital/thumbnails.ts`: `format` field — thumbnail 1280x720
(default), intro/outro 1920x1080 (intro.png/outro.png). Layout scale
hota hai (s=1.5). Route + thumbnails workflow (validate/normalize)
update hue — purane 3 workflows byte-identical regenerate hue, sirf
thumbnails workflow ki 4 lines badli (format). Test:
`test-digital-thumbnails.ts` 15/15 (intro/outro live Pollinations call,
ffprobe se 1920x1080 verify). Motion intros ab bhi NAHI.

### 5. Landing pages — NEW backend + endpoint + workflow
`src/lib/digital/landing.ts` + `POST /api/v1/digital/landing-pages` +
`digital-landing-generation.json` (17 nodes). Ek static index.html
(hero + features + CTA, inline CSS, dark premium). AI draft ya supplied
copy; har line ka compliance scan. Sirf EK page — theme/UI kit nahi.
Test: `test-digital-landing.ts` 13/13.

### 6. LUTs + Lightroom presets — NEW backends + endpoints + workflows
Pehla "NO" GALAT tha: .cube aur .xmp donon PLAIN TEXT hain.
- `src/lib/digital/luts.ts` + `POST /api/v1/digital/luts` +
  `digital-luts-generation.json`: 5 cinematic .cube LUTs (32^3 = 32768
  rows): warm, cool, contrast (S-curve), faded, teal-orange.
- `src/lib/digital/presets.ts` + `POST /api/v1/digital/presets` +
  `digital-presets-generation.json`: 5 Lightroom looks as .xmp (XML,
  python xml.etree se validate): warm-glow, moody-dark, bright-airy,
  faded-film, golden-hour.
Donon mathematical/chosen looks hain — kisi film stock ka measured clone
nahi (manifest mein likha hai). Photoshop Actions (.atn, binary) ab bhi
NAHI. Test: `test-digital-luts-presets.ts` 20/20 (cube parse-back:
row counts + value ranges + look behaviour; 2 test-bugs fix kiye —
lattice mein exact 0.5 point nahi hota, aur parsed numbers ki formatting).

### 7. Free arrange — fonts + 3D models
- **Fonts (OFL, use ke liye — bechne ke liye NAHI):** Poppins Bold +
  Regular Google Fonts repo se download karke `assets/fonts/` mein rakhe
  (OFL.txt saath hai) + locally install + `Dockerfile.app` mein install
  step (fontconfig). Template SVG text aur thumbnail drawtext ab
  "Poppins, DejaVu Sans" use karte hain; drawtext font resolution:
  Poppins → DejaVu (Ubuntu path) → DejaVu (Alpine path) → warning.
  OFL rule: font akela becha nahi ja sakta — sirf apne rendering mein
  use. PDF (fpdf2) mein Poppins embed karna abhi baaki hai (follow-up).
- **3D models (ARRANGE, generate nahi):** `scripts/arrange-free-3d.ts`
  <keyword> [count] — Poly Pizza search API (no key, live-verified)
  se CC0/CC-BY GLB models: previewUrl stem + .glb (verified: glTF
  magic, v2) ya model page se .glb link; har file verify hoti hai.
  Manifest mein creator + licence + source URL; CC-BY ka attribution
  dena lazmi hai. Test: `test-arrange-3d.ts` 6/6.

### Workflows + pack
`scripts/gen-digital-expansion.py` ab 9 workflows banata hai (4 purane +
5 naye); `scripts/validate-workflows.py` (naya) graph + har Code node ka
`node --check` karta hai — 9/9 pass. Pack:
`n8n/digital-workflows-4-pack.zip` — **28 files** (README + 27 workflows;
purana combined `digital-products.json` zip mein NAHI hai, jaise pehle).
README-import.txt mein section 20 add hua; dhyaan dein: zip wali README
(10,553 bytes) on-disk file (6,456 bytes) se nayi nikli — on-disk file ko
zip wali se restore karke phir section 20 joda gaya.

### Verification (is build ki)
10 suites, 171 checks, 0 fail: prompts 12/12, icons 14/14, landing
13/13, luts-presets 20/20, templates 45/45, thumbnails 15/15, docs
19/19, planner 13/13, ebook 14/14, arrange-3d 6/6. tsc clean, eslint
clean (2 unused-import warnings fix kiye), `npm run build` exit 0.
NOT live-import-tested (n8n); backend redeploy needed (5 naye endpoints
+ template/thumbnail upgrades + Dockerfile font step — image rebuild
zaroori hai).

### STILL NO (final, is build ke baad)
Notion templates (koi API nahi), Photoshop Actions (.atn, binary),
motion graphics (.aep/.mogrt), Figma/UI kits, real Canva designs,
hyperlinked digital planners, fonts as a standalone product (OFL),
textures (seamless tiling guarantee nahi — SVG patterns alag se hain).
