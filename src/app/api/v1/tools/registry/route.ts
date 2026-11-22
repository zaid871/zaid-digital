/**
 * GET /api/v1/tools/registry — read-only registry view for the dashboard
 * and n8n (design §8, phase 1).
 *
 * Header `x-n8n-secret`. Returns every tool (public fields only —
 * registry entries hold env-var NAMES, never secret values), remaining
 * quota per tool, status counts, and load warnings. A stale entry
 * (lastVerified > 30 days) is flagged, never silently trusted.
 */
import { checkN8nSecret } from "@/lib/api-auth";
import { failure, success } from "@/lib/envelope";
import { loadRegistry, registrySummary, toPublicTool } from "@/lib/tools/registry";
import { checkToolQuota } from "@/lib/tools/quota";

export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  const { tools, warnings } = loadRegistry();
  const view = tools.map((tool) => {
    const quota = checkToolQuota(
      tool.id,
      {
        perDay: tool.quota.perDay,
        perWeek: tool.quota.perWeek,
        perMonth: tool.quota.perMonth,
      },
      tool.quota.unit
    );
    return {
      ...toPublicTool(tool),
      remaining: quota.remaining < 0 ? null : quota.remaining,
      quotaUnit: tool.quota.unit,
    };
  });
  return success({ tools: view, summary: registrySummary(tools), warnings });
}
