# Digital Products Storefront

**Date:** 2026-11-14. **Status:** built, tested, build passes, smoke-tested locally. **NOT deployed** — going live (domain/hosting) is the user's later decision ("baad me dekhinge kya krna hai").

## What it is

A shopping-site-style store for ALL generated digital products, inside the
existing Next.js app (same VM, same deploy — no new hosting):

- `/store` — every category (tile + count) + every product, newest first.
- `/store/<category>` — one category's products (e.g. `/store/ebooks`).
- `/store/<category>/<id>` — one product's page (click a card → its page).
- `GET /api/v1/digital/store` — the catalog as JSON (`?category=<slug>` filters).
- Dashboard nav has a Store link.

## How it reads products

No database. Products live FLAT under the digital root
(`storage/digital/<slug>-<base36ts>/manifest.json` — one folder per product,
no type subfolders), and the manifests ARE the catalog:

- `src/lib/digital/storefront.ts` — `listStoreProducts()` scans the root,
  normalizes each manifest into a card, groups into categories, newest
  first. `getStoreProduct(category, id)` reads one product.
- Manifest `type` (or `kind` for POD, which has no `type`) maps to a
  category: ebook/coloring_book → ebooks, template_pack → templates,
  xlsx → spreadsheets, docx/pptx/epub → documents, pod_design → pod,
  planner → planners, thumbnail/intro/outro → thumbnails, brand_kit,
  typography_kit, marketing_toolkit, landing_page, prompt_library,
  lut_pack/lightroom_preset_pack → presets, icon_bundle, website_template.
  Unknown types → "other". A missing/broken manifest is skipped (counted
  in `skipped`), never a crash.
- Preview images are served by the existing
  `GET /api/v1/digital/files/<id>/<file>` route (images only). No preview
  → a styled placeholder with the title initial.
- Pages are request-time rendered (`instant = false` — Next 16 Cache
  Components model; `dynamic = "force-dynamic"` no longer exists). New
  products appear the moment they are generated.

## What it does NOT do (honest limits)

- **No checkout, no prices.** The selling layer (Gumroad vs Razorpay) is
  still parked/pending. The product page has a "Buy Now" notice that says
  checkout is coming soon — no fake buy button, no invented price. (The
  Shariah/compliance rule also forbids fake prices.)
- **Empty at first.** No digital product has been generated yet, so the
  store shows an honest empty state until the first auto-generate tick
  (Mon 2026-11-16 08:00 IST) or a manual generation. The API already
  returns `{"categories": [], "products": [], "total": 0, "skipped": 1}`
  (the 1 skipped folder is `briefs/`, which has no manifest).
- **Soft 404s, by framework design.** Unknown category/product URLs render
  the 404 UI but with HTTP status 200 — because the page awaits the catalog
  read, streaming starts (200) before `notFound()` runs. Next.js injects
  `<meta name="robots" content="noindex">` in these responses (verified
  live in the smoke test), so search engines will not index them. A true
  404 status would need the slug checked in Proxy before streaming (the
  documented path) — not built; the noindex tag already prevents the SEO
  harm, and the only affected URLs are mistyped ones.

## Storage note (user's concern, 2026-11-14)

The VM has 31 GB free (45 GB total, 14 GB used, checked 2026-11-14). The
store itself costs ~nothing (a few KB of code; it reads the same product
files, never duplicates them). The real disk growth is videos (12–22
GB/month); products are ~0.1–0.9 GB/month at 60/month (~5% of video
growth). Moving the store elsewhere would not fix disk pressure, because
products are still generated on the VM — the fix is the pending retention
rule + Drive archive (videos), not the store's location.

## Free-domain plan (user's later decision)

Free `.com` does not exist (Freenom .tk/.ml ended 2024 — verified live
2026-11-14). Free = subdomain: DuckDNS (`name.duckdns.org`, instant, free
forever) or eu.org (`name.eu.org`, prettier, manual approval takes weeks).
Plan: the free subdomain's A record points at the VM IP (158.180.19.153);
Caddy already binds 80/443 with automatic Let's Encrypt HTTPS
(`DOMAIN` env in the deploy `.env`). Hosting stays on the VM — a free
hosting site (e.g. InfinityFree) would break product-file access. The user
has not picked a name or provider yet.

## Verification (2026-11-14)

- `scripts/test-digital-storefront.ts`: 22/22 (fixture manifests incl.
  ebook, template pack, POD-by-kind, coloring book, unknown type → other,
  broken manifest + missing manifest → skipped, path traversal → null,
  empty root → empty catalog).
- `npx tsc --noEmit`: 0. eslint (new files): 0. `npm run build`: 0, routes
  listed (`/api/v1/digital/store`, `/store`, `/store/[category]`,
  `/store/[category]/[id]`).
- Smoke test (`npm run start` + curl): `/store` 200 (renders "Digital
  Products Store" + empty state), `/api/v1/digital/store` 200 (empty
  catalog JSON), unknown category/product 200 + 404 UI + noindex meta.
- Files: `src/lib/digital/storefront.ts`,
  `src/app/api/v1/digital/store/route.ts`, `src/app/store/page.tsx`,
  `src/app/store/product-card.tsx`, `src/app/store/[category]/page.tsx`,
  `src/app/store/[category]/[id]/page.tsx`, `src/app/layout.tsx` (Store
  nav link), `scripts/test-digital-storefront.ts`.
