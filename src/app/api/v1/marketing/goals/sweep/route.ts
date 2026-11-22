import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { DigitalError } from "@/lib/digital/ebook";
import { GoalStore, sweepGoals } from "@/lib/marketing/goal-loop";

/**
 * POST /api/v1/marketing/goals/sweep — the goal loop's weekly run.
 *
 * 1. Loads all channel goals, checks gaps (latest < 70% of target).
 * 2. For each underperformer, runs LLM root-cause diagnosis (hypotheses
 *    only, never certainty) + re-apply config = best (maximum-results) run.
 * 3. Persists the diagnosis on the goal; next cycle sees if the gap closed.
 *
 * Diagnosis failures degrade to warnings — the sweep never throws.
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const store = await GoalStore.load();
    const report = await sweepGoals(store);
    return success(report);
  } catch (err) {
    if (err instanceof DigitalError) {
      return failure(err.code, err.message, 502);
    }
    return failure("sweep_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
