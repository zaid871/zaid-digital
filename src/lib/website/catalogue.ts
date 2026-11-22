/**
 * Static catalogue generator (§12).
 *
 * Generates a fully static HTML site from product records:
 *   index.html                 — catalogue of listable products
 *   products/<id>.html         — product page (description, verified facts only,
 *                                permitted images, affiliate links, neutral CTA,
 *                                mandatory affiliate disclosure)
 *   categories/<slug>.html     — per-category listing pages
 *   about.html / privacy.html  — required static pages
 *
 * Rules enforced here:
 * - Only products at QC_APPROVED or later (§19 lifecycle) get pages.
 * - Duplicate listing prevention via dedupHash (first record wins).
 * - Only ACTIVE links with validationStatus === "valid" are rendered;
 *   everything else goes to the broken-link report (links.ts), never to a page.
 * - Only "verified" facts are shown; unverified/rejected claims stay out.
 * - NO prices: the input types carry no price field, and all output is
 *   HTML-escaped to prevent injection.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { SiteConfig, WebsiteProduct, WebsiteAffiliateLink } from "./types";
import { brokenLinkReport } from "./links";

/** §19 lifecycle order. A product is listable from QC_APPROVED onward. */
export const LISTING_ORDER = [
  "DISCOVERED",
  "VERIFIED",
  "SCRIPTED",
  "ASSETS_READY",
  "RENDERED",
  "QC_APPROVED",
  "LISTED",
  "PUBLISHED",
  "ANALYZED",
] as const;

const LISTABLE_FROM = "QC_APPROVED";

export function isListableState(state: string): boolean {
  return (
    LISTING_ORDER.indexOf(state as (typeof LISTING_ORDER)[number]) >=
    LISTING_ORDER.indexOf(LISTABLE_FROM)
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "uncategorized";
}

export interface DedupeResult {
  unique: WebsiteProduct[];
  duplicates: WebsiteProduct[];
}

/** Duplicate listing prevention: first record per dedupHash wins. */
export function dedupeProducts(products: WebsiteProduct[]): DedupeResult {
  const seen = new Set<string>();
  const unique: WebsiteProduct[] = [];
  const duplicates: WebsiteProduct[] = [];
  for (const product of products) {
    if (seen.has(product.dedupHash)) {
      duplicates.push(product);
      continue;
    }
    seen.add(product.dedupHash);
    unique.push(product);
  }
  return { unique, duplicates };
}

/** Links safe to render on a public page: active AND validated. */
export function renderableLinks(product: WebsiteProduct): WebsiteAffiliateLink[] {
  return product.affiliateLinks.filter(
    (link) => link.isActive && link.validationStatus === "valid"
  );
}

function pageShell(site: SiteConfig, title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(site.siteName)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6}
header{border-bottom:1px solid #ddd;margin-bottom:24px;padding-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card{border:1px solid #ddd;border-radius:8px;padding:12px}
.card img{width:100%;height:160px;object-fit:cover;border-radius:4px}
.cta{display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin:8px 0}
.disclosure{background:#f7f7f7;border-left:4px solid #999;padding:10px 14px;margin:16px 0;font-size:0.9em;color:#444}
footer{margin-top:48px;padding-top:12px;border-top:1px solid #ddd;font-size:0.85em;color:#666}
ul.facts{padding-left:20px}
</style>
</head>
<body>
<header><h1>${escapeHtml(site.siteName)}</h1><p>${escapeHtml(site.tagline)}</p>
<nav><a href="index.html">Catalogue</a> · <a href="about.html">About</a> · <a href="privacy.html">Privacy</a></nav></header>
<main>${body}</main>
<footer><p>${escapeHtml(site.siteName)} — independent product catalogue. Some links are affiliate links; see each product page for disclosure.</p></footer>
</body>
</html>`;
}

function productCard(product: WebsiteProduct): string {
  const img = product.imageUrls[0];
  const cat = product.category ?? "Uncategorized";
  return `<div class="card">
${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(product.canonicalName)}">` : ""}
<h3>${escapeHtml(product.canonicalName)}</h3>
<p>${escapeHtml(cat)}${product.brand ? ` · ${escapeHtml(product.brand)}` : ""}</p>
<a href="products/${escapeHtml(product.id)}.html">View details</a>
</div>`;
}

function productPage(site: SiteConfig, product: WebsiteProduct): string {
  const links = renderableLinks(product);
  const verifiedFacts = product.facts.filter((f) => f.status === "verified");
  const cat = product.category ?? "Uncategorized";

  const factsHtml =
    verifiedFacts.length > 0
      ? `<h2>Verified facts</h2><ul class="facts">${verifiedFacts
          .map(
            (f) =>
              `<li>${escapeHtml(f.claim)}${
                f.sourceUrl
                  ? ` <a href="${escapeHtml(f.sourceUrl)}" rel="nofollow noopener" target="_blank">[source${f.sourceTitle ? `: ${escapeHtml(f.sourceTitle)}` : ""}]</a>`
                  : ""
              }</li>`
          )
          .join("")}</ul>`
      : "";

  const imagesHtml =
    product.imageUrls.length > 0
      ? `<div>${product.imageUrls
          .map(
            (src) =>
              `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.canonicalName)}" style="max-width:100%;border-radius:8px;margin:8px 0">`
          )
          .join("")}</div>`
      : "";

  const linksHtml =
    links.length > 0
      ? links
          .map(
            (link) => `<div>
<a class="cta" href="${escapeHtml(link.url)}" target="_blank" rel="sponsored nofollow noopener">View Product</a>
<div class="disclosure">${escapeHtml(link.disclosure)}</div>
</div>`
          )
          .join("")
      : `<p>No purchase links available right now.</p>
<div class="disclosure">If affiliate links are added later, they will be clearly disclosed here.</div>`;

  const body = `<h2>${escapeHtml(product.canonicalName)}</h2>
<p><strong>${escapeHtml(cat)}</strong>${product.brand ? ` · ${escapeHtml(product.brand)}` : ""}</p>
${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
${imagesHtml}
${factsHtml}
<h2>Where to find it</h2>
${linksHtml}`;
  return pageShell(site, product.canonicalName, body);
}

function aboutPage(site: SiteConfig): string {
  return pageShell(
    site,
    "About",
    `<h2>About</h2>
<p>${escapeHtml(site.siteName)} is an independent catalogue of products we have researched and reviewed.</p>
<p>We only list products that have passed our research, verification and quality checks. Listings never include prices — always check the retailer's page for current pricing and availability.</p>
<p>Some outbound links are affiliate links, which means we may earn a commission if you make a purchase through them, at no extra cost to you. Every product page discloses this.</p>
${site.contactEmail ? `<p>Contact: ${escapeHtml(site.contactEmail)}</p>` : ""}`
  );
}

function privacyPage(site: SiteConfig): string {
  return pageShell(
    site,
    "Privacy Policy",
    `<h2>Privacy Policy</h2>
<p>This is a static website. We do not run accounts, do not set tracking cookies ourselves, and do not collect personal data through forms on this site.</p>
<p>Outbound affiliate and retailer links may set third-party cookies on the retailer's own site, subject to that retailer's privacy policy — this is disclosed on every product page carrying such links.</p>
<p>We do not sell personal information because we do not collect it.</p>`
  );
}

export interface CatalogueResult {
  pagesWritten: string[];
  productsListed: number;
  productsSkipped: { id: string; reason: string }[];
  duplicatesPrevented: number;
  brokenLinks: ReturnType<typeof brokenLinkReport>;
}

/**
 * Generate the full static site into outDir. Returns a summary including
 * skip reasons and the broken-link report (for ops follow-up).
 */
export function generateCatalogue(
  products: WebsiteProduct[],
  outDir: string,
  site: SiteConfig
): CatalogueResult {
  const { unique, duplicates } = dedupeProducts(products);
  const pagesWritten: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const listable = unique.filter((p) => {
    if (!isListableState(p.businessState)) {
      skipped.push({
        id: p.id,
        reason: `businessState ${p.businessState} is before QC_APPROVED — not listed`,
      });
      return false;
    }
    return true;
  });

  mkdirSync(join(outDir, "products"), { recursive: true });
  mkdirSync(join(outDir, "categories"), { recursive: true });

  const write = (rel: string, html: string) => {
    writeFileSync(join(outDir, rel), html, "utf8");
    pagesWritten.push(rel);
  };

  // Product pages
  for (const product of listable) {
    write(`products/${product.id}.html`, productPage(site, product));
  }

  // Category pages
  const byCategory = new Map<string, WebsiteProduct[]>();
  for (const product of listable) {
    const cat = product.category?.trim() || "Uncategorized";
    const list = byCategory.get(cat) ?? [];
    list.push(product);
    byCategory.set(cat, list);
  }
  const categoryLinks = [...byCategory.keys()]
    .map((cat) => `<li><a href="categories/${slugify(cat)}.html">${escapeHtml(cat)}</a></li>`)
    .join("");
  for (const [cat, items] of byCategory) {
    write(
      `categories/${slugify(cat)}.html`,
      pageShell(
        site,
        `Category: ${cat}`,
        `<h2>${escapeHtml(cat)}</h2><div class="grid">${items.map(productCard).join("")}</div>`
      )
    );
  }

  // Index
  write(
    "index.html",
    pageShell(
      site,
      "Catalogue",
      `<h2>Product catalogue</h2>
${categoryLinks ? `<h3>Categories</h3><ul>${categoryLinks}</ul>` : ""}
<div class="grid">${listable.map(productCard).join("")}</div>
${listable.length === 0 ? "<p>No products listed yet.</p>" : ""}`
    )
  );

  write("about.html", aboutPage(site));
  write("privacy.html", privacyPage(site));

  return {
    pagesWritten,
    productsListed: listable.length,
    productsSkipped: skipped,
    duplicatesPrevented: duplicates.length,
    brokenLinks: brokenLinkReport(products),
  };
}
