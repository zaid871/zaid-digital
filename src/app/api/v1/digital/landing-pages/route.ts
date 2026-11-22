import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { defaultTextGen, DigitalError } from "@/lib/digital/ebook";
import { generateLandingPage } from "@/lib/digital/landing";

/**
 * POST /api/v1/digital/landing-pages — business name in, one static
 * index.html out (hero + features + CTA, inline CSS, zip).
 *
 * Copy is drafted by the free text chain from the topic when available;
 * caller-supplied tagline/features win when given. Every line passes
 * the compliance scan; violators are dropped, never shipped.
 */
const bodySchema = z.object({
  businessName: z.string().min(2).max(200),
  topic: z.string().max(200).optional(),
  tagline: z.string().max(200).optional(),
  features: z.array(z.string().max(200)).max(8).optional(),
  ctaText: z.string().max(60).optional(),
  theme: z.enum(["dark", "light"]).default("dark"),
  useAi: z.boolean().default(true),
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
    return failure("validation_error", "Invalid landing-page payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateLandingPage(parsed.data, { textGen: defaultTextGen });
    return success({
      title: result.title,
      slug: result.slug,
      dir: result.dir,
      file: result.file,
      files: result.files,
      warnings: result.warnings,
    });
  } catch (err) {
    if (err instanceof DigitalError) {
      return failure(err.code, err.message, err.code === "compliance_rejected" ? 422 : 502);
    }
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
