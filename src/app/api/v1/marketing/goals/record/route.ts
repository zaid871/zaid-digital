import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { GoalStore } from "@/lib/marketing/goal-loop";

/**
 * POST /api/v1/marketing/goals/record — record one marketing run.
 *
 * Body: { productKey, channel, metrics: {clicks: 12, ...}, config?: {...},
 *         primaryMetric?: "clicks", northStar?: {views_7d: 10000} }
 * Every metric's MAX becomes the fixed target (goal). Primary metric beat →
 * bestConfig snapshot (the maximum-results strategy to re-apply).
 * northStar sets prescriptive stretch KPIs (blueprint §1) — fixed until beaten.
 */
const bodySchema = z.object({
  productKey: z.string().min(1).max(120),
  channel: z.string().min(1).max(60),
  metrics: z.record(z.string(), z.number().finite()).refine((m) => Object.keys(m).length > 0, {
    message: "metrics must have at least one entry",
  }),
  config: z.record(z.string(), z.unknown()).optional(),
  primaryMetric: z.string().min(1).max(60).optional(),
  northStar: z.record(z.string(), z.number().finite()).optional(),
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
    return failure("validation_error", "Invalid goal record payload.", 422, parsed.error.flatten());
  }
  try {
    const store = await GoalStore.load();
    const goal = store.recordRun(parsed.data);
    await store.save();
    return success({
      productKey: goal.productKey,
      channel: goal.channel,
      primaryMetric: goal.primaryMetric,
      targets: goal.targets,
      northStar: goal.northStar,
      runs: goal.runs,
    });
  } catch (err) {
    return failure("record_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
