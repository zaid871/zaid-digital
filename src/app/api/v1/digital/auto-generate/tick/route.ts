import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { runAutoGenerateTick } from "@/lib/digital/auto-generate";

/**
 * POST /api/v1/digital/auto-generate/tick — run one weekly auto-generate
 * tick (called by the digital-auto-generate workflow, Mon 08:00 IST).
 * Picks the top 3 ungenerated briefs + weekly supporting rotation and
 * fires their generation webhooks. Never fakes: no briefs / no n8n env
 * returns ok:false with the reason.
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const result = await runAutoGenerateTick();
    return success({
      ok: result.ok,
      reason: result.reason ?? null,
      week: result.week,
      seasons: result.seasons,
      briefs: result.briefs,
      triggered: result.triggered,
      failed: result.failed,
      skipped: result.skipped,
      fires: result.fires,
      warnings: result.warnings,
    });
  } catch (err) {
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
