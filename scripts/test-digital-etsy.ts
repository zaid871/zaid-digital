/**
 * Etsy Open API v3 tests: search parse + favorers sort, shop total sales
 * + reviews enrichment, no-key skip, 401/429 graceful warnings.
 * All fetch mocked — no real key needed.
 * Run: npx tsx scripts/test-digital-etsy.ts
 */
import { etsyEvidenceLine, searchEtsyListings } from "../src/lib/digital/etsy";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

const SEARCH_FIXTURE = {
  count: 3,
  results: [
    { listing_id: 11, title: "Minimal Budget Planner &amp; Tracker", url: "https://www.etsy.com/listing/11/x", price: { amount: 1200, divisor: 100, currency_code: "USD" }, num_favorers: 450, tags: ["planner", "budget"], shop_id: 101 },
    { listing_id: 22, title: "Aesthetic Budget Planner Bundle", url: "https://www.etsy.com/listing/22/y", price: { amount: 899, divisor: 100, currency_code: "USD" }, num_favorers: 2100, tags: ["bundle"], shop_id: 102 },
    { listing_id: 33, title: "Budget Planner Printable", url: "https://www.etsy.com/listing/33/z", price: { amount: 500, divisor: 100, currency_code: "USD" }, num_favorers: 120, tags: ["printable"], shop_id: 101 },
  ],
};
const SHOP_101 = { shop_id: 101, transaction_sold_count: 15400 };
const SHOP_102 = { shop_id: 102, transaction_sold_count: 3200 };
const REVIEWS_22 = { count: 340, results: [{ rating: 5 }] };

function mockFetch(url: string): Promise<Response> {
  let body: unknown = {};
  let status = 200;
  if (url.includes("/listings/active")) body = SEARCH_FIXTURE;
  else if (url.includes("/shops/101")) body = SHOP_101;
  else if (url.includes("/shops/102")) body = SHOP_102;
  else if (url.includes("/listings/22/reviews")) body = REVIEWS_22;
  else if (url.includes("/reviews")) body = { count: 12, results: [{ rating: 4 }] };
  else status = 404;
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function statusFetch(status: number): (url: string) => Promise<Response> {
  return () => Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status }));
}

async function main() {
  const fetchFn = mockFetch as unknown as typeof fetch;

  // 1. Search: parsed, sorted by favorers desc, price decoded.
  const r = await searchEtsyListings("budget planner template", "KEY:SECRET", { fetchFn });
  check("3 listings parsed", r.listings.length === 3, `got ${r.listings.length}`);
  check("sorted by favorers desc", r.listings[0].listingId === 22 && r.listings[0].favorers === 2100, r.listings.map((l) => l.favorers).join(","));
  check("price decoded", r.listings[0].price === 8.99, String(r.listings[0].price));
  check("title entity decoded", r.listings[1].title.includes("& Tracker"), r.listings[1].title);
  check("no warnings on success", r.warnings.length === 0, r.warnings.join("; "));

  // 2. Enrichment: shop total sales + reviews attached.
  const top = r.listings[0];
  check("shop sales attached", top.shopSales === 3200, String(top.shopSales));
  check("review count attached", top.reviewCount === 340, String(top.reviewCount));
  check("review avg attached", top.reviewAvg === 5, String(top.reviewAvg));
  const third = r.listings[2];
  check("same shop shares sales", third.shopSales === 15400, String(third.shopSales));

  // 3. Evidence line format.
  const line = etsyEvidenceLine(top);
  check(
    "evidence line has favorites + reviews + shop sales",
    line.includes("2100 favorites") && line.includes("340 reviews") && line.includes("shop 3200 sales"),
    line
  );

  // 4. No key -> empty + skip warning (never throws).
  const noKey = await searchEtsyListings("budget planner template", undefined, { fetchFn });
  check("no key -> empty", noKey.listings.length === 0);
  check("no key warning recorded", noKey.warnings.some((w) => w.includes("etsy_skipped_no_key")));

  // 5. 401 -> auth warning, 429 -> rate warning, both empty.
  const auth = await searchEtsyListings("x", "BAD", { fetchFn: statusFetch(401) as unknown as typeof fetch });
  check("401 -> auth warning", auth.listings.length === 0 && auth.warnings.some((w) => w.includes("etsy_auth_failed")));
  const rate = await searchEtsyListings("x", "KEY:SECRET", { fetchFn: statusFetch(429) as unknown as typeof fetch });
  check("429 -> rate warning", rate.listings.length === 0 && rate.warnings.some((w) => w.includes("etsy_rate_limited")));

  // 6. Throwing fetch -> graceful empty.
  const boom = async (): Promise<Response> => {
    throw new Error("network down");
  };
  const err = await searchEtsyListings("x", "KEY:SECRET", { fetchFn: boom as unknown as typeof fetch });
  check("throwing fetch -> empty + warning", err.listings.length === 0 && err.warnings.length === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("SOME ETSY TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL ETSY TESTS PASSED");
}

main();
