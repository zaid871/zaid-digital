/**
 * Weekly reporting — the affiliate technique ported to digital, and the
 * fix for the affiliate report's own hollow gather node.
 *
 * Affiliate side: `affiliate/weekly-reporting` runs every Monday 08:00,
 * but its gather node is a stub (returns [] — "no /api/v1/analytics
 * endpoint yet"), so the report it posts has productsPublished: 0 and
 * totalViews: null. This lib builds the REAL report from the shared
 * publish records + live insights + the goal loop + brain calibration,
 * and both the affiliate weekly-reporting workflow (gather node) and
 * the digital goal-loop workflow call the same endpoint for it.
 *
 * Honesty rules: missing metrics are null, never zeros; views are
 * views, never sales; patterns are OBSERVED, never proven; small
 * numbers stay small — no fake growth claims.
 */
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { brainDir, calibrate, type BrainPlan } from "@/lib/marketing/brain";
import { GoalStore, type GapReport } from "@/lib/marketing/goal-loop";
import { listCampaignsWithProgress } from "@/lib/marketing/campaigns";
import {
  productKeyForRecord,
  recentRecordsWithInsights,
  type InsightDeps,
  type PublishRecordRow,
} from "@/lib/publishing/analytics";

export interface WeeklyReportChannelTotals {
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
}

export interface WeeklyReportTopPost {
  platform: string;
  mediaId: string | null;
  productKey: string;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string | null;
}

export interface WeeklyReport {
  week: string;
  generatedAt: string;
  totals: WeeklyReportChannelTotals;
  byChannel: Record<string, WeeklyReportChannelTotals>;
  topPosts: WeeklyReportTopPost[];
  gaps: GapReport[];
  calibration: { days: number; wins: number; accuracy: number | null };
  notes: string[];
}

/** Monday (UTC) of the week containing `d`. */
export function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7; // Mon=1 .. Sun=7
  x.setUTCDate(x.getUTCDate() - (day - 1));
  return x.toISOString().slice(0, 10);
}

function emptyTotals(): WeeklyReportChannelTotals {
  return { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, saved: 0 };
}

export async function buildWeeklyReport(
  deps: InsightDeps & {
    store?: GoalStore;
    now?: Date;
    days?: number;
    plans?: BrainPlan[];
    records?: PublishRecordRow[];
    campaigns?: Array<{ title: string; productKey: string }>;
  } = {}
): Promise<WeeklyReport> {
  const now = deps.now ?? new Date();
  const store = deps.store ?? (await GoalStore.load());
  const recs = await recentRecordsWithInsights(deps);
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

  const totals = emptyTotals();
  const byChannel: Record<string, WeeklyReportChannelTotals> = {};
  let noInsights = 0;
  const scored: WeeklyReportTopPost[] = [];
  for (const r of recs) {
    const channel = r.platform === "facebook_reels" ? "facebook" : "instagram";
    const t = (byChannel[channel] ??= emptyTotals());
    const m = r.metrics;
    const hasAny = m.views != null || m.likes != null || m.comments != null;
    if (!hasAny) noInsights += 1;
    const num = (v: number | null): number => (typeof v === "number" ? v : 0);
    totals.posts += 1;
    t.posts += 1;
    totals.views += num(m.views);
    t.views += num(m.views);
    totals.likes += num(m.likes);
    t.likes += num(m.likes);
    totals.comments += num(m.comments);
    t.comments += num(m.comments);
    totals.shares += num(m.shares);
    t.shares += num(m.shares);
    totals.saved += num(m.saved);
    t.saved += num(m.saved);
    scored.push({
      platform: channel,
      mediaId: r.platformMediaId,
      productKey: productKeyForRecord(r, campaignByTitle) ?? `media:${r.platformMediaId ?? "?"}`,
      views: num(m.views),
      likes: num(m.likes),
      comments: num(m.comments),
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    });
  }
  scored.sort((a, b) => b.views - a.views);
  const topPosts = scored.slice(0, 5);

  const gaps = store.checkGaps();

  let plans = deps.plans;
  if (!plans) {
    plans = [];
    try {
      const dir = brainDir();
      const files = (await readdir(dir))
        .filter((f) => f.startsWith("plan-") && f.endsWith(".json"))
        .sort()
        .slice(-30);
      for (const f of files) {
        try {
          plans.push(JSON.parse(await readFile(join(dir, f), "utf-8")) as BrainPlan);
        } catch {
          continue;
        }
      }
    } catch {
      plans = [];
    }
  }
  const calibration = calibrate(plans, store);

  const notes: string[] = [
    "Views are views, never sales — no revenue claim is made from this report.",
  ];
  if (noInsights > 0) {
    notes.push(
      `${noInsights} of ${recs.length} recent post(s) had no insights (token missing or API error) — treated as no data, not zero.`
    );
  }
  if (calibration.accuracy == null) {
    notes.push("Brain calibration is cold-start: no plan day has real views yet, so no accuracy is claimed.");
  }
  const under = gaps.filter((g) => g.underperforming);
  if (under.length > 0) {
    notes.push(
      `${under.length} goal(s) underperforming vs target: ${under.map((g) => `${g.productKey} (${g.channel})`).join(", ")}.`
    );
  }

  return {
    week: weekStart(now),
    generatedAt: now.toISOString(),
    totals,
    byChannel,
    topPosts,
    gaps,
    calibration,
    notes,
  };
}
