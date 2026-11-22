/**
 * Website catalogue input types — shaped like the Prisma models
 * (Product, ProductFact, AffiliateLink) but as plain objects, so the static
 * generator never needs a database connection.
 *
 * NOTE: there is intentionally NO price field anywhere here. Prices are never
 * displayed on the site (user constraint) and never enter the generator.
 */

export type WebsiteFactStatus = "verified" | "unverified" | "rejected";
export type WebsiteLinkStatus = "unchecked" | "valid" | "broken" | "redirected";

export interface WebsiteProductFact {
  claim: string;
  status: WebsiteFactStatus;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}

export interface WebsiteAffiliateLink {
  id: string;
  program: string;
  url: string;
  disclosure: string;
  validationStatus: WebsiteLinkStatus;
  isActive: boolean;
}

export interface WebsiteProduct {
  id: string;
  canonicalName: string;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  sourceUrls: string[];
  imageUrls: string[];
  /** sha256 of normalized name+brand; drives duplicate-listing prevention */
  dedupHash: string;
  /** §19 business lifecycle state, e.g. QC_APPROVED, LISTED, PUBLISHED */
  businessState: string;
  affiliateLinks: WebsiteAffiliateLink[];
  facts: WebsiteProductFact[];
}

export interface SiteConfig {
  siteName: string;
  tagline: string;
  /** contact email shown on the about page (optional) */
  contactEmail?: string;
}
