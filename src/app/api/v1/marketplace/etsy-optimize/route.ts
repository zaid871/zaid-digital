import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { DigitalError } from "@/lib/digital/ebook";
import { optimizeEtsyListing } from "@/lib/marketplace/etsy-optimizer";

/**
 * POST /api/v1/marketplace/etsy-optimize — Etsy listing optimizer.
 *
 * Body: { title, niche, features?[], description? }
 * Returns: front-loaded title (≤140), 13 long-tail tags (≤20 chars each),
 * conversion description, bundle suggestion. Upload to Etsy stays manual/API.
 */
const bodySchema = z.object({
  title: z.string().min(2).max(200),
  niche: z.string().min(2).max(60),
  features: z.array(z.string().max(120)).max(8).optional(),
  description: z.string().max(1000).optional(),
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
    return failure("validation_error", "Invalid etsy-optimize payload.", 422, parsed.error.flatten());
  }
  try {
    return success(await optimizeEtsyListing(parsed.data));
  } catch (err) {
    if (err instanceof DigitalError) return failure(err.code, err.message, 502);
    return failure("etsy_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
