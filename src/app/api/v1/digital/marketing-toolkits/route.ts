import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateMarketingToolkit } from "@/lib/digital/marketing-toolkit";

/**
 * POST /api/v1/digital/marketing-toolkits — generate a launch bundle.
 *
 * Sales copy (buyer-psychology edition) + auto-FAQ + caption pack +
 * social templates (promo/announcement/checklist) + launch checklist.
 * All AI copy is compliance-scanned by the underlying generators.
 */
const bodySchema = z.object({
  productName: z.string().min(2).max(200),
  productType: z.enum(["ebook", "template_pack", "pod"]).default("template_pack"),
  productDescription: z.string().max(500).optional(),
  features: z.array(z.string().max(200)).max(8).optional(),
  audience: z.string().max(200).optional(),
  outcomes: z.array(z.string().max(200)).max(6).optional(),
  niche: z.string().max(200).optional(),
  handle: z.string().max(60).optional(),
  theme: z.enum(["dark", "light", "sand", "forest", "wine", "onyx", "ember", "tealrust"]).default("dark"),
  designStyle: z.enum(["standard", "premium"]).default("standard"),
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
    return failure("validation_error", "Invalid marketing-toolkit payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateMarketingToolkit(parsed.data);
    return success({
      productName: result.productName,
      slug: result.slug,
      dir: result.dir,
      files: result.files,
      warnings: result.warnings,
    });
  } catch (err) {
    if (err instanceof DigitalError) {
      return failure(err.code, err.message, 502);
    }
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
