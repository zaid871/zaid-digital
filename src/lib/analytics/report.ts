/**
 * Weekly performance report (§16) + experiment suggestions (§17).
 *
 * Hard rules enforced here:
 * - Every insight is labeled strength: "observed" or "hypothesis".
 * - Wording is correlational ("tended to", "associated with") — never causal
 *   ("proves", "guarantees", "will increase").
 * - Views are never equated with sales (explicit in the disclaimer).
 * - Engagement rate is null when there are no views — never divide by zero.
 */
import type {
  CategoryPerformance,
  ExperimentSuggestion,
  Insight,
  MetricTotals,
  PublishMetrics,
  WeeklyReport,
} from "./types";

export const REPORT_DISCLAIMER =
  "All insights below are OBSERVED patterns in the collected data, not proven causal results. " +
  "Treat them as hypotheses to test, not as guarantees. Views are a reach metric — " +
  "views are not sales, and engagement is not revenue.";

function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>(
    (acc, v) => acc + (typeof v === "number" ? v : 0),
    0
  );
}

/** Engagement rate, or null when there is no view data. Never divides by zero. */
export function engagementRate(metric: PublishMetrics): number | null {
  if (typeof metric.views !== "number" || metric.views <= 0) return null;
  if (typeof metric.engagement !== "number") return null;
  return metric.engagement / metric.views;
}

function totals(metrics: PublishMetrics[]): MetricTotals {
  return {
    posts: metrics.length,
    recordsWithViews: metrics.filter((m) => typeof m.views === "number").length,
    totalViews: sum(metrics.map((m) => m.views)),
    totalReach: sum(metrics.map((m) => m.reach)),
    totalEngagement: sum(metrics.map((m) => m.engagement)),
    totalLikes: sum(metrics.map((m) => m.likes)),
    totalComments: sum(metrics.map((m) => m.comments)),
    totalLinkClicks: sum(metrics.map((m) => m.linkClicks)),
    totalConversions: sum(metrics.map((m) => m.conversions)),
    totalRevenueUsd: sum(metrics.map((m) => m.revenueUsd)),
  };
}

function basisFor(metrics: PublishMetrics[], weekLabel: string): string {
  return `${metrics.length} published post(s), week ${weekLabel}`;
}

function topHookInsights(metrics: PublishMetrics[], weekLabel: string, topN: number): Insight[] {
  const withHook = metrics.filter(
    (m) => m.hook && m.hook.trim().length > 0 && engagementRate(m) !== null
  );
  const ranked = withHook
    .map((m) => ({ metric: m, rate: engagementRate(m) as number }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, topN);
  return ranked.map(({ metric, rate }, i) => ({
    title: `Top hook #${i + 1} (observed engagement rate ${(rate * 100).toFixed(1)}%)`,
    detail:
      `The hook "${metric.hook}" was associated with the ${i === 0 ? "highest" : "next-highest"} ` +
      `engagement rate among hooks with view data this week. This is an observed association, ` +
      `not proof the hook caused the engagement.`,
    strength: "observed" as const,
    basis: basisFor(metrics, weekLabel),
  }));
}

function categoryInsights(metrics: PublishMetrics[]): CategoryPerformance[] {
  const groups = new Map<string, PublishMetrics[]>();
  for (const m of metrics) {
    const cat = (m.category ?? "").trim() || "Uncategorized";
    const list = groups.get(cat) ?? [];
    list.push(m);
    groups.set(cat, list);
  }
  return [...groups.entries()]
    .map(([category, items]) => {
      const views = sum(items.map((m) => m.views));
      const engagement = sum(items.map((m) => m.engagement));
      return {
        category,
        posts: items.length,
        totalViews: views,
        totalEngagement: engagement,
        engagementRate: views > 0 ? engagement / views : null,
        strength: "observed" as const,
      };
    })
    .sort((a, b) => b.totalViews - a.totalViews);
}

function weakPatternInsights(metrics: PublishMetrics[], weekLabel: string): Insight[] {
  const insights: Insight[] = [];
  const zeroEngagement = metrics.filter(
    (m) => typeof m.views === "number" && m.views > 0 && (m.engagement ?? 0) === 0
  );
  if (zeroEngagement.length > 0) {
    insights.push({
      title: `${zeroEngagement.length} post(s) with views but zero recorded engagement`,
      detail:
        `These posts were seen but recorded no engagement. This pattern was observed in the data; ` +
        `it does not prove what caused it. Candidates to investigate: hook clarity, caption CTA, ` +
        `posting time, or incomplete metric collection.`,
      strength: "observed",
      basis: basisFor(metrics, weekLabel),
    });
  }
  const noData = metrics.filter((m) => typeof m.views !== "number");
  if (noData.length > 0) {
    insights.push({
      title: `${noData.length} post(s) with no view data collected`,
      detail:
        `No metrics were returned for these posts. Missing data is a collection gap, not a ` +
        `performance signal — do not treat these as failures.`,
      strength: "observed",
      basis: basisFor(metrics, weekLabel),
    });
  }
  return insights;
}

function suggestExperiments(report: WeeklyReport): ExperimentSuggestion[] {
  const suggestions: ExperimentSuggestion[] = [];
  if (report.topHooks.length > 0 && report.weakPatterns.length > 0) {
    suggestions.push({
      name: "Hook style A/B",
      hypothesis:
        "Hooks phrased like the top observed hook may be associated with higher engagement than the current default hook style.",
      variantA: "Current default hook style",
      variantB: `Hook style modeled on: "${report.topHooks[0].title}"`,
      metricsToWatch: ["engagementRate", "views", "linkClicks"],
      strength: "hypothesis",
      note: "Proposal to test with a small controlled batch — not a finding.",
    });
  }
  if (report.categoryPerformance.length >= 2) {
    const [best, ...rest] = report.categoryPerformance;
    const weakest = rest[rest.length - 1];
    if (best && weakest && best.category !== weakest.category) {
      suggestions.push({
        name: "Category focus test",
        hypothesis: `Posting more in "${best.category}" (highest observed views this week) may be associated with more reach than the current category mix.`,
        variantA: "Current category mix",
        variantB: `Shift 2 of next week's slots to "${best.category}"`,
        metricsToWatch: ["views", "engagementRate", "linkClicks"],
        strength: "hypothesis",
        note: "Proposal to test as a one-week controlled change; factual and religious constraints still apply unchanged.",
      });
    }
  }
  return suggestions;
}

export interface ReportOptions {
  topHooks?: number;
}

/** Build the weekly report from collected (real) metrics only. */
export function buildWeeklyReport(
  metrics: PublishMetrics[],
  weekLabel: string,
  options: ReportOptions = {}
): WeeklyReport {
  const topN = options.topHooks ?? 3;
  const report: WeeklyReport = {
    weekLabel,
    generatedAt: new Date().toISOString(),
    totals: totals(metrics),
    topHooks: topHookInsights(metrics, weekLabel, topN),
    categoryPerformance: categoryInsights(metrics),
    weakPatterns: weakPatternInsights(metrics, weekLabel),
    experiments: [],
    disclaimer: REPORT_DISCLAIMER,
  };
  report.experiments = suggestExperiments(report);
  return report;
}
