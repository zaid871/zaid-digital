import { success } from "@/lib/envelope";

/** GET /api/v1/usage — retrieve usage and cost records (paginated). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));

  // Phase 3+: aggregates ProviderUsage + CostRecord rows.
  return success({
    records: [],
    totals: { totalCostUsd: 0, byProvider: {} },
    page,
    pageSize,
    total: 0,
    _note: "Phase 2 stub — usage tracking lands in Phase 3.",
  });
}
