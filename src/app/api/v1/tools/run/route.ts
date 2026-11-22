/**
 * POST /api/v1/tools/run — dispatch a job to a tool by capability
 * (design §8, phase 2). Header `x-n8n-secret`, body
 * `{ capability, jobId, input?, timeoutMs? }`.
 *
 * A dispatch that executed but paused returns 200 with `data.ok`
 * false (it happened and is ledgered); only auth, validation and
 * quota-exhaustion are HTTP errors — same convention as POST
 * /api/v1/hub/run.
 */
import { checkN8nSecret } from "@/lib/api-auth";
import { failure, success } from "@/lib/envelope";
import { DispatchInputSchema, dispatchTool } from "@/lib/tools/dispatch";

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = DispatchInputSchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid tool dispatch payload.", 422, parsed.error.flatten());
  }
  const outcome = await dispatchTool(parsed.data);
  if (outcome.pauseReason === "quota_exceeded") {
    return failure("quota_exceeded", outcome.error?.message ?? "Tool quota exceeded.", 429, {
      ledgerId: outcome.ledgerId,
    });
  }
  return success(outcome);
}
