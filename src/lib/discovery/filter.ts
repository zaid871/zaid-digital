/**
 * Compliance pre-filter for the product discovery agent (§3 + §5).
 *
 * Deterministic, keyword-driven first pass over raw candidates:
 *  - category outside the allowlist → REJECTED
 *  - product NAME matches a disallowed-product pattern → REJECTED
 *  - description/features merely mention a disallowed item → NEEDS_REVIEW
 *    (keyword context is uncertain; a human decides)
 *  - any unverified claim → NEEDS_REVIEW (§5: uncertain → hold for review)
 *
 * This is a pre-filter, not the final word: downstream research (§6) and the
 * QC agent (§11) re-verify everything before any video is rendered or published.
 */
import type { ComplianceVerdict } from "../compliance";
import {
  affiliateNicheForCategory,
  isAllowedCategory,
} from "./categories";
import { dedupHash } from "./dedup";
import type {
  DiscoveryRunResult,
  DiscoverySource,
  FilteredCandidate,
  ProductCandidate,
} from "./types";

/**
 * Conservative keyword patterns for products that are not permissible to
 * promote under the user's Deobandi fiqh requirements (§5). Word-boundaried
 * to avoid false hits inside longer words. This list is intentionally narrow —
 * promotion is NOT restricted to Islamic-only products.
 */
const DISALLOWED_PATTERNS: RegExp[] = [
  /\b(alcohol|liquor|whisk(e)y|vodka|rum|gin|tequila|beer|wine|champagne)\b/i,
  /\b(pork|bacon|ham|lard|pepperoni|salami)\b/i,
  /\b(gambling|casino|betting|lottery|poker|blackjack|slot\s*machine)\b/i,
  /\b(porn|pornographic|adult\s*(toy|video|content|site)|escort\s*service)\b/i,
  /\b(tobacco|cigarette|cigar|vape|vaping|nicotine|hookah|shisha)\b/i,
  /\b(gun|rifle|pistol|revolver|ammunition|firearm)\b/i,
  /\b(payday\s*loan|interest[\s-]*based\s*loan|riba[\s-]*loan)\b/i,
];

export interface PrefilterResult {
  verdict: ComplianceVerdict;
  reasons: string[];
}

export interface PrefilterOptions {
  /**
   * Affiliate-only scope (2026-11-20 decision: Tech + Useful Gadgets only).
   * When true, a candidate whose category maps to no affiliate niche is
   * REJECTED even though the category is allowlisted in general. Default
   * false — existing callers keep the general allowlist behaviour.
   */
  affiliateOnly?: boolean;
}

/** Pure pre-filter for a single candidate. No I/O, no AI calls. */
export function prefilterCandidate(
  candidate: ProductCandidate,
  opts: PrefilterOptions = {},
): PrefilterResult {
  if (!isAllowedCategory(candidate.category)) {
    return {
      verdict: "REJECTED",
      reasons: [`Category "${candidate.category}" is not in the allowed list.`],
    };
  }

  if (opts.affiliateOnly && affiliateNicheForCategory(candidate.category) === null) {
    return {
      verdict: "REJECTED",
      reasons: [
        `Category "${candidate.category}" is outside the affiliate scope (Tech + Useful Gadgets only, 2026-11-20).`,
      ],
    };
  }

  const nameHaystack = `${candidate.name} ${candidate.brand ?? ""}`;
  if (DISALLOWED_PATTERNS.some((re) => re.test(nameHaystack))) {
    return {
      verdict: "REJECTED",
      reasons: ["Product name matches a disallowed-product pattern (§5)."],
    };
  }

  const reasons: string[] = [];
  const restHaystack = `${candidate.description ?? ""} ${candidate.features.join(" ")}`;
  if (DISALLOWED_PATTERNS.some((re) => re.test(restHaystack))) {
    reasons.push(
      "Description or features mention a potentially disallowed item — needs human review.",
    );
  }

  const unverified = candidate.claims.filter((c) => !c.verified);
  if (unverified.length > 0) {
    reasons.push(`${unverified.length} unverified claim(s) require human review.`);
  }

  if (reasons.length > 0) {
    return { verdict: "NEEDS_REVIEW", reasons };
  }
  return { verdict: "APPROVED", reasons: [] };
}

/**
 * Run discovery across all sources: fetch → dedupe → pre-filter.
 * A source that throws is recorded in `errors` and never aborts the run.
 */
export async function runDiscovery(sources: DiscoverySource[]): Promise<DiscoveryRunResult> {
  const result: DiscoveryRunResult = {
    approved: [],
    needsReview: [],
    rejected: [],
    duplicates: [],
    errors: [],
  };
  const seen = new Map<string, ProductCandidate>();

  for (const source of sources) {
    let candidates: ProductCandidate[];
    try {
      candidates = await source.fetchCandidates();
    } catch (err) {
      result.errors.push({
        source: source.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const candidate of candidates) {
      const hash = dedupHash(candidate.name, candidate.brand);
      const first = seen.get(hash);
      if (first) {
        result.duplicates.push({ candidate, dedupHash: hash, duplicateOf: first.name });
        continue;
      }
      seen.set(hash, candidate);
      const { verdict, reasons } = prefilterCandidate(candidate);
      const filtered: FilteredCandidate = { candidate, dedupHash: hash, verdict, reasons };
      if (verdict === "APPROVED") result.approved.push(filtered);
      else if (verdict === "NEEDS_REVIEW") result.needsReview.push(filtered);
      else result.rejected.push(filtered);
    }
  }
  return result;
}

/** Optional signals for ranking candidates. All fields optional — the stub
 *  degrades gracefully when a source provides none. */
export interface TrendingSignals {
  /** 1 = top of the source feed; lower is better. */
  sourceRank?: number;
  /** How many sources surfaced this product. */
  mentionCount?: number;
  /** Hours since the product was first seen. */
  recencyHours?: number;
}

/**
 * STUB — deterministic placeholder that folds the available signals into a
 * 0..1 score. Replace with real demand/audience scoring before production use;
 * do not treat this number as measured performance.
 */
export function trendingScore(signals: TrendingSignals): number {
  const rankComponent =
    signals.sourceRank !== undefined && signals.sourceRank > 0 ? 1 / signals.sourceRank : 0;
  const mentionComponent = Math.min(1, (signals.mentionCount ?? 0) / 10);
  const recencyComponent =
    signals.recencyHours === undefined ? 0.5 : Math.max(0, 1 - signals.recencyHours / 168);
  const score = 0.5 * rankComponent + 0.3 * mentionComponent + 0.2 * recencyComponent;
  return Math.round(score * 1000) / 1000;
}
