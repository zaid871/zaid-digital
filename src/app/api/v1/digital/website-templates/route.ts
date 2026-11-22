import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateWebsiteTemplate, isWebsiteTemplateEnabled } from "@/lib/digital/website-template";

/**
 * POST /api/v1/digital/website-templates — generate a static 3-page site.
 *
 * DISABLED BY DEFAULT: returns 503 until WEBSITE_TEMPLATES_ENABLED=true
 * in the deploy .env (enable when the workflows are running well).
 */
const bodySchema = z.object({
  businessName: z.string().min(2).max(200),
  topic: z.string().max(200).optional(),
  tagline: z.string().max(200).optional(),
  features: z.array(z.string().max(200)).max(8).optional(),
  ctaText: z.string().max(120).optional(),
  theme: z.enum(["dark", "light"]).default("dark"),
  useAi: z.boolean().default(true),
});

export async function POST(request: Request) {
  if (!isWebsiteTemplateEnabled()) {
    return failure(
      "disabled",
      "Website template pack abhi disabled hai — enable karne ke liye WEBSITE_TEMPLATES_ENABLED=true karo aur workflow import karo.",
      503
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid website-template payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateWebsiteTemplate(parsed.data);
    return success({
      businessName: result.businessName,
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
