import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { AccountError, resolveAccount } from "@/lib/publishing/accounts";

/**
 * POST /api/v1/publishing/resolve-account — resolve the IG/FB account
 * for a publish (registry + routing, see src/lib/publishing/accounts.ts).
 *
 * Called by the n8n publishing workflows (after the best-time gate,
 * before the first Graph call) with {productType, niche, accountKey?}.
 * Returns the account's IG user id + tokens + FB page id + token so
 * the workflow publishes to the RIGHT account instead of the single
 * legacy $env pair. Tokens travel only over the n8n-secret-protected
 * backend<->n8n channel (same trust boundary as the env vars) and
 * are never logged.
 */
const bodySchema = z.object({
  accountKey: z.string().min(1).max(100).optional(),
  productType: z.string().min(1).max(100).optional(),
  niche: z.string().min(1).max(100).optional(),
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
    return failure("validation_error", "Invalid resolve-account payload.", 422, parsed.error.flatten());
  }
  try {
    const resolved = resolveAccount(parsed.data);
    return success({
      key: resolved.key,
      label: resolved.label,
      igUserId: resolved.igUserId,
      igAccessToken: resolved.igAccessToken,
      fbPageId: resolved.fbPageId,
      fbPageToken: resolved.fbPageToken,
    });
  } catch (err) {
    if (err instanceof AccountError) {
      return failure(err.code, err.message, err.code === "token_missing" ? 503 : 422);
    }
    return failure("resolve_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
