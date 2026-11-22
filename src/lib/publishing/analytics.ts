/**
 * Analytics auto-collection — the affiliate technique ported to digital.
 *
 * Affiliate side: `affiliate/analytics-collection` fetches IG/FB insights
 * for a media id and returns the metrics — but nothing calls it, so it
 * is dormant. This lib is the LIVE version: it reads the shared publish
 * records (both affiliate and digital reels land in the same table),
 * fetches real insights from the Meta Graph API, and records them as
 * goal-loop runs, so the brain, the goal loop and the weekly report all
 * see real views instead of manual feeds.
 *
 * Honesty rules (same as the repost sweep): missing metrics are null,
 * never zeros; no token -> that platform is skipped with a note, never
 * faked; nothing here throws — failures land in the result's errors.
 */
import { db } from "@/lib/db";
import { GoalStore } from "@/lib/marketing/goal-loop";
import { listCampaignsWithProgress } from "@/lib/marketing/campaigns";

export type FetchFn = typeof fetch;

export interface InsightMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  /** FB only: post_engaged_users. */
  engagedUsers: number | null;
}

const IG_METRICS = "views,reach,likes,comments,shares,saved";
const FB_METRICS = "post_impressions,post_video_views,post_engaged_users";

export function nullMetrics(): InsightMetrics {
  return { views: null, reach: null, likes: null, comments: null, shares: null, saved: null, engagedUsers: null };
}

export interface InsightDeps {
  fetchFn?: FetchFn;
  igToken?: string;
  fbToken?: string;
}

/** Lifetime insights for one media id. Never throws: any failure -> nulls. */
export async function fetchInsights(
  mediaId: string,
  platform: "instagram" | "facebook",
  deps: InsightDeps = {}
): Promise<InsightMetrics> {
  const token =
    platform === "instagram"
      ? (deps.igToken ?? process.env.IG_ACCESS_TOKEN ?? "")
      : (deps.fbToken ?? process.env.FB_PAGE_TOKEN ?? "");
  if (!token) return nullMetrics();
  const metric = platform === "instagram" ? IG_METRICS : FB_METRICS;
  try {
    const res = await (deps.fetchFn ?? fetch)(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return nullMetrics();
    const body = (await res.json()) as {
      data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
    };
    const get = (name: string): number | null => {
      const entry = body?.data?.find((d) => d?.name === name);
      const v = entry?.values?.[0]?.value;
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    };
    if (platform === "instagram") {
      return {
        views: get("views"),
        reach: get("reach"),
        likes: get("likes"),
        comments: get("comments"),
        shares: get("shares"),
        saved: get("saved"),
        engagedUsers: null,
      };
    }
    const views = get("post_video_views") ?? get("post_impressions");
    return {
      views,
      reach: get("post_impressions"),
      likes: null,
      comments: null,
      shares: null,
      saved: null,
      engagedUsers: get("post_engaged_users"),
    };
  } catch {
    return nullMetrics();
  }
}

export interface PublishRecordRow {
  platform: string;
  platformMediaId: string | null;
  jobId: string | null;
  caption: string | null;
  publishedAt: Date | null;
  videoUrl: string | null;
}

export interface RecordWithMetrics extends PublishRecordRow {
  metrics: InsightMetrics;
}

/**
 * Recent published IG/FB records with live insights attached.
 * `records` overrides the DB read (tests inject stubs, no live DB).
 */
export async function recentRecordsWithInsights(
  deps: InsightDeps & {
    now?: Date;
    days?: number;
    maxRecords?: number;
    records?: PublishRecordRow[];
  } = {}
): Promise<RecordWithMetrics[]> {
  const now = deps.now ?? new Date();
  const days = deps.days ?? 7;
  const maxRecords = deps.maxRecords ?? 20;
  let rows: PublishRecordRow[] = deps.records ?? [];
  if (!deps.records) {
    const since = new Date(now.getTime() - days * 86_400_000);
    const dbRows = await db.publishRecord.findMany({
      where: {
        platform: { in: ["instagram_reels", "facebook_reels"] },
        platformMediaId: { not: null },
        publishedAt: { gte: since },
      },
      orderBy: { publishedAt: "desc" },
      take: maxRecords,
      select: {
        platform: true,
        platformMediaId: true,
        jobId: true,
        caption: true,
        publishedAt: true,
        videoUrl: true,
      },
    });
    rows = dbRows.map((r) => ({
      platform: r.platform,
      platformMediaId: r.platformMediaId,
      jobId: r.jobId,
      caption: r.caption,
      publishedAt: r.publishedAt,
      videoUrl: r.videoUrl,
    }));
  }
  const out: RecordWithMetrics[] = [];
  await Promise.all(
    rows.map(async (r) => {
      if (!r.platformMediaId) return;
      const platform = r.platform === "facebook_reels" ? "facebook" : "instagram";
      const metrics = await fetchInsights(r.platformMediaId, platform, deps);
      out.push({ ...r, metrics });
    })
  );
  out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return out;
}

export interface CollectAnalyticsResult {
  collected: number;
  recorded: number;
  skipped: number;
  errors: string[];
}

/**
 * The productKey a publish record belongs to, using the same rule the
 * goal loop and the brain use:
 * - Digital: the caption's first line IS the product name (the ads
 *   workflow builds it as productName + description + "Details: link"),
 *   and it matches a campaign title -> the campaign's own productKey,
 *   so the views enrich the campaign's goal entry.
 * - Affiliate (or anything without a campaign match): the bare jobId.
 *   One affiliate product = one render job = one video, so the jobId
 *   IS the product key, and the brain's calibrate() (which looks goals
 *   up by the prediction id = jobId) works on it directly.
 * - No jobId and no campaign match -> `media:<mediaId>` (per-reel key).
 */
export function productKeyForRecord(
  r: PublishRecordRow,
  campaignByTitle: Map<string, string>
): string | null {
  const firstLine = (r.caption ?? "").split("\n")[0]?.trim() ?? "";
  const campaignKey = firstLine ? campaignByTitle.get(firstLine.toLowerCase()) : undefined;
  return campaignKey ?? (r.jobId ? r.jobId : r.platformMediaId ? `media:${r.platformMediaId}` : null);
}

/**
 * Collect insights for recent records and record them as goal-loop runs.
 * The productKey rule lives in productKeyForRecord (digital records
 * enrich their campaign's goal entry; affiliate records key by jobId).
 *
 * primaryMetric is only set when the goal is NEW ("views"); existing
 * goals keep their primary metric, so the campaigns tick's posts-only
 * runs never register as 0 views. Never throws.
 */
export async function collectAnalytics(
  deps: InsightDeps & {
    store?: GoalStore;
    now?: Date;
    days?: number;
    maxRecords?: number;
    records?: PublishRecordRow[];
    campaigns?: Array<{ title: string; productKey: string }>;
  } = {}
): Promise<CollectAnalyticsResult> {
  const result: CollectAnalyticsResult = { collected: 0, recorded: 0, skipped: 0, errors: [] };
  try {
    const store = deps.store ?? (await GoalStore.load());
    const recs = await recentRecordsWithInsights(deps);
    result.collected = recs.length;
    let campaignByTitle: Map<string, string>;
    if (deps.campaigns) {
      campaignByTitle = new Map(deps.campaigns.map((c) => [c.title.trim().toLowerCase(), c.productKey]));
    } else {
      try {
        const cs = await listCampaignsWithProgress();
        campaignByTitle = new Map(cs.map((c) => [c.title.trim().toLowerCase(), c.productKey]));
      } catch {
        campaignByTitle = new Map();
      }
    }
    for (const r of recs) {
      const productKey = productKeyForRecord(r, campaignByTitle);
      if (!productKey) {
        result.skipped += 1;
        continue;
      }
      const channel = r.platform === "facebook_reels" ? "facebook" : "instagram";
      const metrics: Record<string, number> = { posts: 1 };
      for (const [k, v] of Object.entries(r.metrics)) {
        if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
      }
      try {
        const existing = store.get(productKey, channel);
        store.recordRun({
          productKey,
          channel,
          metrics,
          ...(existing ? {} : { primaryMetric: "views" }),
          config: { mediaId: r.platformMediaId ?? undefined },
        });
        result.recorded += 1;
      } catch (err) {
        result.skipped += 1;
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    await store.save();
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}
