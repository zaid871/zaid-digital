import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { GoalStore } from "@/lib/marketing/goal-loop";
import { analyzeBeat, analyzeBodySchema } from "@/lib/marketing/beat";

/**
 * POST /api/v1/marketing/beat/analyze — turn collect's benchmarks into
 * the beat plan: gap per target (beating / closing / behind / unknown),
 * the actions that close it (bestseller style angles), and the #1's
 * metric written as the goal-loop north star for that product+channel.
 * The plan is saved to storage/marketing/beat/latest.json.
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const body: unknown = await request.json();
    const parsed = analyzeBodySchema.safeParse(body);
    if (!parsed.success) {
      return failure("validation_error", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    }
    const store = await GoalStore.load();
    const plan = await analyzeBeat(parsed.data.benchmarks, store);
    return success(plan);
  } catch (err) {
    return failure("analyze_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
