import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { activeSeasons, loadSeasons, SEASON_BOOST, SEASON_PACE_PENALTY } from "@/lib/digital/seasons";

/**
 * GET /api/v1/digital/seasons/current — which seasons are active right
 * now, and which one starts next. Read-only; used by the dashboard /
 * n8n to show what the season mode is boosting.
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  const seasons = await loadSeasons();
  const now = new Date();
  const active = activeSeasons(now, seasons);
  const activeIds = new Set(active.map((s) => s.id));
  let next: { id: string; label: string; startsOn: string } | null = null;
  for (let d = 1; d <= 365; d++) {
    const day = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const starting = activeSeasons(day, seasons).find((s) => !activeIds.has(s.id));
    if (starting) {
      next = { id: starting.id, label: starting.label, startsOn: day.toISOString().slice(0, 10) };
      break;
    }
  }
  return success({
    at: now.toISOString(),
    active: active.map((s) => ({ id: s.id, label: s.label })),
    next,
    boost: SEASON_BOOST,
    pacePenalty: SEASON_PACE_PENALTY,
  });
}
