import { success, failure } from "@/lib/envelope";
import { promote, listPromotions, promoteBodySchema } from "@/lib/marketing/promote";

/**
 * POST /api/v1/marketing/promote — manual promotion. Body: { url,
 * title?, productType? (ebook | template_pack | pod | website),
 * description?, durationSeconds?, publish?, platforms? }. Forwards to
 * the ads-marketing webhook (fire-and-forget); when n8n is unreachable
 * the promotion is queued and the response says so (status "queued").
 * GET — recent manual promotions (newest first).
 *
 * Same trust boundary as POST /api/v1/jobs (called by the dashboard):
 * no x-n8n-secret on this endpoint — the secret is only used when
 * forwarding to n8n.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = promoteBodySchema.safeParse(body);
    if (!parsed.success) {
      return failure("validation_error", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    }
    if (!parsed.data.title) {
      // Title defaults to the URL hostname when the user leaves it blank.
      try {
        parsed.data.title = new URL(parsed.data.url).hostname.replace(/^www\./, "");
      } catch {
        parsed.data.title = parsed.data.url;
      }
    }
    const result = await promote(parsed.data);
    return success(result.promotion, result.forwarded ? 200 : 202);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure("promote_failed", msg, 400);
  }
}

export async function GET() {
  try {
    return success({ promotions: await listPromotions() });
  } catch (err) {
    return failure("list_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
