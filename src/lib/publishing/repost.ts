/**
 * Repost ("second chance") loop — pure analysis.
 *
 * When a published Reel clearly underperforms the account's own recent
 * baseline, this module flags it and produces hypothesis-labeled
 * explanations. Pure functions only: no provider imports, so App Routes
 * may import this safely.
 *
 * Honesty rules (match the analytics module's doctrine):
 * - Baselines come only from the account's own recent posts, never from
 *   outside benchmarks or remembered figures.
 * - Every explanation is labeled kind: "hypothesis" — data never proves
 *   a cause. Wording stays correlational.
 * - Missing metrics are "insufficient_data", never zeros.
 * - A baseline of fewer than MIN_BASELINE_SAMPLE posts is too thin to
 *   judge against — those candidates are skipped, not flagged.
 */

export interface RepostMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
}

export interface RepostCandidateInput {
  publishRecordId: string;
  platformMediaId: string;
  publishedAt: string; // ISO
  variantCount: number; // variants already made from this record
  isVariant: boolean; // variants never get variants
  metrics: RepostMetrics;
}

export interface PerformanceBaseline {
  medianViews: number | null;
  medianReach: number | null;
  medianEngagementRate: number | null;
  sampleSize: number;
}

export type PerformanceVerdict = "ok" | "underperforming" | "insufficient_data";

export interface Hypothesis {
  kind: "hypothesis";
  text: string;
  observed: string;
}

export interface CandidateResult {
  publishRecordId: string;
  platformMediaId: string;
  verdict: PerformanceVerdict;
  baseline: PerformanceBaseline;
  hypotheses: Hypothesis[];
  eligible: boolean;
  ineligibilityReasons: string[];
}

/** A post becomes repost-eligible only after this long. */
export const REPOST_MIN_AGE_HOURS = 48;
/** Monitor window: posts published between 24h and 7d ago. */
export const MONITOR_MIN_AGE_HOURS = 24;
export const MONITOR_MAX_AGE_DAYS = 7;
/** Hard limit: one variant per original, and variants get no variants. */
export const MAX_VARIANTS_PER_ORIGINAL = 1;
/** Safety cap per sweep run (IG also enforces a daily publishing limit). */
export const MAX_VARIANTS_PER_SWEEP = 2;
/** Views below 40% of the account median = underperforming. */
export const UNDERPERFORM_VIEWS_RATIO = 0.4;
/** Fewer posts than this => baseline too thin to judge against. */
export const MIN_BASELINE_SAMPLE = 3;

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Engagement rate = (likes + comments) / reach. Null when reach is missing/zero. */
export function engagementRate(m: RepostMetrics): number | null {
  if (m.reach == null || m.reach <= 0) return null;
  const likes = m.likes ?? 0;
  const comments = m.comments ?? 0;
  return (likes + comments) / m.reach;
}

export function computeBaseline(all: RepostMetrics[]): PerformanceBaseline {
  const views = all.map((m) => m.views).filter((v): v is number => v != null);
  const reaches = all.map((m) => m.reach).filter((v): v is number => v != null);
  const rates = all.map(engagementRate).filter((v): v is number => v != null);
  return {
    medianViews: median(views),
    medianReach: median(reaches),
    medianEngagementRate: median(rates),
    sampleSize: all.length,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

const HONESTY_FOOTER: Hypothesis = {
  kind: "hypothesis",
  text: "Imaandaar note: ye wajah pakki nahi hai — ek andaza hai. Variant ek experiment hai, iski kamyabi ki guarantee nahi.",
  observed: "n/a — ye note har analysis ke saath jata hai",
};

/**
 * Rule-based hypotheses from the numbers. Every item is labeled
 * "hypothesis" and cites what was observed; nothing here claims a cause.
 */
export function buildHypotheses(m: RepostMetrics, baseline: PerformanceBaseline): Hypothesis[] {
  const hyps: Hypothesis[] = [];
  const er = engagementRate(m);
  const medER = baseline.medianEngagementRate;

  if (
    m.reach != null &&
    baseline.medianReach != null &&
    m.reach < UNDERPERFORM_VIEWS_RATIO * baseline.medianReach &&
    er != null &&
    medER != null &&
    er >= 0.8 * medER
  ) {
    hyps.push({
      kind: "hypothesis",
      text: "Pahunch (reach) account ke aam level se bahut kam hai, lekin jinhone dekha unka engagement theek tha — masla content se zyada timing ya shuruati seconds ka ho sakta hai.",
      observed: `reach ${m.reach} vs median ${baseline.medianReach}; engagement rate ${pct(er)} vs median ${pct(medER)}`,
    });
  }
  if (er != null && medER != null && medER > 0 && er < 0.5 * medER) {
    hyps.push({
      kind: "hypothesis",
      text: "Engagement rate aam se aadhe se bhi kam hai — caption ya video ka appeal kamzor ho sakta hai.",
      observed: `engagement rate ${pct(er)} vs median ${pct(medER)}`,
    });
  }
  if (
    m.views != null &&
    baseline.medianViews != null &&
    m.views < 0.3 * baseline.medianViews
  ) {
    hyps.push({
      kind: "hypothesis",
      text: "Views bahut kam hain — pehle 3 second ka hook kamzor ho sakta hai.",
      observed: `views ${m.views} vs median ${baseline.medianViews}`,
    });
  }
  if (hyps.length === 0) {
    hyps.push({
      kind: "hypothesis",
      text: "Views aam se kam hain lekin koi ek pattern saaf nahi — caption aur timing dono par experiment ban sakta hai.",
      observed: `views ${m.views ?? "n/a"} vs median ${baseline.medianViews ?? "n/a"}`,
    });
  }
  hyps.push(HONESTY_FOOTER);
  return hyps;
}

export function repostEligibility(input: RepostCandidateInput, now: Date): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.isVariant) {
    reasons.push("Ye khud ek variant hai — variants ke dobara variant nahi bante.");
  }
  if (input.variantCount >= MAX_VARIANTS_PER_ORIGINAL) {
    reasons.push(`Is post ka variant pehle ban chuka hai (limit: ${MAX_VARIANTS_PER_ORIGINAL} per post).`);
  }
  const ageHours = (now.getTime() - new Date(input.publishedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < REPOST_MIN_AGE_HOURS) {
    reasons.push(`Post ko kam se kam ${REPOST_MIN_AGE_HOURS} ghante purana hona chahiye (abhi ${Math.max(0, Math.floor(ageHours))}h).`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateCandidate(
  input: RepostCandidateInput,
  baseline: PerformanceBaseline,
  now: Date = new Date()
): CandidateResult {
  const base: Omit<CandidateResult, "verdict" | "hypotheses" | "eligible" | "ineligibilityReasons"> = {
    publishRecordId: input.publishRecordId,
    platformMediaId: input.platformMediaId,
    baseline,
  };

  const metricsPresent =
    input.metrics.views != null ||
    input.metrics.reach != null ||
    input.metrics.likes != null ||
    input.metrics.comments != null;

  if (baseline.sampleSize < MIN_BASELINE_SAMPLE || !metricsPresent) {
    const { reasons } = repostEligibility(input, now);
    return {
      ...base,
      verdict: "insufficient_data",
      hypotheses: [],
      eligible: false,
      ineligibilityReasons: [
        baseline.sampleSize < MIN_BASELINE_SAMPLE
          ? `Baseline bahut chhota hai (${baseline.sampleSize} posts, kam se kam ${MIN_BASELINE_SAMPLE} chahiye) — faisla nahi ho sakta.`
          : "Is post ke metrics nahi mile — andaze par flag nahi lagta.",
        ...reasons,
      ],
    };
  }

  const underperforming =
    input.metrics.views != null &&
    baseline.medianViews != null &&
    input.metrics.views < UNDERPERFORM_VIEWS_RATIO * baseline.medianViews;

  const hypotheses = underperforming ? buildHypotheses(input.metrics, baseline) : [];
  const { eligible, reasons } = repostEligibility(input, now);

  return {
    ...base,
    verdict: underperforming ? "underperforming" : "ok",
    hypotheses,
    eligible: underperforming && eligible,
    ineligibilityReasons: underperforming ? reasons : [],
  };
}
