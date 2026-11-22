import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { rankWithSeason } from "@/lib/digital/seasons";

/**
 * POST /api/v1/discovery/season-rank — season-aware ranking for a list
 * of products. Body: { products: [{ title?, url?, category?,
 * description? }] }. Returns the same products ranked by
 * demand + season boost (seasonal +25, never a veto — a non-seasonal
 * product with higher demand still wins). Called by the affiliate
 * product-discovery workflow after dedup, so seasonal products are
 * picked first when real feeds are plugged in.
 */
const productSchema = z
  .object({
    title: z.string().max(300).optional(),
    url: z.string().max(1000).optional(),
    category: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
  })
  .passthrough();

const bodySchema = z.object({
  products: z.array(productSchema).max(200),
});

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid season-rank payload.", 422, parsed.error.flatten());
  }
  try {
    const items = parsed.data.products.map((p) => ({
      product: p,
      // Affiliate discovery has no scoring today — neutral demand 50,
      // so the season boost (+25) decides the order. When discovery
      // gains real scores, they replace the 50 here.
      demandScore: 50,
      text: [p.title, p.category, p.description, p.url].filter(Boolean).join(" "),
    }));
    const ranked = rankWithSeason(items, new Date());
    return success({
      products: ranked.map((r) => ({
        ...r.product,
        _seasonScore: r.seasonScore,
        _seasonId: r.season?.id ?? null,
        _seasonLabel: r.season?.label ?? null,
      })),
    });
  } catch (err) {
    return failure("season_rank_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
