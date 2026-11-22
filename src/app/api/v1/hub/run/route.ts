import { checkN8nSecret } from "@/lib/api-auth";
import { failure, success } from "@/lib/envelope";
import { hubRequestSchema, runHub } from "@/lib/hub/run";
import { readLedger } from "@/lib/hub/ledger";

/**
 * POST /api/v1/hub/run — the unified API gateway (spec §5).
 *
 * One endpoint for every client (n8n, dashboard, any HTTPS caller):
 * header `x-n8n-secret`, body `{ task, deliver, limits }`. Inside, the
 * hub routes the task, fans out to the live Groq/Gemini legs in
 * parallel, gathers outputs in the Shared Power Pool, synthesizes,
 * verifies (sandbox for code, compliance scan for text/doc) and ledgers
 * the run. Text LLMs are never merged as weights — the APIs merge
 * behind this one gateway while the models stay separate.
 *
 * Response: the v1 envelope with the HubResult as `data`. Runs that
 * executed but failed verification still return 200 with `data.ok`
 * false (the run happened and is ledgered); only auth, validation,
 * quota-exhaustion and compliance-rejection are HTTP errors.
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = hubRequestSchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid hub run payload.", 422, parsed.error.flatten());
  }
  const result = await runHub(parsed.data);
  if (result.error?.code === "quota_exceeded") {
    return failure("quota_exceeded", result.error.message, 429, { ledgerId: result.ledgerId });
  }
  if (result.error?.code === "compliance_rejected") {
    return failure("compliance_rejected", result.error.message, 422, { ledgerId: result.ledgerId });
  }
  return success(result);
}

/** GET /api/v1/hub/run — recent ledger rows for the dashboard (newest first). */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  return success({ entries: readLedger(20) });
}
