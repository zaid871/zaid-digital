/**
 * Shared helpers for multi-platform social publishing (Pinterest, X,
 * LinkedIn). Every outbound copy is compliance-scanned (no prices, no
 * banned claims) and carries the affiliate disclosure — the same halal
 * rules as video scripts and captions.
 */
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";

/** Byte-meaning-identical to the affiliate DISCLOSURE_TEXT. */
export const SOCIAL_DISCLOSURE =
  "Affiliate link — I may earn a commission at no extra cost to you.";

export interface SocialProduct {
  name: string;
  category: string;
  /** Public product/landing URL the post links to. */
  link: string;
  /** Public image URL (required for Pinterest). */
  imageUrl?: string;
  description?: string;
  features?: string[];
}

/** Throws when the copy violates compliance — the publish never happens. */
export function assertCleanCopy(text: string, surface: string): void {
  const priceHit = text.match(PRICE_PATTERN);
  if (priceHit) {
    throw new Error(
      `${surface}: price/offer pattern "${priceHit[0].slice(0, 40)}" — publish blocked by compliance.`
    );
  }
  const bannedHit = text.match(BANNED_CLAIM_PATTERN);
  if (bannedHit) {
    throw new Error(
      `${surface}: banned promotional language "${bannedHit[0].slice(0, 40)}" — publish blocked by compliance.`
    );
  }
}

/** Append the affiliate disclosure (skipped when already present). */
export function withDisclosure(text: string, disclosure: string = SOCIAL_DISCLOSURE): string {
  const t = text.trim();
  if (!t) return disclosure;
  return t.includes(disclosure) ? t : `${t}\n\n${disclosure}`;
}

/** Typed publisher error — never a fake success. */
export class SocialPublishError extends Error {
  readonly code:
    | "not_configured"
    | "validation"
    | "auth"
    | "upstream"
    | "rate_limited"
    | "token_missing"
    | "token_refresh_failed"
    | "submit_failed";
  readonly retryable: boolean;
  constructor(
    code: SocialPublishError["code"],
    message: string,
    retryable = false
  ) {
    super(message);
    this.name = "SocialPublishError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function notConfigured(what: string): SocialPublishError {
  return new SocialPublishError(
    "not_configured",
    `${what} is not configured — set the env var at deploy; nothing was published.`
  );
}
