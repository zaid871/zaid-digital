import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { defaultTextGen, DigitalError } from "@/lib/digital/ebook";
import { generatePromptLibrary } from "@/lib/digital/prompts";

/**
 * POST /api/v1/digital/prompt-libraries — topic in, sellable prompt pack
 * out (prompts.md + prompts.txt + prompts.json + zip).
 *
 * Prompts are drafted by the free text chain when available, otherwise
 * from the built-in topic bank (warning recorded). Every prompt passes
 * the compliance scan; violators are dropped, never shipped.
 */
const bodySchema = z.object({
  topic: z.string().min(3).max(200),
  count: z.number().int().min(4).max(20).default(10),
  category: z.string().max(60).optional(),
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
    return failure("validation_error", "Invalid prompt-library payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generatePromptLibrary(parsed.data, { textGen: defaultTextGen });
    return success({
      title: result.title,
      slug: result.slug,
      dir: result.dir,
      count: result.prompts.length,
      prompts: result.prompts.map((p) => ({ title: p.title, category: p.category })),
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
