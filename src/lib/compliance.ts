/**
 * Shariah / content compliance policy — configurable, documented rules.
 * Runs before scripting and again before final delivery.
 * Uncertain cases return NEEDS_REVIEW, never auto-approve.
 */

export interface ComplianceRule {
  id: string;
  description: string;
}

export const COMPLIANCE_RULES: ComplianceRule[] = [
  { id: "no-music", description: "No music or musical sound effects in audio." },
  { id: "no-deception", description: "No deceptive demonstrations or staged performance claims." },
  { id: "no-fake-reviews", description: "No fabricated reviews, testimonials, endorsements, or certifications." },
  { id: "no-invented-specs", description: "No invented prices, discounts, specifications, or guarantees." },
  { id: "no-unsupported-claims", description: "No unsupported health, financial, safety, or comparative claims." },
  { id: "no-false-endorsement", description: "No implied official endorsement where none exists." },
  { id: "no-hidden-limitations", description: "Do not hide relevant product limitations." },
  { id: "no-earnings-claims", description: "No claims about earnings or outcomes without reliable evidence." },
  { id: "affiliate-disclosure", description: "Affiliate disclosures handled in caption/description when required." },
];

export type ComplianceVerdict = "APPROVED" | "NEEDS_REVIEW" | "REJECTED";

export interface ComplianceAssessmentInput {
  productCategory: string | null;
  claims: { text: string; verified: boolean }[];
  hasMusic: boolean;
  hasProhibitedAudio: boolean;
}

/**
 * Deterministic policy evaluation. AI-assisted review (Phase 7) can only
 * escalate toward NEEDS_REVIEW/REJECTED, never downgrade a rejection.
 */
export function assessCompliance(input: ComplianceAssessmentInput): {
  verdict: ComplianceVerdict;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (input.hasMusic || input.hasProhibitedAudio) {
    reasons.push("Prohibited audio detected (music or musical SFX).");
  }
  const unverified = input.claims.filter((c) => !c.verified);
  if (unverified.length > 0) {
    reasons.push(`${unverified.length} unverified claim(s) require human review.`);
  }

  if (reasons.length === 0) return { verdict: "APPROVED", reasons };
  // Deterministic rule failures reject; uncertainty escalates to review.
  if (input.hasMusic || input.hasProhibitedAudio) {
    return { verdict: "REJECTED", reasons };
  }
  return { verdict: "NEEDS_REVIEW", reasons };
}

/** Price-like patterns that must never appear in generated content. */
export const PRICE_PATTERN = /(₹|rs\.?\s?\d|inr\s?\d|\$\s?\d|\bprice\b|\bdiscount\b|\boffer\b|\bdeal\b|\b\d+\s?%\s?off\b)/i;

/**
 * Banned promotional language: fabricated social proof, guarantees,
 * discounts, and earnings claims. Generation stages reject these;
 * QA re-scans as a safety net.
 */
export const BANNED_CLAIM_PATTERN =
  /\b(guarantee[ds]?|warranty|testimonial|endorsement|\d+\s?star|rated\s?\d|reviews?|customers?\s?(love|saysaid)|best\s?seller|number\s?one|free\s?(trial|gift)|money[-\s]?back|risk[-\s]?free|limited\s?(time|offer)|act\s?now|buy\s?now|discount|offer|deal|coupon|promo(code)?|\d+\s?%\s?off|earn\s?(money|\$|₹)|get\s?rich|financial\s?freedom)\b|#\s?1\b/i;
