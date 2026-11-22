import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { generateIconBundle } from "@/lib/digital/icons";

/**
 * POST /api/v1/digital/icon-bundles — 16 stroke SVG icons + 4 seamless
 * pattern tiles + sprite.svg, with 512px PNG previews. Deterministic
 * (no AI call): the only inputs are theme + accent colour.
 */
const bodySchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  includePatterns: z.boolean().default(true),
});

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid icon-bundle payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateIconBundle(parsed.data);
    return success({
      title: result.title,
      slug: result.slug,
      dir: result.dir,
      icons: result.icons,
      patterns: result.patterns,
      files: result.files,
      warnings: result.warnings,
    });
  } catch (err) {
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
