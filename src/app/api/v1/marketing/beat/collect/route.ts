import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { GoalStore } from "@/lib/marketing/goal-loop";
import { collectBeat, collectBodySchema, defaultFields } from "@/lib/marketing/beat";

/**
 * POST /api/v1/marketing/beat/collect — one auto-discovery + benchmark
 * pass over every field (ebook / template / pod) and platform (KDP,
 * Etsy, YouTube, Reddit, Instagram, Facebook, X, Pinterest). Body is
 * optional: { fields: [{ field, niches }] } — without it, all three
 * fields over DIGITAL_MINER_NICHES. Never throws on a platform failure:
 * failures come back as warnings (+ last-known values where available).
 * The analyze endpoint turns these benchmarks into the beat plan.
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    let fields = defaultFields();
    try {
      const body: unknown = await request.json();
      if (body && typeof body === "object" && Object.keys(body as Record<string, unknown>).length > 0) {
        const parsed = collectBodySchema.safeParse(body);
        if (!parsed.success) {
          return failure("validation_error", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
        }
        if (parsed.data.fields) fields = parsed.data.fields;
      }
    } catch {
      // empty/unparseable body -> defaults
    }
    const store = await GoalStore.load();
    const result = await collectBeat(fields, { store });
    return success(result);
  } catch (err) {
    return failure("collect_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
