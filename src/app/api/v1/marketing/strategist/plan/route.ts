import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { DigitalError } from "@/lib/digital/ebook";
import { buildPlan, briefSchema } from "@/lib/marketing/strategist";

/**
 * POST /api/v1/marketing/strategist/plan — Universal Marketing Strategist.
 *
 * Body (UniversalBrief): { productName, client?, kind, priceBand, audience,
 *   marketBreadth, goal, assets?, features?[] }
 * Returns: channelQueue (priority), 5 stages (validate→retain), LLM angles +
 * hooks (compliance-scanned), reasoning, warnings.
 *
 * Agency use: client field namespaces the productKey ("client:product") so
 * one workflow serves many clients; each client's goals tracked separately
 * in the goal-loop ledger.
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
  const parsed = briefSchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid strategist brief.", 422, parsed.error.flatten());
  }
  try {
    const plan = await buildPlan(parsed.data);
    return success(plan);
  } catch (err) {
    if (err instanceof DigitalError) return failure(err.code, err.message, 502);
    return failure("plan_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
