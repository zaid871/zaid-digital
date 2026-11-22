import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { runQcCheck } from "@/lib/publishing/qc";

/**
 * POST /api/v1/publishing/qc-check — publish-time QC gate for a
 * finished video job. Body: { jobId, caption?, productLink? }.
 * Returns { verdict: pass | review | fail, checks: [...] }.
 * Called by the digital ads-marketing workflow after the job
 * completes, before any IG/FB trigger. Never throws.
 */
const bodySchema = z.object({
  jobId: z.string().min(1).max(128),
  caption: z.string().max(5000).optional(),
  productLink: z.string().url().optional(),
});

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid qc-check payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await runQcCheck({
      jobId: parsed.data.jobId,
      caption: parsed.data.caption,
      productLink: parsed.data.productLink,
    });
    return success(result);
  } catch (err) {
    return failure("qc_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
