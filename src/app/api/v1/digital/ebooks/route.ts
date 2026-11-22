import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { generateColoringBook } from "@/lib/digital/coloring";
import { DigitalError, generateEbook } from "@/lib/digital/ebook";

/**
 * POST /api/v1/digital/ebooks — generate a complete ebook for a topic.
 *
 * Synchronous by design (the n8n digital-products workflow calls it with
 * a long timeout): outline + chapters over the free provider chain,
 * compliance scan per chapter, HTML + PDF + manifest + zip written under
 * storage/digital/. A chapter that fails compliance after one rewrite
 * fails the whole request honestly — partial ebooks are never shipped.
 *
 * format "coloring_book": theme -> 24-40 line-art coloring pages
 * (Pollinations) + 8.5x11in PDF via scripts/coloring_bridge.py, with
 * KDP disclosure/low-content/weekly-limit notes in the manifest.
 */
const bodySchema = z.object({
  topic: z.string().min(3).max(300),
  title: z.string().min(3).max(200).optional(),
  audience: z.string().max(200).optional(),
  language: z.enum(["hinglish", "english"]).default("hinglish"),
  /** Writing style: "standard" (plain practical teaching), "kadnar" (practical explainer), "saqlain" (documentary narrative). Ebooks only; ignored for coloring books. */
  writingStyle: z.enum(["standard", "kadnar", "saqlain"]).default("standard"),
  chapters: z.number().int().min(3).max(12).default(8),
  wordsPerChapter: z.number().int().min(250).max(900).default(550),
  authorName: z.string().max(120).optional(),
  format: z.enum(["ebook", "coloring_book"]).default("ebook"),
  /** Coloring-book pages (KDP needs >= 24). Ignored for ebooks. */
  pages: z.number().int().min(24).max(40).default(24),
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
    return failure("validation_error", "Invalid ebook payload.", 422, parsed.error.flatten());
  }
  try {
    if (parsed.data.format === "coloring_book") {
      const result = await generateColoringBook({
        theme: parsed.data.topic,
        title: parsed.data.title,
        pages: parsed.data.pages,
        authorName: parsed.data.authorName,
      });
      return success({
        type: "coloring_book",
        title: result.title,
        slug: result.slug,
        dir: result.dir,
        subjects: result.subjects,
        pageCount: result.pageCount,
        pdfPages: result.pdfPages,
        files: result.files,
        warnings: result.warnings,
      });
    }
    const result = await generateEbook(parsed.data);
    return success({
      title: result.title,
      subtitle: result.subtitle,
      slug: result.slug,
      dir: result.dir,
      chapters: result.chapters.map((c) => c.heading),
      wordCount: result.wordCount,
      pdfPages: result.pdfPages,
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
