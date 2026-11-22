# New digital products (2026-11-12)

User instruction (2026-11-12 night): wedding video invitations, printable
planners aur SVG cut files ko **template design me add karo**, aur coloring
books/pages ko **ebooks workflow me shamil karo**. Dono kaam hue — teen naye
template kinds + ek naya video script style + coloring-book mode.

## 1. Template kinds (template-packs)

`src/lib/digital/templates.ts` — kinds ab 14 hain (pehle 11):

| Kind | Label | Kya hai |
|---|---|---|
| `wedding_invite` | SHADI | Shaadi invitation card design — do interlocked rings motif, sample text (naam/tareekh/venue buyer bharega) |
| `planner_page` | PLANNER | Printable planner page — table wale time-block rows (Morning/Afternoon/Evening/Night) reuse hote hain |
| `svg_cut` | SVG CUT | Cricut/Silhouette cut-file design — scissors motif; SVG hi cut file hai |

Naya **`kinds` filter** (`TemplatePackRequest.kinds` + route schema): pack ko
kisi ek kind tak seemit karo — rotation sirf un kinds me hoti hai.

```json
// Wedding-only pack (4 designs, sab wedding_invite)
{"niche": "wedding", "count": 4, "kinds": ["wedding_invite"]}

// Planner pack (printable, New Year timing)
{"niche": "2027 planners", "count": 10, "kinds": ["planner_page"], "theme": "sand"}
```

Rules:
- Card size (1050x600) par `chart` / `table` / `planner_page` rotate out
  (rows fit nahi hoti) — `kinds: ["chart"]` + card size ho to pack kabhi
  khaali nahi hota, fallback full non-table rotation hai.
- Motif ke inner coordinates non-negative rakhe gaye hain (house test
  `y="-N"` flag karta hai).
- Manifest me kind-specific delivery notes aati hain (wedding sample text,
  SVG test-before-sell + no DXF, printable not hyperlinked).

**Imaandaar limits:** DXF file pack me **nahi** hai (Cricut/Silhouette SVG
bhi lete hain; DXF conversion v2 — Inkscape chahiye). Hyperlinked
(GoodNotes) planners **nahi** — sirf printable. Wedding invite designs
sample text ke saath hain; couple ke details buyer bharega.

## 2. Wedding video invitations (script style)

`scriptStyle: "wedding_invite"` — hamesha 4 scenes (30–60s), dashboard
dropdown me bhi hai (page.tsx):

1. **NAMES** — couple ke naam hook ke taur par (verified facts se hi).
2. **FUNCTIONS** — Haldi/Mehndi/Sangeet/Baraat (facts me jo listed ho).
3. **DATE & VENUE** — tareekh + venue exactly as given.
4. **CLOSING + RSVP** — warm closing + RSVP invite. dmCta keyword is
   style ke liye **RSVP** hai (default LINK nahi).

Job kaise chalaye (dashboard se): productName = couple ke naam
(e.g. "Aisha & Rohan"), verified features me date/venue/functions daalo
(e.g. "Shaadi: pandrah December", "Venue: Jaipur",
"Functions: Haldi, Mehndi, Sangeet"). Facts se bahar kuch invent nahi hota
— naam, tareekh, venue ya function kabhi guess nahi.

**Rules (Shariah + no-fake-people):** no music (voiceover + captions only);
no faces, no AI avatars of the couple — naam sirf TEXT on screen; dates
words me ("pandrah December"), digits nahi.

**Imaandaar limit:** ye sirf video generation hai — buyer se naam/date lene
ka order form abhi **nahi** hai (selling layer parked hai; made-to-order
flow uske saath aayega). Template-card aur video dono alag products hain.

## 3. Coloring books (ebooks workflow)

Naya module `src/lib/digital/coloring.ts` + bridge
`scripts/coloring_bridge.py` (fpdf2). Ebooks route me `format` field:

```json
// Ebook workflow se (digital-ebook-generation.json passthrough me format + pages hain)
{"topic": "jungle animals", "format": "coloring_book", "pages": 24}
```

Flow: page subjects (ek LLM call, JSON list; bank fallback — 24 default
subjects, 24 se zyada ho to numbered variations, kabhi duplicate nahi) →
har page ek line-art image (Pollinations, bold closed outlines, no shading,
no gray, no text) → colourful cover image (text image me nahi — AI text
misspell karta hai; title PDF me real text hai) → 8.5x11in PDF: cover +
har design apne page par + **blank page peeche** (KDP spec).

Manifest me KDP notes (verified 2026-11-12):
- AI disclosure **REQUIRED** — KDP par publish karte waqt AI content disclose karo.
- Low-content box **DO NOT tick** — coloring books low-content nahi hain.
- Weekly limit: max **2 new titles per format per week** (2026-09-21 se).
- Pages 24–40 (KDP minimum 24). 24 se kam usable pages bane to book
  honestly fail hoti hai — short book ship nahi hoti.

**Imaandaar limits:** page images 1024px renders hain — 8.5x11in par ~120 DPI
effective. Home-print PDF ke liye theek; KDP print se pehle print quality
verify karo. 1024px ko upscale karne se detail nahi badhti (POD wala rule).

## Deploy notes

- **Re-import:** `digital-template-generation.json` (kinds passthrough) +
  `digital-ebook-generation.json` (format + pages passthrough).
- **Backend redeploy** chahiye (naye endpoints/fields + `scripts/coloring_bridge.py`).
- Tests: `test-digital-coloring.ts` **16/16** (real fpdf2 bridge, 49-page
  PDF math: 1 cover + 24 designs + 24 blanks), `test-digital-templates.ts`
  **55/55**, `test-script-style.ts` **74/74**, `test-digital-ebook.ts`
  **14/14** (regression), tsc/eslint/build green, validate-workflows PASS
  (dono edited workflows; sirf purane v1-legacy errors).
- NOT live-tested: pehli asli wedding video, pehla asli coloring book
  (Pollinations images) aur pehla kinds-filter pack — deploy ke baad.
