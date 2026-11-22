import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { DigitalError } from "@/lib/digital/ebook";
import { buildSeoArticle } from "@/lib/seo/article";

/**
 * POST /api/v1/seo/articles — SEO article generator (Machine channel #3).
 *
 * Body: { topic, keywords[], audience?, productName?, productLink? }
 * Returns buyer-intent article markdown (title/meta/headings/FAQ).
 * Publishing into the website catalogue is separate wiring.
 */
const bodySchema = z.object({
  topic: z.string().min(3).max(120),
  keywords: z.array(z.string().min(2).max(60)).min(1).max(8),
  audience: z.string().min(2).max(200).optional(),
  productName: z.string().min(2).max(120).optional(),
  productLink: z.string().url().optional(),
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
    return failure("validation_error", "Invalid seo-articles payload.", 422, parsed.error.flatten());
  }
  try {
    return success(await buildSeoArticle(parsed.data));
  } catch (err) {
    if (err instanceof DigitalError) {
      const code = err.code === "validation_error" ? 422 : 502;
      return failure(err.code, err.message, code);
    }
    return failure("seo_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
