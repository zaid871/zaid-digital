# Typography kit + marketing toolkit + website template (2026-11-13)

User: "Fonts and Typography Kits" + "Digital Marketing Resources and
Toolkits" — dono ko pura add karo; website template pack add karo lekin
abhi DISABLED rakho, baad me workflows achhe chalne par enable karenge.
("Ise" = website template pack — previous turn ke offer ka teesra item.)

## 1. Typography kit — FULL (was: specimen only inside brand kit)
- New generator `src/lib/digital/typography.ts` + `POST /api/v1/digital/typography-kits`:
  one specimen sheet (SVG, 1080x1080) per font pairing + pairing-guide HTML.
- Pairings (fonts already arranged for rendering): Anton + Poppins
  (bold display), Fraunces + Poppins (elegant serif), Poppins + Poppins
  (clean single family). Specimens use the REAL fontconfig family names
  ("CVE anton-400" / "CVE fraunces-700" — "Anton" alone falls back to
  DejaVu; 2026-11-10 Nafay lesson). Each sheet: sample at 96/64/40px,
  alphabet + digits, size scale, best use.
- Guide: pairing table + size scale + do/don't (Anton body text ke liye
  nahi; ek design me max 2 fonts; Fraunces 24px se kam par print nahi).
- LICENCE BOUNDARY: font files NEVER included/sold (OFL — render use
  only). The kit sells specimens + guide.
- Workflow `digital-typography-kit-generation.json` (17 nodes, clone of
  the template workflow). First import needed.

## 2. Marketing toolkit — FULL (was: components exist, no bundle)
- New generator `src/lib/digital/marketing-toolkit.ts` +
  `POST /api/v1/digital/marketing-toolkits`: one launch bundle —
  sales-copy.md (buyer-psychology edition: headline, outcomes, trust
  line, objection answers, risk note) + faq.md + captions.md +
  social-templates/ (promo/announcement/checklist pack, 4 designs —
  pack count clamps to min 4) + launch-checklist.md (best-time slots
  07:30/08:30/19:30/20:30 IST) + manifest (type `marketing_toolkit`) + zip.
- Captions are built DETERMINISTICALLY from the sales copy (headline +
  outcome bullets + CTA, hashtags from niche) — NOT via the pipeline
  caption-pack module: it is worker-side only ("do not import it from a
  Next.js App Route") — it pulls the provider router + edge-tts/remotion
  into the route bundle and breaks `npm run build` (17 Turbopack errors;
  found + fixed in this build, see Verification).
- Workflow `digital-marketing-toolkit-generation.json` (17 nodes).
  First import needed.

## 3. Website template pack — ADDED BUT DISABLED
- New generator `src/lib/digital/website-template.ts` +
  `POST /api/v1/digital/website-templates`: static 3-page site —
  index.html (proven landing-page generator, AI draft + compliance) +
  about.html + contact.html (same visual system, shared nav) + manifest
  (type `website_template`) + zip. Static HTML — any free static host.
- DISABLE switch: `WEBSITE_TEMPLATES_ENABLED` env flag, off by default.
  While off, the route returns 503 "disabled". Enable: set
  `WEBSITE_TEMPLATES_ENABLED=true` in deploy .env (documented in
  .env.example) + import `digital-website-template-generation.json`.
- Workflow `digital-website-template-generation.json` (17 nodes) exists
  but is NOT in the import-now list — see README section 30.

## Verification (2026-11-13, 00:24 IST)
- `test-digital-typography.ts` **23/23** (3 specimens, real fontconfig
  families, guide, manifest fonts note, zip, validation errors).
- `test-digital-marketing-toolkit.ts` **22/22** (stubbed AI: sales copy +
  FAQ; captions from sales copy; 8 social files; checklist slots).
  Two first-run failures, both fixed honestly: (a) stub text "weekly
  review" tripped BANNED_CLAIM_PATTERN (`\breviews?\b` — the scanner
  works as designed) → reworded to "weekly check-in"; (b) pack count
  clamps to min 4 → 8 social files, not 6.
- `test-digital-website-template.ts` **20/20** (3 pages + nav, switch
  off by default / on with env flag, validation errors).
- tsc exit 0; eslint clean; validate-workflows: all 3 new workflows
  PASS (40 PASS total; only pre-existing v1-legacy errors).
- `npm run build` FAILED first (17 Turbopack errors — caption-pack
  imported from the route), fixed by removing that import (captions
  deterministic from sales copy), then **build exit 0**.

## Deploy notes
- Re-import/first import: typography-kit + marketing-toolkit workflows
  (first import). Website-template workflow: DO NOT import yet (disabled).
- Backend redeploy (3 new routes + 3 new libs).
- NOT live-tested: first real typography kit, marketing toolkit, website
  template — all wait for deploy + import (+ website enable flag).

## Still NO (unchanged)
- Font files standalone (OFL — render use only, never sold).
- Notion templates, real Canva designs, hyperlinked planners, DXF export.
