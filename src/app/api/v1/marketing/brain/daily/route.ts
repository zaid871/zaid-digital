import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { buildDailyPlan, fireAffiliateReel } from "@/lib/marketing/brain";
import { collectAnalytics } from "@/lib/publishing/analytics";

/**
 * POST /api/v1/marketing/brain/daily — compute + save today's brain plan
 * and fire today's affiliate reel if one is due (called by the
 * digital-marketing-brain workflow, daily 06:30 IST). Digital picks are
 * NOT fired here — the campaigns tick and ads-daily execute them from
 * the stored plan, so nothing posts twice.
 *
 * Analytics first: the auto-collection step (affiliate technique,
 * now live) fetches fresh IG/FB insights for recent records and
 * records them as goal-loop runs BEFORE the plan is built, so today's
 * picks already see yesterday's real views. Best-effort, never throws.
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const origin = new URL(request.url).origin;
    const analytics = await collectAnalytics({ now: new Date() });
    const plan = await buildDailyPlan({ origin });
    const fired = await fireAffiliateReel(plan, { now: new Date(plan.generatedAt) });
    return success({
      plan,
      affiliateFired: fired.fired,
      affiliateReason: fired.reason,
      fbFired: fired.fbFired,
      fbReason: fired.fbReason,
      analytics,
    });
  } catch (err) {
    return failure("brain_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
