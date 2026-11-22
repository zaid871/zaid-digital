/**
 * test-digital-store-filter: store search + sort (pure, no disk).
 * Run: npx tsx scripts/test-digital-store-filter.ts
 */
import { filterStoreProducts, matchesQuery } from "../src/lib/digital/store-filter";
import type { StorefrontProduct } from "../src/lib/digital/storefront";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

function p(id: string, title: string, createdAt: string, extra: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    id,
    category: "ebooks",
    categoryLabel: "Ebooks",
    type: "ebook",
    title,
    subtitle: null,
    description: null,
    createdAt,
    previewImage: null,
    badge: null,
    details: [],
    includedFiles: [],
    hasZip: false,
    ...extra,
  };
}

async function main() {
  const products = [
    p("wedding-abc", "Wedding Invites Guide", "2026-11-14T08:00:00.000Z", { subtitle: "Shaadi ki planning" }),
    p("quote-def", "Quote Pack", "2026-11-13T08:00:00.000Z", { category: "templates", categoryLabel: "Templates", type: "template_pack" }),
    p("budget-ghi", "Budget Tracker", "2026-11-12T08:00:00.000Z", { category: "spreadsheets", categoryLabel: "Spreadsheets", type: "xlsx" }),
  ];

  check("empty query matches all", filterStoreProducts(products, "", "newest").length === 3);
  check("query matches title", filterStoreProducts(products, "wedding", "newest").map((x) => x.id).join() === "wedding-abc");
  check("query matches subtitle", filterStoreProducts(products, "shaadi", "newest").map((x) => x.id).join() === "wedding-abc");
  check("query matches category label", filterStoreProducts(products, "templates", "newest").map((x) => x.id).join() === "quote-def");
  check("query is case-insensitive", filterStoreProducts(products, "WEDDING", "newest").length === 1);
  check("multi-word query needs all words",
    filterStoreProducts(products, "wedding guide", "newest").length === 1 &&
    filterStoreProducts(products, "wedding tracker", "newest").length === 0);
  check("no match returns empty", filterStoreProducts(products, "zzz", "newest").length === 0);
  check("matchesQuery: empty query is true", matchesQuery(products[0], "   "));

  check("sort newest (default order)",
    filterStoreProducts(products, "", "newest").map((x) => x.id).join() === "wedding-abc,quote-def,budget-ghi");
  check("sort oldest",
    filterStoreProducts(products, "", "oldest").map((x) => x.id).join() === "budget-ghi,quote-def,wedding-abc");
  check("sort title A-Z",
    filterStoreProducts(products, "", "title").map((x) => x.id).join() === "budget-ghi,quote-def,wedding-abc");
  check("filter does not mutate input",
    products[0].id === "wedding-abc" && filterStoreProducts(products, "", "title")[0].id === "budget-ghi");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
