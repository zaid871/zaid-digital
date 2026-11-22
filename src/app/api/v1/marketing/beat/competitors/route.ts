import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { loadTargets, saveTargets, competitorsBodySchema } from "@/lib/marketing/beat";

/**
 * GET /api/v1/marketing/beat/competitors — list the registry (#1 targets
 * the user set once; auto-discovery fills the rest at collect time).
 * POST — replace the registry (array of targets). Registry wins over
 * auto-discovery for IG/FB/X/Pinterest handles, Reddit subreddit and
 * KDP ASIN. YT/Etsy are always auto (the #1 IS whoever tops the search).
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    return success({ targets: await loadTargets() });
  } catch (err) {
    return failure("list_failed", err instanceof Error ? err.message : String(err), 500);
  }
}

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  try {
    const body: unknown = await request.json();
    const parsed = competitorsBodySchema.safeParse(body);
    if (!parsed.success) {
      return failure("validation_error", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
    }
    const targets = parsed.data.targets.map((t) => ({ ...t, source: "registry" as const }));
    await saveTargets(targets);
    return success({ targets, saved: targets.length });
  } catch (err) {
    return failure("save_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
