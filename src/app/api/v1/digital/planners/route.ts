import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generatePlanner } from "@/lib/digital/planner";

/**
 * POST /api/v1/digital/planners — generate a printable A4 planner PDF
 * (daily pages or weekly grid pages) from a title + date range.
 * Printable only: no hyperlinks / fillable fields (fpdf2 has no
 * AcroForm support) — the manifest says so honestly.
 */
const bodySchema = z.object({
  type: z.enum(["daily", "weekly"]).default("daily"),
  title: z.string().min(3).max(200),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
    .optional(),
  count: z.number().int().min(1).max(31).optional(),
  goals: z.array(z.string().max(100)).max(3).optional(),
  habits: z.array(z.string().max(60)).max(5).optional(),
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
    return failure("validation_error", "Invalid planner payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generatePlanner(parsed.data);
    return success({
      kind: result.kind,
      type: result.type,
      title: result.title,
      slug: result.slug,
      dir: result.dir,
      file: result.file,
      count: result.count,
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
