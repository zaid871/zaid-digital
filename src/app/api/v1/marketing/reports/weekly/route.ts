import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { buildWeeklyReport } from "@/lib/marketing/reports";

/**
 * GET /api/v1/marketing/reports/weekly — the weekly performance report
 * (real data: publish records + live insights + goal gaps + brain
 * calibration). Called by the affiliate weekly-reporting workflow's
 * gather step and by the digital goal-loop workflow's report step.
 * Read-only, never throws real data away as zeros.
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const report = await buildWeeklyReport();
    return success(report);
  } catch (err) {
    return failure("report_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
