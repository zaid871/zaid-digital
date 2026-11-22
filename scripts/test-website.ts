/**
 * Ad-hoc verification for the static website catalogue generator (§12).
 * Uses MOCK product data (clearly labeled) — no database, no network.
 *
 * Run: npx tsx scripts/test-website.ts
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  dedupeProducts,
  escapeHtml,
  generateCatalogue,
  isListableState,
  slugify,
  type SiteConfig,
  type WebsiteProduct,
} from "../src/lib/website";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const DISCLOSURE =
  "Affiliate link — I may earn a commission at no extra cost to you.";

// ---- MOCK data (fictional products for testing only) ----
const mockProducts: WebsiteProduct[] = [
  {
    id: "mock-p1",
    canonicalName: "Mock Steel Kettle <script>alert(1)</script>",
    brand: "MockBrand",
    category: "Kitchen",
    description: "A sturdy steel kettle for daily use.",
    sourceUrls: ["https://example.com/kettle"],
    imageUrls: ["https://example.com/kettle.jpg"],
    dedupHash: "hash-kettle-1",
    businessState: "QC_APPROVED",
    affiliateLinks: [
      {
        id: "mock-l1",
        program: "amazon_associates",
        url: "https://example.com/aff/kettle",
        disclosure: DISCLOSURE,
        validationStatus: "valid",
        isActive: true,
      },
    ],
    facts: [
      { claim: "Holds five liters of water", status: "verified", sourceUrl: "https://example.com/kettle-specs" },
      { claim: "Boils water in seconds", status: "unverified" },
      { claim: "Never needs cleaning", status: "rejected" },
    ],
  },
  {
    // Duplicate of p1 by dedupHash — must be prevented from listing.
    id: "mock-p1-dup",
    canonicalName: "Mock Steel Kettle Duplicate",
    brand: "MockBrand",
    category: "Kitchen",
    description: "Duplicate listing.",
    sourceUrls: [],
    imageUrls: [],
    dedupHash: "hash-kettle-1",
    businessState: "LISTED",
    affiliateLinks: [],
    facts: [],
  },
  {
    id: "mock-p2",
    canonicalName: "Mock LED Desk Lamp",
    brand: "MockBrand",
    category: "Electronics",
    description: "Adjustable desk lamp.",
    sourceUrls: [],
    imageUrls: [],
    dedupHash: "hash-lamp-2",
    businessState: "LISTED",
    affiliateLinks: [
      {
        id: "mock-l2",
        program: "flipkart",
        url: "https://example.com/aff/lamp",
        disclosure: DISCLOSURE,
        validationStatus: "unchecked",
        isActive: true,
      },
    ],
    facts: [],
  },
  {
    id: "mock-p4",
    canonicalName: "Mock Unreviewed Gadget",
    brand: null,
    category: "Electronics",
    description: null,
    sourceUrls: [],
    imageUrls: [],
    dedupHash: "hash-gadget-4",
    businessState: "NEEDS_REVIEW",
    affiliateLinks: [],
    facts: [],
  },
  {
    id: "mock-p5",
    canonicalName: "Mock Failed Item",
    brand: null,
    category: "Kitchen",
    description: null,
    sourceUrls: [],
    imageUrls: [],
    dedupHash: "hash-failed-5",
    businessState: "FAILED",
    affiliateLinks: [],
    facts: [],
  },
  {
    id: "mock-p6",
    canonicalName: "Mock Yoga Mat",
    brand: "MockBrand",
    category: "Fitness",
    description: "Non-slip exercise mat.",
    sourceUrls: [],
    imageUrls: [],
    dedupHash: "hash-mat-6",
    businessState: "PUBLISHED",
    affiliateLinks: [
      {
        id: "mock-l6a",
        program: "amazon_associates",
        url: "https://example.com/aff/mat",
        disclosure: DISCLOSURE,
        validationStatus: "valid",
        isActive: true,
      },
      {
        id: "mock-l6b",
        program: "admitad",
        url: "https://example.com/aff/mat-broken",
        disclosure: DISCLOSURE,
        validationStatus: "broken",
        isActive: true,
      },
    ],
    facts: [],
  },
];

const site: SiteConfig = {
  siteName: "Mock Test Catalogue",
  tagline: "Fictional products for generator testing",
};

async function main() {
  // ---- unit: state gating ----
  check("QC_APPROVED is listable", isListableState("QC_APPROVED"));
  check("LISTED is listable", isListableState("LISTED"));
  check("PUBLISHED is listable", isListableState("PUBLISHED"));
  check("ANALYZED is listable", isListableState("ANALYZED"));
  check("RENDERED is not listable", !isListableState("RENDERED"));
  check("NEEDS_REVIEW is not listable", !isListableState("NEEDS_REVIEW"));
  check("FAILED is not listable", !isListableState("FAILED"));
  check("DISCOVERED is not listable", !isListableState("DISCOVERED"));

  // ---- unit: dedupe ----
  const { unique, duplicates } = dedupeProducts(mockProducts);
  check("dedupe keeps first of 6 with 1 duplicate", unique.length === 5 && duplicates.length === 1);
  check("duplicate is the dup record", duplicates[0]?.id === "mock-p1-dup");

  // ---- unit: helpers ----
  check("escapeHtml escapes script tag", escapeHtml("<script>alert(1)</script>") === "&lt;script&gt;alert(1)&lt;/script&gt;");
  check("slugify basic", slugify("Kitchen & Home") === "kitchen-home");

  // ---- generate ----
  const outDir = mkdtempSync(join(tmpdir(), "site-test-"));
  const result = generateCatalogue(mockProducts, outDir, site);
  const read = (rel: string) => readFileSync(join(outDir, rel), "utf8");

  check("3 products listed (p1, p2, p6)", result.productsListed === 3, `got ${result.productsListed}`);
  check("1 duplicate prevented", result.duplicatesPrevented === 1);
  check(
    "2 skipped with state reasons",
    result.productsSkipped.length === 2 &&
      result.productsSkipped.every((s) => s.reason.includes("NEEDS_REVIEW") || s.reason.includes("FAILED")),
    JSON.stringify(result.productsSkipped)
  );

  check("index.html written", existsSync(join(outDir, "index.html")));
  check("about.html written", existsSync(join(outDir, "about.html")));
  check("privacy.html written", existsSync(join(outDir, "privacy.html")));
  check("category page written", existsSync(join(outDir, "categories", "kitchen.html")));
  check("product page for p1 written", existsSync(join(outDir, "products", "mock-p1.html")));
  check("no page for NEEDS_REVIEW product", !existsSync(join(outDir, "products", "mock-p4.html")));
  check("no page for FAILED product", !existsSync(join(outDir, "products", "mock-p5.html")));
  check("no page for duplicate", !existsSync(join(outDir, "products", "mock-p1-dup.html")));
  const productFiles = readdirSync(join(outDir, "products"));
  check("exactly 3 product pages", productFiles.length === 3, productFiles.join(","));

  // ---- content checks on p1 ----
  const p1 = read("products/mock-p1.html");
  check("p1: injection escaped", p1.includes("&lt;script&gt;") && !p1.includes("<script>alert(1)</script>"));
  check("p1: neutral CTA present", p1.includes(">View Product<"));
  check("p1: affiliate disclosure present", p1.includes(DISCLOSURE));
  check("p1: verified fact shown", p1.includes("Holds five liters of water"));
  check("p1: unverified fact hidden", !p1.includes("Boils water in seconds"));
  check("p1: rejected fact hidden", !p1.includes("Never needs cleaning"));
  check("p1: valid affiliate link rendered", p1.includes("https://example.com/aff/kettle"));
  check("p1: sponsored rel on affiliate link", p1.includes('rel="sponsored nofollow noopener"'));

  // ---- p2: no valid links → fallback + disclosure still mandatory ----
  const p2 = read("products/mock-p2.html");
  check("p2: unchecked link NOT rendered", !p2.includes("https://example.com/aff/lamp"));
  check("p2: no-links fallback shown", p2.includes("No purchase links available right now"));
  check("p2: disclosure block still present", p2.includes("clearly disclosed"));

  // ---- p6: broken link excluded from page ----
  const p6 = read("products/mock-p6.html");
  check("p6: broken link NOT rendered", !p6.includes("mat-broken"));
  check("p6: valid link rendered", p6.includes("https://example.com/aff/mat"));

  // ---- no prices anywhere ----
  const pricePattern = /(₹|\$\s?\d|Rs\.?\s*\d|\b\d+\s*(INR|USD|rupees))/i;
  const allHtml = result.pagesWritten.map(read).join("\n");
  check("no price patterns in any page", !pricePattern.test(allHtml));

  // ---- broken-link report ----
  const brokenUrls = result.brokenLinks.map((b) => b.url);
  check("report lists unchecked link", brokenUrls.includes("https://example.com/aff/lamp"));
  check("report lists broken link", brokenUrls.includes("https://example.com/aff/mat-broken"));
  check(
    "report does not list valid links",
    !brokenUrls.includes("https://example.com/aff/kettle") &&
      !brokenUrls.includes("https://example.com/aff/mat")
  );
  const brokenEntry = result.brokenLinks.find((b) => b.linkId === "mock-l6b");
  check(
    "report entry carries product context",
    brokenEntry?.productId === "mock-p6" && brokenEntry?.program === "admitad"
  );

  // ---- index lists only listable ----
  const index = read("index.html");
  check("index links p1", index.includes("products/mock-p1.html"));
  check("index omits NEEDS_REVIEW", !index.includes("mock-p4"));
  check("index omits duplicate", !index.includes("mock-p1-dup"));

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
