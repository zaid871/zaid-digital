import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { loadPlan } from "@/lib/marketing/beat";

/**
 * GET /api/v1/marketing/beat/latest — the latest beat plan (or
 * plan: null + a warning when the sweep has never run).
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const plan = await loadPlan();
    if (!plan) {
      return success({ plan: null, warning: "beat sweep abhi tak nahi chala — pehla run Sunday 09:00 IST hoga (ya POST /beat/collect + /beat/analyze abhi chalao)" });
    }
    return success({ plan });
  } catch (err) {
    return failure("read_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
