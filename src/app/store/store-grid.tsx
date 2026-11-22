"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ProductCard from "./product-card";
import { filterStoreProducts, type StoreSort } from "@/lib/digital/store-filter";
import type { StorefrontProduct } from "@/lib/digital/storefront";

/**
 * Search + sort + product grid for the store pages.
 *
 * When `featured` is set (store home only) and no search/sort is
 * active, the newest product renders as a wide featured card — the
 * store's boutique window, the way the video's Drapo rack puts the
 * best pieces first. Everything else is the plain grid.
 */
export default function StoreGrid({
  products,
  featured = false,
}: {
  products: StorefrontProduct[];
  featured?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<StoreSort>("newest");
  const shown = useMemo(() => filterStoreProducts(products, q, sort), [products, q, sort]);
  const hero = featured && !q.trim() && sort === "newest" ? shown[0] : null;
  const rest = hero ? shown.slice(1) : shown;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none sm:flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as StoreSort)}
            aria-label="Sort products"
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
      </div>

      {hero ? (
        <Link
          href={`/store/${hero.category}/${encodeURIComponent(hero.id)}`}
          className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition hover:border-indigo-500/60"
        >
          {hero.previewImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.previewImage} alt={hero.title} className="h-64 w-full object-cover" loading="lazy" />
          ) : null}
          <div className="flex flex-col gap-2 p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-indigo-300">Newest</span>
            <h3 className="text-xl font-semibold text-zinc-100 group-hover:text-white">{hero.title}</h3>
            {hero.subtitle ? <p className="text-sm text-zinc-400">{hero.subtitle}</p> : null}
            {hero.details.length ? <p className="text-xs text-zinc-500">{hero.details.join(" · ")}</p> : null}
          </div>
        </Link>
      ) : null}

      {rest.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          {q.trim() ? (
            <>
              <p className="font-medium text-zinc-200">No products match “{q.trim()}”.</p>
              <button
                type="button"
                onClick={() => setQ("")}
                className="mt-3 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-indigo-500/60"
              >
                Clear search
              </button>
            </>
          ) : (
            <p>Is category me abhi koi product nahi hai.</p>
          )}
        </div>
      )}
      {shown.length > 0 ? (
        <p className="text-sm text-zinc-500">
          {shown.length} product{shown.length === 1 ? "" : "s"}
          {q.trim() ? ` for “${q.trim()}”` : ""}
        </p>
      ) : null}
    </div>
  );
}
