import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { DigitalError } from "@/lib/digital/ebook";
import { recordReview, getReviews, reviewSummary } from "@/lib/marketing/social-proof";

/**
 * POST /api/v1/marketing/reviews — record a buyer review (honest only).
 * Body: { email, product, rating 1-5, text }. Verified flag only with evidence.
 * GET ?product= — list reviews + summary (for sales pages).
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  try {
    const review = await recordReview(body);
    return success({ ok: true, verified: review.verified });
  } catch (err) {
    if (err instanceof DigitalError) {
      const code = err.code === "validation_error" ? 422 : 502;
      return failure(err.code, err.message, code);
    }
    return failure("review_failed", err instanceof Error ? err.message : String(err), 500);
  }
}

export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  const product = new URL(request.url).searchParams.get("product") ?? "";
  if (product.length < 2) return failure("validation_error", "product query param required.", 400);
  try {
    const [reviews, summary] = await Promise.all([getReviews(product), reviewSummary(product)]);
    return success({ reviews, summary });
  } catch (err) {
    return failure("list_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
