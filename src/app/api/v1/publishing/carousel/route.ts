import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { CarouselError, createCarousel } from "@/lib/publishing/carousel";
import { AccountError, resolveAccount } from "@/lib/publishing/accounts";

/**
 * POST /api/v1/publishing/carousel — publish an IG carousel (2-10 public
 * image URLs + caption). Called by the digital IG publishing workflow's
 * carousel branch. The account is resolved from {accountKey, productType,
 * niche} via the accounts registry (legacy default env when no registry).
 * Never fakes: any Graph API step failing returns the step + the API's
 * own error.
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
  const d = body as {
    imageUrls?: unknown;
    caption?: unknown;
    accountKey?: unknown;
    productType?: unknown;
    niche?: unknown;
  };
  if (!Array.isArray(d.imageUrls) || d.imageUrls.length < 2 || d.imageUrls.length > 10) {
    return failure("validation_error", "imageUrls: 2-10 public image URLs chahiye.", 422);
  }
  if (typeof d.caption !== "string" || d.caption.length < 1) {
    return failure("validation_error", "caption (min 1 char) zaroori hai.", 422);
  }
  const accountKey = typeof d.accountKey === "string" ? d.accountKey : undefined;
  const productType = typeof d.productType === "string" ? d.productType : undefined;
  const niche = typeof d.niche === "string" ? d.niche : undefined;
  try {
    const resolved = resolveAccount({ accountKey, productType, niche });
    const result = await createCarousel(d.imageUrls as string[], d.caption, {
      igUserId: resolved.igUserId,
      accessToken: resolved.igAccessToken,
    });
    return success({ mediaId: result.mediaId, platform: "instagram_carousel", images: d.imageUrls.length, account: resolved.key });
  } catch (err) {
    if (err instanceof AccountError) {
      return failure(err.code, err.message, err.code === "token_missing" ? 503 : 422);
    }
    if (err instanceof CarouselError) return failure("carousel_failed", err.message, 502);
    return failure("carousel_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
