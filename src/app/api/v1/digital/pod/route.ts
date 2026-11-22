import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError, generatePodDesign } from "@/lib/digital/pod";

/**
 * POST /api/v1/digital/pod — generate a POD t-shirt design pack.
 *
 * Synchronous by design (the n8n digital-pod-generation workflow calls it
 * with a long timeout): style-anchored AI design image -> Lanczos upscale ->
 * optional rembg -> flat mockup -> optional Printify UNPUBLISHED draft ->
 * manifest + zip under storage/digital/. Printify steps are skipped with a
 * typed reason when PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID are unset — the
 * design assets are still produced honestly.
 */
const bodySchema = z.object({
  niche: z.string().min(2).max(200),
  designText: z.string().max(60).optional(),
  style: z.enum(["minimal_typography", "line_art", "bold_graphic"]).default("minimal_typography"),
  shirtColor: z.enum(["black", "white", "navy", "sand", "gray"]).default("black"),
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(1000).optional(),
  /**
   * Design-check lever: when true, assets are generated but NO Printify
   * draft is created. Approve later via POST /api/v1/digital/pod/publish.
   */
  skipPrintify: z.boolean().optional(),
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
    return failure("validation_error", "Invalid POD payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generatePodDesign(parsed.data);
    return success({
      title: result.title,
      slug: result.slug,
      dir: result.dir,
      files: result.files,
      warnings: result.warnings,
      printify: result.printify ?? null,
    });
  } catch (err) {
    if (err instanceof DigitalError) {
      return failure(err.code, err.message, err.code === "compliance_rejected" || err.code === "validation_error" ? 422 : 502);
    }
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
