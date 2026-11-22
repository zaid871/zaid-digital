/**
 * Affiliate marketing agent (§4) — public surface.
 */
export {
  AFFILIATE_PROGRAMS,
  DISCLOSURE_TEXT,
  isAffiliateProgram,
} from "./programs";
export type { AffiliateProgram } from "./programs";
export { validateLink } from "./validate";
export type { LinkStatus, LinkValidationResult, ValidateLinkOptions } from "./validate";
