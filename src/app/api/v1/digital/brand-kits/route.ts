import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateBrandKit } from "@/lib/digital/brandkit";

/**
 * POST /api/v1/digital/brand-kits — generate a complete brand kit.
 *
 * Logo (SVG + PNG) + colour palette + typography specimen + brand
 * guidelines HTML, written under storage/digital/ with manifest + zip.
 */
const bodySchema = z.object({
  brandName: z.string().min(2).max(200),
  tagline: z.string().max(200).optional(),
  niche: z.string().max(200).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
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
    return failure("validation_error", "Invalid brand-kit payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateBrandKit(parsed.data);
    return success({
      brandName: result.brandName,
      slug: result.slug,
      dir: result.dir,
      colors: result.colors,
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
