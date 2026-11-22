# Store improvements (from Saddam Kassim's eCommerce video)

Video: "Build an eCommerce Website with an Admin Dashboard | No
Coding" (Saddam Kassim, 43:17, published 2026-11-09, 39K views) —
https://www.youtube.com/watch?v=FyhWuYOKrj4

Note on sources: the video's auto-transcript was blocked by YouTube
(IP block, retried twice) and no summary service had it, so the
analysis rests on the video's own description + the WooCommerce
store anatomy it teaches. Nothing here claims a line the transcript
was not read for.

## What the video teaches

A modern ecommerce website with WordPress + WooCommerce, no coding:
a mobile-friendly storefront, the Drapo plugin (clothes displayed on
hangers along a rope, boutique-style), product images + prices +
categories, shopping cart + checkout pages, and a backend panel to
manage products and orders.

## What transferred (built 2026-11-20)

The user's store is Next.js on the VM, not WordPress — so the
transfer is the store's FEATURES, not the tools.

1. **Search + sort** — the store had categories but no way to find
   a product. New pure module `src/lib/digital/store-filter.ts`
   (`filterStoreProducts`: query matches title/subtitle/description/
   category/type, multi-word AND; sort newest/oldest/title A–Z) and
   a `StoreGrid` client component (`src/app/store/store-grid.tsx`)
   with a search box + sort select, wired into `/store` and
   `/store/<category>`.
2. **Featured newest product** — the store home shows the newest
   product as a wide featured card (the boutique-window idea, in
   digital form: Drapo's rack puts the best pieces first; here the
   newest product gets the big card). Only when no search/sort is
   active; category pages stay plain grids.
3. **Store admin panel** — the video's headline feature. New
   `/store-admin` (nav link added): stats (total / visible /
   hidden) + a product table with Hide/Show per product, via
   `POST /api/v1/digital/store/visibility`. Visibility lives in a
   registry file `storage/digital/hidden.json` (a file, never a
   directory, so the catalog scanner ignores it). Hiding removes a
   product from the public catalog — listing, category pages,
   detail page (404), and the store API — but never deletes files;
   Show restores it. Corrupt registry reads as "nothing hidden";
   unsafe ids are rejected.

## What did NOT transfer

- **WordPress + WooCommerce + hosting + Drapo plugin** — the store
  already exists as Next.js on the VM; rebuilding it in WordPress
  would duplicate it and cost hosting. Drapo is a WooCommerce
  plugin for clothing; digital products have no hangers.
- **Wire MCP Pro** ($39/yr, paid) — already rejected for the
  printables video (2026-11-16); the free tier cannot do
  downloadable products/payments/publish.
- **Cart + checkout** — needs the selling layer, still parked
  (Gumroad vs Lemon Squeezy undecided). The detail page's honest
  "Checkout jald aa raha hai" notice stays; no fake buy button.
- **Prices on cards** — no prices exist yet (selling layer). The
  video sets prices; we never invent them.
- **Orders management** — no orders exist without a selling layer.
  The admin page says so plainly and will gain orders when the
  selling layer lands.
- **Paid course / hosting affiliate links** — not products, not
  transferred.

## Already covered (no build needed)

- Categories + category pages (built 2026-11-14).
- Product images: preview images from the product's own files
  (template PNGs, POD mockups, covers) already feed the cards.
- Mobile-friendly layout: responsive Tailwind grids already in
  place (verified in the store pages).

## Verification (2026-11-20)

- `test-digital-store-filter` 12/12; `test-digital-store-admin`
  13/13; `test-digital-storefront` regression 22/22; tsc 0;
  eslint 0; `npm run build` 0 (`/store-admin` builds as a dynamic
  route).
- The store is still EMPTY (no products generated yet — first batch
  Mon 2026-11-23 08:00 IST), so search/sort/admin were verified on
  fixture manifests in temp dirs, not live products. They go live
  with the products, on the next redeploy.

## Honest limit

A hidden product's direct file URL (`/api/v1/digital/files/...`)
still serves its preview image if someone already has the link —
hiding removes it from the catalog, it is not an access control.
