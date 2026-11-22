import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { setHidden } from "@/lib/digital/store-admin";

/**
 * POST /api/v1/digital/store/visibility — hide or show a store product.
 *
 * Dashboard-called (no n8n secret, like the other dashboard endpoints).
 * Hiding removes the product from the public catalog; files are never
 * deleted. Body: { id, hidden: true | false }.
 */
const bodySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "Invalid product id."),
  hidden: z.boolean(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid visibility payload.", 422, parsed.error.flatten());
  }
  try {
    const hidden = await setHidden(parsed.data.id, parsed.data.hidden);
    return success({ id: parsed.data.id, hidden: parsed.data.hidden, hiddenCount: hidden.size });
  } catch (err) {
    return failure("visibility_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
