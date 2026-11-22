/**
 * Store search + sort — pure functions, client-safe (no node imports).
 *
 * A shop without search is a shelf nobody can browse: the video's
 * WooCommerce store has search, sorting, and categories, and the
 * storefront had only categories. The server pages pass the catalog
 * to the <StoreGrid> client component, which filters here.
 */
import type { StorefrontProduct } from "./storefront";

export type StoreSort = "newest" | "oldest" | "title";

/** Case-insensitive match against title / subtitle / description / category / type. */
export function matchesQuery(p: StorefrontProduct, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [p.title, p.subtitle, p.description, p.categoryLabel, p.type]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

function createdAtMs(p: StorefrontProduct): number {
  return p.createdAt ? Date.parse(p.createdAt) : 0;
}

/** Filter by query, then sort. "newest" is the store's default order. */
export function filterStoreProducts(
  products: StorefrontProduct[],
  q: string,
  sort: StoreSort
): StorefrontProduct[] {
  const filtered = products.filter((p) => matchesQuery(p, q));
  const byTitle = (a: StorefrontProduct, b: StorefrontProduct) => a.title.localeCompare(b.title);
  switch (sort) {
    case "oldest":
      return [...filtered].sort((a, b) => createdAtMs(a) - createdAtMs(b) || byTitle(a, b));
    case "title":
      return [...filtered].sort(byTitle);
    case "newest":
    default:
      return [...filtered].sort((a, b) => createdAtMs(b) - createdAtMs(a) || byTitle(a, b));
  }
}
