/**
 * Product discovery agent (§3) — public surface.
 */
export type {
  DiscoveryRunResult,
  DiscoverySource,
  DuplicateRecord,
  FilteredCandidate,
  ProductCandidate,
  ProductClaim,
  SourceError,
} from "./types";
export {
  AFFILIATE_NICHES,
  AFFILIATE_NICHE_CATEGORIES,
  ALLOWED_CATEGORIES,
  CATEGORY_LABELS,
  affiliateNicheForCategory,
  isAllowedCategory,
} from "./categories";
export type { AffiliateNiche, AllowedCategory } from "./categories";
export { dedupHash, dedupeCandidates, normalizeForDedup } from "./dedup";
export type { DedupDuplicate } from "./dedup";
export {
  prefilterCandidate,
  runDiscovery,
  trendingScore,
} from "./filter";
export type { PrefilterOptions, PrefilterResult, TrendingSignals } from "./filter";
