/**
 * Product discovery agent (§3) — candidate types and pluggable sources.
 * Pure types only; no I/O in this file.
 */
import type { ComplianceVerdict } from "../compliance";

/** A single product claim scraped from a source. `verified` is true only when
 *  the claim is backed by a verifiable source — never assumed. */
export interface ProductClaim {
  text: string;
  verified: boolean;
}

/** A product candidate as returned by a DiscoverySource. This is raw,
 *  untrusted input: it must pass dedup + the §5 pre-filter before use. */
export interface ProductCandidate {
  name: string;
  brand?: string;
  /** Category key — must be in ALLOWED_CATEGORIES to be considered. */
  category: string;
  description?: string;
  features: string[];
  sourceUrls: string[];
  claims: ProductClaim[];
  /** Affiliate program key, if the source already knows it. */
  affiliateProgram?: string;
  affiliateUrl?: string;
  /** ISO-8601 timestamp of when the source surfaced this candidate. */
  discoveredAt: string;
}

/** Pluggable discovery source (§3: public feeds, permitted APIs, approved
 *  affiliate platforms). Implementations must surface real products only —
 *  never fabricate candidates. */
export interface DiscoverySource {
  /** Stable identifier for logging, e.g. "partner-feed". */
  name: string;
  fetchCandidates(): Promise<ProductCandidate[]>;
}

export interface FilteredCandidate {
  candidate: ProductCandidate;
  /** sha256 dedup key — matches Prisma `Product.dedupHash` semantics. */
  dedupHash: string;
  verdict: ComplianceVerdict;
  reasons: string[];
}

export interface DuplicateRecord {
  candidate: ProductCandidate;
  dedupHash: string;
  duplicateOf: string;
}

export interface SourceError {
  source: string;
  error: string;
}

export interface DiscoveryRunResult {
  approved: FilteredCandidate[];
  needsReview: FilteredCandidate[];
  rejected: FilteredCandidate[];
  duplicates: DuplicateRecord[];
  /** A failing source never aborts the whole run (§18: components stay independent). */
  errors: SourceError[];
}
