import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateTypographyKit } from "@/lib/digital/typography";

/**
 * POST /api/v1/digital/typography-kits — generate a typography kit.
 *
 * One specimen sheet (SVG) per font pairing + pairing-guide HTML.
 * Font files are NEVER included or sold (OFL — render use only).
 */
const bodySchema = z.object({
  kitName: z.string().min(2).max(200),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  theme: z.enum(["dark", "light", "sand", "forest", "wine", "onyx", "ember", "tealrust"]).default("dark"),
  pairings: z.array(z.enum(["anton_poppins", "fraunces_poppins", "poppins_poppins"])).min(1).max(3).optional(),
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
    return failure("validation_error", "Invalid typography-kit payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateTypographyKit(parsed.data);
    return success({
      kitName: result.kitName,
      slug: result.slug,
      dir: result.dir,
      pairings: result.pairings,
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
