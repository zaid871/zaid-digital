import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateDocx, generateEpub, generatePptx } from "@/lib/digital/docs";

/**
 * POST /api/v1/digital/docs — generate a DOCX, PPTX, or EPUB document
 * from structured content (no LLM call here: the caller, the ebook lane,
 * or the hub supplies the text; this endpoint validates + compliance-
 * scans it + renders a real file via scripts/docs_bridge.py).
 *
 * One endpoint for the three document formats so n8n / the hub calls one
 * route with `format` instead of three near-identical routes.
 */
const sectionSchema = z.object({
  heading: z.string().min(1).max(200),
  paragraphs: z.array(z.string().max(4000)).max(40).default([]),
  bullets: z.array(z.string().max(500)).max(12).default([]),
});

const bodySchema = z.object({
  format: z.enum(["docx", "pptx", "epub"]),
  title: z.string().min(3).max(200),
  subtitle: z.string().max(300).optional(),
  author: z.string().max(120).optional(),
  language: z.string().max(10).optional(),
  sections: z.array(sectionSchema).min(1).max(30).optional(),
  slides: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        bullets: z.array(z.string().max(500)).max(8).default([]),
        notes: z.string().max(1000).optional(),
      })
    )
    .min(1)
    .max(40)
    .optional(),
  chapters: z
    .array(
      z.object({
        heading: z.string().min(1).max(200),
        paragraphs: z.array(z.string().max(4000)).max(40),
      })
    )
    .min(1)
    .max(30)
    .optional(),
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
    return failure("validation_error", "Invalid document payload.", 422, parsed.error.flatten());
  }
  try {
    const data = parsed.data;
    if (data.format === "docx") {
      if (!data.sections) return failure("validation_error", "DOCX needs `sections`.", 422);
      const result = await generateDocx({
        title: data.title,
        subtitle: data.subtitle,
        author: data.author,
        sections: data.sections,
      });
      return success({ kind: result.kind, title: result.title, slug: result.slug, dir: result.dir, file: result.file, count: result.count, files: result.files, warnings: result.warnings });
    }
    if (data.format === "pptx") {
      if (!data.slides) return failure("validation_error", "PPTX needs `slides`.", 422);
      const result = await generatePptx({ title: data.title, subtitle: data.subtitle, slides: data.slides });
      return success({ kind: result.kind, title: result.title, slug: result.slug, dir: result.dir, file: result.file, count: result.count, files: result.files, warnings: result.warnings });
    }
    if (!data.chapters) return failure("validation_error", "EPUB needs `chapters`.", 422);
    const result = await generateEpub({
      title: data.title,
      author: data.author,
      language: data.language,
      chapters: data.chapters,
    });
    return success({ kind: result.kind, title: result.title, slug: result.slug, dir: result.dir, file: result.file, count: result.count, files: result.files, warnings: result.warnings });
  } catch (err) {
    if (err instanceof DigitalError) {
      return failure(err.code, err.message, err.code === "compliance_rejected" ? 422 : 502);
    }
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
