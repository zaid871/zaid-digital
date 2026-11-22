import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { tickAllCampaigns } from "@/lib/marketing/campaigns";
import { readLatestPlan } from "@/lib/marketing/brain";

/**
 * POST /api/v1/marketing/campaigns/tick — one decision cycle for
 * every active campaign (called by the n8n campaign workflow at each
 * publish slot, 07:30/08:30/19:30/20:30 IST). Each campaign decides
 * post / wait / done / missed and acts; failures are per-campaign.
 * The brain's latest plan (if any) orders the campaigns and can turn
 * a post into a carousel instead of a video ad.
 * x-n8n-secret required (n8n caller).
 */
export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const plan = (await readLatestPlan()) ?? undefined;
    const results = await tickAllCampaigns({ plan });
    return success({ ticked: results.length, results });
  } catch (err) {
    return failure("tick_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
