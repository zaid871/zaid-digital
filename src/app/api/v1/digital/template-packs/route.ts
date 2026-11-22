import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { defaultTextGen, DigitalError } from "@/lib/digital/ebook";
import { generateTemplatePack } from "@/lib/digital/templates";

/**
 * POST /api/v1/digital/template-packs — generate a sellable design pack.
 *
 * Deterministic SVG layouts rendered to PNG previews via ffmpeg
 * (librsvg). Copy comes from the free provider chain when available and
 * falls back to the built-in sample-copy bank (warning recorded).
 */
const bodySchema = z.object({
  niche: z.string().min(2).max(200),
  count: z.number().int().min(4).max(20).default(10),
  size: z.enum(["square", "portrait", "story", "card", "poster"]).default("portrait"),
  theme: z.enum(["dark", "light", "sand", "forest", "wine", "onyx", "ember", "tealrust"]).default("dark"),
  designStyle: z.enum(["standard", "premium"]).default("standard"),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  packName: z.string().min(3).max(200).optional(),
  handle: z.string().max(60).optional(),
  useAiCopy: z.boolean().default(true),
  photoBackground: z.boolean().default(false),
  backgroundPrompt: z.string().max(500).optional(),
  frame: z.boolean().default(false),
  chartData: z
    .array(z.object({ label: z.string().max(40), value: z.number().min(0).max(1000) }))
    .max(8)
    .optional(),
  tableData: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(120) }))
    .max(8)
    .optional(),
  kinds: z
    .array(
      z.enum([
        "quote",
        "tips",
        "promo",
        "announcement",
        "checklist",
        "sale",
        "event",
        "testimonial",
        "chart",
        "table",
        "logo",
        "wedding_invite",
        "planner_page",
        "svg_cut",
        "resume",
        "onboarding",
        "wall_art",
      ])
    )
    .min(1)
    .max(17)
    .optional(),
  resumeData: z
    .object({
      name: z.string().max(80).optional(),
      title: z.string().max(120).optional(),
      contact: z.string().max(120).optional(),
      sections: z
        .array(
          z.object({
            heading: z.string().max(40),
            lines: z.array(z.string().max(200)).max(4),
          })
        )
        .max(4)
        .optional(),
    })
    .optional(),
  steps: z.array(z.string().max(120)).max(6).optional(),
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
    return failure("validation_error", "Invalid template-pack payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateTemplatePack(parsed.data, { textGen: defaultTextGen });
    return success({
      packName: result.packName,
      slug: result.slug,
      dir: result.dir,
      size: result.size,
      designs: result.designs.map((d) => ({
        id: d.id,
        kind: d.kind,
        headline: d.headline,
        svgFile: d.svgFile,
        pngFile: d.pngFile,
      })),
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
