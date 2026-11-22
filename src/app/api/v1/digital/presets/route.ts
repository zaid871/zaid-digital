import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { generatePresetPack, PRESET_LOOKS } from "@/lib/digital/presets";

/**
 * POST /api/v1/digital/presets — 5 Lightroom looks as .xmp files.
 * Deterministic XML text: no AI call. Real Camera Raw slider values
 * that import into Lightroom / Camera Raw. Photoshop Actions (.atn)
 * are binary and are NOT included.
 */
const bodySchema = z.object({
  presets: z
    .array(z.enum(PRESET_LOOKS.map((p) => p.name) as [string, ...string[]]))
    .optional(),
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
    return failure("validation_error", "Invalid preset pack payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generatePresetPack(parsed.data);
    return success({
      title: result.title,
      slug: result.slug,
      dir: result.dir,
      presets: result.presets,
      files: result.files,
      warnings: result.warnings,
    });
  } catch (err) {
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
