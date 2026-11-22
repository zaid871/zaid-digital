/**
 * Affiliate programmes allowlist (§4).
 * Matches the Prisma `AffiliateLink.program` vocabulary exactly.
 * Inclusion here is NOT an approval claim — programme approval is manual
 * and must never be assumed (§4: "Affiliate approval automatically milne ka
 * assumption nahi rakhna").
 */
export const AFFILIATE_PROGRAMS = [
  "amazon_associates",
  "flipkart",
  "admitad",
  "impact",
  "vcommission",
  "other",
] as const;

export type AffiliateProgram = (typeof AFFILIATE_PROGRAMS)[number];

export function isAffiliateProgram(value: string): value is AffiliateProgram {
  return (AFFILIATE_PROGRAMS as readonly string[]).includes(value);
}

/**
 * Standard affiliate disclosure attached to every affiliate link.
 * Byte-identical to the Prisma `AffiliateLink.disclosure` default.
 */
export const DISCLOSURE_TEXT =
  "Affiliate link — I may earn a commission at no extra cost to you.";
