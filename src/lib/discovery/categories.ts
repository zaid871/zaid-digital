/**
 * Category allowlist for the product discovery agent (§3).
 *
 * Permissible categories only — and explicitly NOT restricted to Islamic-only
 * products: ordinary electronics, kitchen and household goods are in scope.
 * Anything outside this list is rejected at the pre-filter stage.
 */
export const ALLOWED_CATEGORIES = [
  "electronics",
  "mobile_accessories",
  "computers_ai_tools",
  "kitchen",
  "household",
  "useful_physical",
  "digital_products_templates",
  "other_permissible",
] as const;

export type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<AllowedCategory, string> = {
  electronics: "Electronics",
  mobile_accessories: "Mobile phones and accessories",
  computers_ai_tools: "Computers and AI tools",
  kitchen: "Kitchen products",
  household: "Household products",
  useful_physical: "Useful physical products",
  digital_products_templates: "Permissible digital products and templates",
  other_permissible: "Other permissible affiliate products",
};

export function isAllowedCategory(category: string): category is AllowedCategory {
  return (ALLOWED_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Affiliate scope, decided 2026-11-20: affiliate side is Tech + Useful
 * Gadgets ONLY for now (IG tech_fynd / Tech Finds, IG daily_useful.gadgets /
 * Useful Gadgets). Niche ids match the publishing registry (accounts.ts:
 * "tech" / "gadgets") so a filtered candidate routes to the right account.
 *
 * Mapping is deliberately strict: kitchen / household stay OUT — they are
 * broad categories, not gadgets. If the user wants them in, add them to
 * "gadgets" here; nothing else needs to change.
 */
export const AFFILIATE_NICHES = ["tech", "gadgets"] as const;

export type AffiliateNiche = (typeof AFFILIATE_NICHES)[number];

export const AFFILIATE_NICHE_CATEGORIES: Record<AffiliateNiche, AllowedCategory[]> = {
  tech: ["electronics", "mobile_accessories", "computers_ai_tools"],
  gadgets: ["useful_physical"],
};

/** Which affiliate niche a category belongs to, or null when out of scope. */
export function affiliateNicheForCategory(category: string): AffiliateNiche | null {
  for (const niche of AFFILIATE_NICHES) {
    if ((AFFILIATE_NICHE_CATEGORIES[niche] as readonly string[]).includes(category)) {
      return niche;
    }
  }
  return null;
}
