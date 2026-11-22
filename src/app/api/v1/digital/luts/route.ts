import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { generateLutPack, LUT_PRESETS, type LutPresetName } from "@/lib/digital/luts";

/**
 * POST /api/v1/digital/luts — 5 cinematic .cube LUTs (32^3 lattice).
 * Deterministic text files: no AI call. A .cube is plain text, so
 * these are real importable LUTs — the looks are mathematical
 * transforms, honestly labelled in the manifest.
 */
const bodySchema = z.object({
  presets: z
    .array(z.enum(LUT_PRESETS.map((p) => p.name) as [LutPresetName, ...LutPresetName[]]))
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
    return failure("validation_error", "Invalid LUT pack payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateLutPack(parsed.data);
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
