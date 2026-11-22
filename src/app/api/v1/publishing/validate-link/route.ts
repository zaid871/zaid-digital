import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { checkLink } from "@/lib/publishing/validate-link";

/**
 * POST /api/v1/publishing/validate-link — reachability check for one
 * URL. Body: { url }. Returns { reachable, status, note }. Used by
 * the digital ads-marketing validate step (a dead product link is
 * invalid input) and by the QC check. Never throws.
 */
const bodySchema = z.object({
  url: z.string().min(1).max(2000),
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
    return failure("validation_error", "Invalid validate-link payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await checkLink(parsed.data.url);
    return success(result);
  } catch (err) {
    return failure("validate_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
