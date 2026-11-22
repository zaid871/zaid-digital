import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { setCampaignStatus } from "@/lib/marketing/campaigns";

/**
 * POST /api/v1/marketing/campaigns/:id — pause or resume a campaign.
 * Body: { action: "pause" | "resume" }. Completed/missed campaigns
 * cannot be resumed (set a new target instead). Dashboard caller.
 */
const bodySchema = z.object({ action: z.enum(["pause", "resume"]) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body: unknown = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return failure("validation_error", "action must be pause | resume", 400);
    const campaign = await setCampaignStatus(id, parsed.data.action === "pause" ? "paused" : "active");
    if (!campaign) return failure("not_found", "Campaign nahi mili, ya wo completed/missed hai.", 404);
    return success(campaign);
  } catch (err) {
    return failure("status_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
