/**
 * POST /api/v1/publishing/sweep — the repost monitor's daily run.
 *
 * 1. Loads published IG Reels from the last 7 days (older than 24h,
 *    originals only — variants never get variants).
 * 2. Reads each one's lifetime insights from the Meta Graph API.
 * 3. Builds the account's own baseline and flags underperformers with
 *    hypothesis-labeled explanations (never causal claims).
 * 4. For eligible underperformers (48h+ old, no variant yet, max 2 per
 *    run), creates a variant PublishRecord and enqueues a build-variant
 *    worker job that generates the new caption.
 *
 * Missing metrics are "no data", never zeros. A thin baseline (< 3
 * posts) flags nothing. Enqueue failures park the variant as pending
 * with a warning instead of failing the sweep.
 */
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { enqueueVariantJob } from "@/lib/queue";
import {
  computeBaseline,
  evaluateCandidate,
  MAX_VARIANTS_PER_SWEEP,
  MONITOR_MAX_AGE_DAYS,
  MONITOR_MIN_AGE_HOURS,
  type RepostMetrics,
} from "@/lib/publishing/repost";

const INSIGHTS_METRICS = "views,reach,likes,comments,shares,saved";

async function fetchInsights(mediaId: string, token: string): Promise<RepostMetrics> {
  const nulls: RepostMetrics = { views: null, reach: null, likes: null, comments: null };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}/insights?metric=${INSIGHTS_METRICS}&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return nulls;
    const body = (await res.json()) as {
      data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
    };
    const get = (name: string): number | null => {
      const entry = body?.data?.find((d) => d?.name === name);
      const v = entry?.values?.[0]?.value;
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    };
    return { views: get("views"), reach: get("reach"), likes: get("likes"), comments: get("comments") };
  } catch {
    return nulls;
  }
}

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    return failure("not_configured", "IG_ACCESS_TOKEN is not configured on the backend — insights cannot be read.", 500);
  }

  const now = new Date();
  const minAge = new Date(now.getTime() - MONITOR_MIN_AGE_HOURS * 3_600_000);
  const maxAge = new Date(now.getTime() - MONITOR_MAX_AGE_DAYS * 86_400_000);

  const candidates = await db.publishRecord.findMany({
    where: {
      platform: "instagram_reels",
      status: "published",
      variantOf: null,
      platformMediaId: { not: null },
      publishedAt: { gte: maxAge, lte: minAge },
    },
    include: { _count: { select: { variants: true } } },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  if (candidates.length === 0) {
    return success({ swept: 0, baseline: null, underperformers: [], variants: [] });
  }

  const withMetrics = [];
  for (const c of candidates) {
    withMetrics.push({ candidate: c, metrics: await fetchInsights(c.platformMediaId as string, token) });
  }

  const baseline = computeBaseline(withMetrics.map((w) => w.metrics));
  const results = withMetrics.map((w) =>
    evaluateCandidate(
      {
        publishRecordId: w.candidate.id,
        platformMediaId: w.candidate.platformMediaId as string,
        publishedAt: (w.candidate.publishedAt as Date).toISOString(),
        variantCount: w.candidate._count.variants,
        isVariant: false,
        metrics: w.metrics,
      },
      baseline,
      now
    )
  );

  const underperformers = results.filter((r) => r.verdict === "underperforming");
  const eligible = results.filter((r) => r.eligible).slice(0, MAX_VARIANTS_PER_SWEEP);

  const variants = [];
  for (const e of eligible) {
    const orig = candidates.find((c) => c.id === e.publishRecordId);
    if (!orig) continue;
    const variant = await db.publishRecord.create({
      data: {
        platform: orig.platform,
        status: "building",
        variantOf: orig.id,
        productId: orig.productId,
        jobId: orig.jobId,
        videoUrl: orig.videoUrl,
      },
    });
    let enqueueWarning: string | null = null;
    try {
      await enqueueVariantJob(variant.id);
    } catch (err) {
      enqueueWarning =
        "Variant saved, but the background queue is unreachable — it stays pending until a worker picks it up.";
      await db.publishRecord.update({
        where: { id: variant.id },
        data: {
          status: "pending",
          errorMessage: `enqueue failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
        },
      });
    }
    variants.push({
      variantId: variant.id,
      publishRecordId: e.publishRecordId,
      status: enqueueWarning ? "pending" : "building",
      hypotheses: e.hypotheses,
      enqueueWarning,
    });
  }

  return success({
    swept: candidates.length,
    baseline,
    underperformers: underperformers.map((u) => ({
      publishRecordId: u.publishRecordId,
      platformMediaId: u.platformMediaId,
      hypotheses: u.hypotheses,
      eligible: u.eligible,
      ineligibilityReasons: u.ineligibilityReasons,
    })),
    variants,
  });
}
