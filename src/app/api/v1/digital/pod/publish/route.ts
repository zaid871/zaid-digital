import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError, publishPodDraftFromSlug } from "@/lib/digital/pod";

/**
 * POST /api/v1/digital/pod/publish — human-approval step for the
 * design-check lever.
 *
 * Creates the Printify UNPUBLISHED draft for a design that was generated
 * with skipPrintify:true. Reads the stored manifest — the design is never
 * regenerated. The slug is strictly validated (path-traversal safe).
 */
const bodySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, and hyphens."),
  printify: z
    .object({
      blueprintId: z.number().int().optional(),
      printProviderId: z.number().int().optional(),
      variantIds: z.array(z.number().int()).max(20).optional(),
      priceCents: z.number().int().min(100).max(100000).optional(),
    })
    .optional(),
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
    return failure("validation_error", "Invalid publish payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await publishPodDraftFromSlug(parsed.data.slug, parsed.data.printify);
    return success({
      slug: result.slug,
      productId: result.productId,
      status: result.status,
      note: "Printify product created as UNPUBLISHED draft — review in Printify before publishing.",
    });
  } catch (err) {
    if (err instanceof DigitalError) {
      const status =
        err.code === "validation_error"
          ? 422
          : err.code === "printify_not_configured"
            ? 503
            : 502;
      return failure(err.code, err.message, status);
    }
    return failure("publish_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
