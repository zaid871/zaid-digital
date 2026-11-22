import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateThumbnail } from "@/lib/digital/thumbnails";

/**
 * POST /api/v1/digital/thumbnails — generate a 1280x720 YouTube
 * thumbnail PNG, or a 1920x1080 intro/outro screen (format field):
 * Pollinations FLUX background + FFmpeg drawtext title overlay
 * (legible by construction — the image model never renders the title,
 * so no garbled text). Still image only: motion intros / outros are
 * NOT built here.
 */
const bodySchema = z.object({
  title: z.string().min(3).max(120),
  subtitle: z.string().max(200).optional(),
  backgroundPrompt: z.string().max(500).optional(),
  style: z.enum(["dark", "light"]).default("dark"),
  format: z.enum(["thumbnail", "intro", "outro"]).default("thumbnail"),
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
    return failure("validation_error", "Invalid thumbnail payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateThumbnail(parsed.data);
    return success({
      kind: result.kind,
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
