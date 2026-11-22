/**
 * test-etsy-youtube: Etsy optimizer + YouTube SEO (mocked textGen).
 * Run: npx tsx scripts/test-etsy-youtube.ts
 */
import { optimizeEtsyListing } from "../src/lib/marketplace/etsy-optimizer";
import { buildYoutubeSeo } from "../src/lib/publishing/youtube-seo";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const ETSY_MOCK = JSON.stringify({
  title: "Meal Prep Planner Printable PDF | Weekly Budget Meal Planner | Instant Download",
  tags: ["meal prep planner", "printable planner", "budget meals", "weekly planner", "grocery list", "meal plan pdf", "kitchen organizer", "family meals", "healthy eating", "food planner", "meal prep", "printable pdf", "best seller #1"],
  description: "Plan your week in 15 minutes.\nFeatures: 12 pages.\nWhat's included: PDF.",
  bundleSuggestion: "Bundle: planner + grocery lists pack",
});

const YT_MOCK = JSON.stringify({
  title: "Meal Prep Kaise Karein | 15 Minute Me Poore Hafte Ka Khana",
  description: "Is video me seekho...\n00:00 Intro\n05:00 Main\nFree guide link in pinned comment.",
  tags: ["meal prep", "meal prep hindi", "budget cooking", "#1 channel"],
});

async function main() {
  const e = await optimizeEtsyListing(
    { title: "planner", niche: "meal prep", features: ["12 pages"] },
    async () => ETSY_MOCK
  );
  check("etsy title kept + front-loaded", !!e.title && e.title.length <= 140);
  check("bad tag dropped", e.tags.length === 12 && !e.tags.join().includes("#1"), `got ${e.tags.length}`);
  check("bundle suggestion kept", e.bundleSuggestion === "Bundle: planner + grocery lists pack");
  check("etsy warnings", e.warnings.length === 1);

  try {
    await optimizeEtsyListing({ title: "x", niche: "y" }, async () => "garbage");
    check("etsy garbage hard-errors", false);
  } catch (err) {
    check("etsy garbage hard-errors", err instanceof DigitalError && err.code === "generation_failed");
  }

  const y = await buildYoutubeSeo(
    { topic: "meal prep", keywords: ["meal prep hindi"] },
    async () => YT_MOCK
  );
  check("yt title kept", !!y.title && y.title.length <= 100);
  check("yt bad tag dropped", y.tags.length === 3 && !y.tags.join().includes("#1"));
  check("yt tag char limit", y.tags.join(",").length <= 500);
  check("yt chapters in description", !!y.description && y.description.includes("00:00"));

  try {
    await buildYoutubeSeo({ topic: "x" }, async () => YT_MOCK);
    check("yt short topic rejected", false);
  } catch (err) {
    check("yt short topic rejected", err instanceof DigitalError && err.code === "validation_error");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
