/**
 * Product-scraper tests: pure parser fixtures + SSRF guard + price strip.
 * Run: npx tsx scripts/test-product-scrape.ts
 */
import {
  assertPublicUrl,
  extractProductFacts,
  scrapeProductPage,
  stripPriceMentions,
  type FetchFn,
} from "../src/lib/pipeline/product-scrape";
import { PipelineError } from "../src/lib/pipeline/types";

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

const FIXTURE = `<!doctype html><html><head>
<title>Super Juicer 500W - Best Deals Store</title>
<meta property="og:title" content="Super Juicer 500W">
<meta property="og:description" content="Fresh juice in minutes. Special price ₹4,999 only, 20% off today!">
<meta property="og:image" content="/images/juicer-main.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
"name":"Super Juicer 500W","description":"A powerful juicer for daily use.",
"image":["https://shop.example.com/img/a.jpg","https://shop.example.com/img/b.jpg"],
"brand":{"@type":"Brand","name":"JuiceCo"},
"offers":{"@type":"Offer","price":"4999","priceCurrency":"INR"}}</script>
</head><body>
<ul class="features"><li>500W copper motor</li><li>Easy to clean</li><li>2 jars included</li><li>1 year warranty</li></ul>
<img src="/images/c.jpg"><img src="data:image/gif;base64,xx"><img src="https://tracker.example.com/pixel.gif">
</body></html>`;

async function main() {
  // Parser: OG + JSON-LD + gallery + features.
  {
    const f = extractProductFacts(FIXTURE, "https://shop.example.com/products/juicer");
    check("title from JSON-LD", f.title === "Super Juicer 500W", f.title);
    check("brand from JSON-LD", f.brand === "JuiceCo", String(f.brand));
    check("images: og + ld + gallery, deduped, data/tracker dropped", f.images.length === 4, f.images.join(","));
    check("relative image resolved absolute", f.images.some((i) => i === "https://shop.example.com/images/juicer-main.jpg"));
    check("features from list", f.features.length === 4 && f.features[0] === "500W copper motor", f.features.join("|"));
    check("no price anywhere in output", !JSON.stringify(f).includes("4999") && !JSON.stringify(f).includes("₹"));
  }

  // Price stripping.
  check(
    "stripPriceMentions removes amounts",
    stripPriceMentions("Sirf ₹4,999 me, 20% off!") === "Sirf me, !",
    stripPriceMentions("Sirf ₹4,999 me, 20% off!")
  );

  // SSRF guard.
  for (const bad of ["http://localhost:3000/x", "https://10.0.0.5/admin", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "ftp://example.com/x"]) {
    let caught = false;
    try {
      assertPublicUrl(bad);
    } catch (e) {
      caught = e instanceof PipelineError;
    }
    check(`SSRF blocked: ${bad}`, caught);
  }
  check("public URL passes", assertPublicUrl("https://www.amazon.in/dp/B000").hostname === "www.amazon.in");

  // Fetch path with an injected fetch (no real network).
  {
    const fakeFetch: FetchFn = async () => ({
      ok: true,
      status: 200,
      text: async () => FIXTURE,
    });
    const f = await scrapeProductPage("https://shop.example.com/products/juicer", fakeFetch);
    check("scrapeProductPage via injected fetch", f.title === "Super Juicer 500W" && f.images.length === 4);
  }
  {
    const failingFetch: FetchFn = async () => ({ ok: false, status: 404, text: async () => "" });
    let caught = false;
    try {
      await scrapeProductPage("https://shop.example.com/nope", failingFetch);
    } catch (e) {
      caught = e instanceof PipelineError;
    }
    check("HTTP error -> PipelineError", caught);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL PRODUCT-SCRAPE TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
