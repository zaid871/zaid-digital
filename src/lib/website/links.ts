/**
 * Broken-link reporting (§12: "Broken-link checking").
 *
 * Lists every affiliate link whose validationStatus is not "valid", so ops
 * can re-check or deactivate it. Links reported here are never rendered on
 * public product pages (see catalogue.ts renderableLinks).
 */
import type { WebsiteProduct } from "./types";

export interface BrokenLinkEntry {
  productId: string;
  productName: string;
  linkId: string;
  program: string;
  url: string;
  validationStatus: string;
  isActive: boolean;
}

export function brokenLinkReport(products: WebsiteProduct[]): BrokenLinkEntry[] {
  const entries: BrokenLinkEntry[] = [];
  for (const product of products) {
    for (const link of product.affiliateLinks) {
      if (link.validationStatus !== "valid") {
        entries.push({
          productId: product.id,
          productName: product.canonicalName,
          linkId: link.id,
          program: link.program,
          url: link.url,
          validationStatus: link.validationStatus,
          isActive: link.isActive,
        });
      }
    }
  }
  return entries;
}
