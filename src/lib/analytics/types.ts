/**
 * Analytics types (§16), shaped like the Prisma AnalyticsRecord model.
 *
 * All metric fields are nullable: a metric that was not reported by the
 * platform simply stays null — it is NEVER invented or estimated.
 */

export interface PublishMetrics {
  publishRecordId: string;
  platform: string; // instagram_reels | facebook_reels | website
  productId?: string | null;
  productName?: string | null;
  /** product category, for category performance comparison */
  category?: string | null;
  /** opening hook text, for hook performance analysis */
  hook?: string | null;
  /** content format label, e.g. "premium_dark_15s" */
  format?: string | null;
  views?: number | null;
  reach?: number | null;
  engagement?: number | null;
  likes?: number | null;
  comments?: number | null;
  linkClicks?: number | null;
  conversions?: number | null;
  revenueUsd?: number | null;
  collectedAt: string; // ISO timestamp
}

/** Strength of any claim the analytics module produces. */
export type ClaimStrength = "observed" | "hypothesis";

export interface Insight {
  title: string;
  detail: string;
  /** Every insight is labeled; nothing is ever presented as proven. */
  strength: ClaimStrength;
  /** What data this is based on, e.g. "12 reels, 2026-10-12…2026-10-19". */
  basis: string;
}

export interface CategoryPerformance {
  category: string;
  posts: number;
  totalViews: number;
  totalEngagement: number;
  /** null when no view data exists — never divide by zero. */
  engagementRate: number | null;
  strength: ClaimStrength;
}

export interface ExperimentSuggestion {
  name: string;
  /** Worded as a hypothesis, never as a conclusion. */
  hypothesis: string;
  variantA: string;
  variantB: string;
  metricsToWatch: string[];
  strength: ClaimStrength;
  /** Reminds the reader this is a proposal to test, not a finding. */
  note: string;
}

export interface MetricTotals {
  posts: number;
  recordsWithViews: number;
  totalViews: number;
  totalReach: number;
  totalEngagement: number;
  totalLikes: number;
  totalComments: number;
  totalLinkClicks: number;
  totalConversions: number;
  totalRevenueUsd: number;
}

export interface WeeklyReport {
  weekLabel: string;
  generatedAt: string;
  totals: MetricTotals;
  topHooks: Insight[];
  categoryPerformance: CategoryPerformance[];
  weakPatterns: Insight[];
  experiments: ExperimentSuggestion[];
  /** Always present: observed ≠ proven; views ≠ sales. */
  disclaimer: string;
}
