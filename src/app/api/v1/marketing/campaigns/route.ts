import { success, failure } from "@/lib/envelope";
import { createCampaign, listCampaignsWithProgress, campaignBodySchema } from "@/lib/marketing/campaigns";

/**
 * POST /api/v1/marketing/campaigns — start a smart campaign: the
 * system analyzes the product, picks the fit platforms, and markets
 * only at peak times, escalating as a deadline nears. Body: { url,
 * title?, productType?, description?, niche?, target?: { metric,
 * value, deadlineDays } }. GET — all campaigns with live progress
 * and pace. Same trust boundary as POST /api/v1/jobs (dashboard).
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = campaignBodySchema.safeParse(body);
    if (!parsed.success) {
      return failure("validation_error", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    }
    const campaign = await createCampaign(parsed.data);
    return success(campaign);
  } catch (err) {
    return failure("campaign_failed", err instanceof Error ? err.message : String(err), 400);
  }
}

export async function GET() {
  try {
    return success({ campaigns: await listCampaignsWithProgress() });
  } catch (err) {
    return failure("list_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
