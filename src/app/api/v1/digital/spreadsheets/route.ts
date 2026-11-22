import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { DigitalError } from "@/lib/digital/ebook";
import { generateSpreadsheet } from "@/lib/digital/docs";

/**
 * POST /api/v1/digital/spreadsheets — generate a real .xlsx workbook
 * from structured sheets (headers + rows). Numbers stay numeric so sums
 * keep working; only text cells are compliance-scanned (a numeric cell
 * is data, not a promotional claim). Rendered via scripts/docs_bridge.py
 * (openpyxl).
 */
const bodySchema = z.object({
  title: z.string().min(3).max(200),
  sheets: z
    .array(
      z.object({
        name: z.string().min(1).max(31),
        headers: z.array(z.string().max(200)).max(20).default([]),
        rows: z
          .array(z.array(z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).max(20))
          .max(500)
          .default([]),
      })
    )
    .min(1)
    .max(10),
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
    return failure("validation_error", "Invalid spreadsheet payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateSpreadsheet(parsed.data);
    return success({
      kind: result.kind,
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
