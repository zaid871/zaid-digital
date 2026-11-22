import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { brainDir, calibrate, readLatestPlan, type BrainPlan } from "@/lib/marketing/brain";
import { GoalStore } from "@/lib/marketing/goal-loop";

/**
 * GET /api/v1/marketing/brain/latest — today's stored plan + measured
 * prediction accuracy (calibration) + weekly coverage. Read by the
 * campaigns tick and ads-daily; no side effects.
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const plan = await readLatestPlan();
    let plans: BrainPlan[] = [];
    try {
      const dir = brainDir();
      const files = (await readdir(dir)).filter((f) => f.startsWith("plan-") && f.endsWith(".json")).sort().slice(-30);
      for (const f of files) {
        try {
          plans.push(JSON.parse(await readFile(join(dir, f), "utf-8")) as BrainPlan);
        } catch {
          continue;
        }
      }
    } catch {
      plans = [];
    }
    const store = await GoalStore.load();
    const calibration = calibrate(plans, store);
    return success({ plan, calibration, coverage: plan?.coverage ?? null });
  } catch (err) {
    return failure("brain_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
