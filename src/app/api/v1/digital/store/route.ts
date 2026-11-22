import { success, failure } from "@/lib/envelope";
import { listStoreProducts } from "@/lib/digital/storefront";

/**
 * GET /api/v1/digital/store — the storefront catalog: every generated
 * digital product, grouped into categories. Public read (the store is
 * meant to be browsed); optional ?category=<slug> filters the list.
 */
export async function GET(request: Request) {
  const category = new URL(request.url).searchParams.get("category") ?? undefined;
  try {
    const catalog = await listStoreProducts();
    const products = category ? catalog.products.filter((p) => p.category === category) : catalog.products;
    if (category && !catalog.categories.some((c) => c.slug === category)) {
      return failure("unknown_category", `Category '${category}' nahi mili.`, 404);
    }
    return success({
      categories: catalog.categories,
      products,
      total: products.length,
      skipped: catalog.skipped,
    });
  } catch (err) {
    return failure("store_unavailable", err instanceof Error ? err.message : "Store catalog nahi padha ja saka.", 500);
  }
}
