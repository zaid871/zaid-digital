import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { GoalStore } from "@/lib/marketing/goal-loop";

/**
 * GET /api/v1/marketing/goals — list all channel goals with gap status.
 * Target = maximum achieved per metric (the fixed goal).
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const store = await GoalStore.load();
    const gaps = store.checkGaps();
    return success({
      goals: store.all().map((g) => ({
        productKey: g.productKey,
        channel: g.channel,
        primaryMetric: g.primaryMetric,
        targets: g.targets,
        northStar: g.northStar,
        runs: g.runs,
        bestAt: g.bestAt,
        hasDiagnosis: !!g.lastDiagnosis,
        contentQueue: g.contentQueue,
        winnerRuns: g.winnerRuns,
      })),
      gaps,
    });
  } catch (err) {
    return failure("list_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
