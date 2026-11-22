/**
 * Beat-the-top loop tests — NO live network: every fetch is stubbed.
 * Env paths point at /tmp so the real ledger/registry/plan are untouched.
 */
process.env.BEAT_COMPETITORS_PATH = "/tmp/beat-test-competitors.json";
process.env.BEAT_PLAN_PATH = "/tmp/beat-test-plan.json";
process.env.MARKETING_GOALS_LEDGER_PATH = "/tmp/beat-test-ledger.json";
process.env.YOUTUBE_API_KEY = "test-yt-key";
process.env.ETSY_API_KEY = "test-etsy-key";

import { rm } from "fs/promises";
import {
  parseCount, parseBsr, parseFirstAsin, parseOgDescription, parseFollowers,
  parseSocialHandles, collectBeat, analyzeBeat, gapStatus, loadPlan,
  saveTargets, loadTargets,
  type Benchmark, type FetchFn,
} from "../src/lib/marketing/beat";
import { GoalStore } from "../src/lib/marketing/goal-loop";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

// --- pure parsers ---
check('parseCount "12.3K" -> 12300', parseCount("12.3K") === 12300);
check('parseCount "1.2M" -> 1200000', parseCount("1.2M") === 1200000);
check('parseCount "45,678" -> 45678', parseCount("45,678") === 45678);
check('parseCount "2.5B" -> 2500000000', parseCount("2.5B") === 2500000000);
check('parseCount "abc" -> null', parseCount("abc") === null);

const kdpHtml = `<html><head><title>Budget Planner Mastery : Amazon.com: Kindle Store</title></head><body><span>Best Sellers Rank: #1,234 in Kindle Store</span></body></html>`;
check("parseBsr finds #1,234", parseBsr(kdpHtml) === 1234);
check("parseBsr captcha page -> null", parseBsr("Enter the characters you see below") === null);
check("parseBsr no rank -> null", parseBsr("<html>no rank here</html>") === null);
check("parseFirstAsin finds B0 id", parseFirstAsin(`<a href="/dp/B0TEST1234/ref=sr_1_1">`) === "B0TEST1234");
check("parseFirstAsin none -> null", parseFirstAsin("<html>no links</html>") === null);

const igHtml = `<html><head><meta property="og:description" content="45.2K Followers, 10 Following, 300 Posts - See Instagram photos and videos from Planner Pro (@plannerpro)" /></head></html>`;
check("parseOgDescription reads meta", parseOgDescription(igHtml)?.startsWith("45.2K Followers") === true);
check("parseOgDescription login wall -> null", parseOgDescription("<html>Log in to continue</html>") === null);
check("parseFollowers 45.2K", parseFollowers("45.2K Followers, 10 Following, 300 Posts") === 45200);
check("parseFollowers prefers followers over likes", parseFollowers("1,234 likes · 2,345 followers") === 2345);
check("parseFollowers no match -> null", parseFollowers("Just a bio, no numbers") === null);

const desc = "My planner channel. Follow me on Instagram: instagram.com/plannerpro and X: x.com/plannerpro — also pinterest.com/plannerpro";
const handles = parseSocialHandles(desc);
check("parseSocialHandles instagram", handles.instagram === "plannerpro");
check("parseSocialHandles x", handles.x === "plannerpro");
check("parseSocialHandles pinterest", handles.pinterest === "plannerpro");
check("parseSocialHandles no facebook", handles.facebook === undefined);

// --- gap math ---
check("gapStatus beating", gapStatus(1.2, 100) === "beating");
check("gapStatus closing", gapStatus(0.8, 100) === "closing");
check("gapStatus behind", gapStatus(0.5, 100) === "behind");
check("gapStatus unknown when ours missing", gapStatus(0, null) === "unknown");

// --- stub fetch for the whole collect pass ---
const stub = async (url: string) => {
  const text = async () => {
    if (url.includes("amazon.com/s?")) return `<html><a href="/dp/B0TEST1234/ref=sr_1_1">Budget Planner</a></html>`;
    if (url.includes("amazon.com/dp/B0TEST1234")) return kdpHtml;
    if (url.includes("amazon.com/dp/B0REG12345")) return `<html><head><title>Registry Pick : Amazon.com: Kindle Store</title></head><body>Best Sellers Rank: #567 in Kindle Store</body></html>`;
    if (url.includes("instagram.com/plannerpro/")) return igHtml;
    if (url.includes("instagram.com/registryig/")) return `<html><head><meta property="og:description" content="8.1K Followers, 5 Following, 120 Posts" /></head></html>`;
    if (url.includes("x.com/plannerpro/")) return `<html><head><title>Log in to X</title></head><body>Log in to continue</body></html>`;
    return "<html></html>";
  };
  const json = async (): Promise<unknown> => {
    if (url.includes("youtube/v3/search")) {
      return { items: [{ id: { videoId: "VID1" }, snippet: { title: "Best Budget Planner 2026", channelTitle: "PlannerPro", channelId: "C1" } }] };
    }
    if (url.includes("youtube/v3/videos")) return { items: [{ statistics: { viewCount: "250000" } }] };
    if (url.includes("youtube/v3/channels")) {
      return { items: [{ statistics: { subscriberCount: "120000" }, snippet: { description: desc } }] };
    }
    if (url.includes("listings/active")) {
      return { results: [{ listing_id: 11, title: "Budget Planner Printable", url: "https://www.etsy.com/listing/11", price: { amount: 1500, divisor: 100, currency_code: "USD" }, num_favorers: 8500, tags: ["planner"], shop_id: 1 }] };
    }
    if (url.includes("/shops/1")) return { transaction_sold_count: 42000 };
    if (url.includes("/reviews")) return { count: 1200, results: [{ rating: 5 }] };
    if (url.includes("reddit.com/r/budgetplanner/top.json")) {
      return { data: { children: [{ data: { title: "My budget planner setup", score: 3400, num_comments: 210, permalink: "/r/budgetplanner/comments/abc" } }] } };
    }
    return {};
  };
  return { ok: true, status: 200, json, text };
};

const stubTextGen = async () =>
  `[{"whatsMissing": ["Print-ready A4 + US Letter dono sizes", "Hinglish instructions missing"], "uniquenessInStyle": ["Festival-theme budget pages", "UPI expense tracker inside"]}]`;

async function main() {
await rm("/tmp/beat-test-competitors.json", { force: true });
await rm("/tmp/beat-test-plan.json", { force: true });
await rm("/tmp/beat-test-ledger.json", { force: true });

// Seed the ledger with OUR numbers (the gap is measured against these).
const store = await GoalStore.load();
store.recordRun({ productKey: "template", channel: "youtube", metrics: { topVideoViews: 50000 }, primaryMetric: "topVideoViews" });
store.recordRun({ productKey: "ebook", channel: "kdp", metrics: { bestSellersRank: 2000 }, primaryMetric: "bestSellersRank" });
store.recordRun({ productKey: "template", channel: "reddit", metrics: { topPostUpvotes: 5000 }, primaryMetric: "topPostUpvotes" });
await store.save();

// Seed the registry: a hand-picked IG handle + a KDP ASIN (registry wins).
await saveTargets([
  { field: "template", platform: "instagram", niche: "budget planner", handle: "registryig", displayName: "Registry IG", source: "registry" },
  { field: "ebook", platform: "kdp", niche: "budget planner", asin: "B0REG12345", displayName: "Registry Pick", source: "registry" },
]);
check("registry round-trips", (await loadTargets()).length === 2);

const collected = await collectBeat(
  [
    { field: "template", niches: ["budget planner"] },
    { field: "ebook", niches: ["budget planner"] },
  ],
  { fetchFn: stub as unknown as FetchFn, store }
);
const byKey = (field: string, platform: string, metric: string) =>
  collected.benchmarks.find((b) => b.field === field && b.platform === platform && b.metric === metric);

check("collect: youtube benchmark 250000", byKey("template", "youtube", "topVideoViews")?.value === 250000);
check("collect: youtube ourValue from ledger 50000", byKey("template", "youtube", "topVideoViews")?.ourValue === 50000);
check("collect: etsy benchmark 8500 favorites", byKey("template", "etsy", "topFavorers")?.value === 8500);
check("collect: reddit benchmark 3400 upvotes", byKey("template", "reddit", "topPostUpvotes")?.value === 3400);
check("collect: reddit ourValue 5000 (we beat #1)", byKey("template", "reddit", "topPostUpvotes")?.ourValue === 5000);
check("collect: kdp auto BSR 1234", byKey("template", "kdp", "bestSellersRank")?.value === 1234);
check("collect: kdp registry ASIN BSR 567 wins", byKey("ebook", "kdp", "bestSellersRank")?.value === 567);
check("collect: kdp benchmark is lower-is-better", byKey("template", "kdp", "bestSellersRank")?.lowerIsBetter === true);
check("collect: instagram uses REGISTRY handle (8100)", byKey("template", "instagram", "followers")?.value === 8100);
check("collect: instagram target source is registry",
  collected.targets.find((t) => t.field === "template" && t.platform === "instagram")?.source === "registry");
check("collect: x has NO benchmark (login wall)", byKey("template", "x", "followers") === undefined);
check("collect: x login-wall warning present",
  collected.warnings.some((w) => w.includes("/x/") && w.includes("login wall")));
check("collect: pinterest skipped (no handle anywhere)", byKey("template", "pinterest", "followers") === undefined);

// --- analyze ---
const plan = await analyzeBeat(collected.benchmarks, store, { textGen: stubTextGen });
const gap = (field: string, platform: string) => plan.gaps.find((g) => g.field === field && g.platform === platform);

check("analyze: youtube gap behind 80%", gap("template", "youtube")?.status === "behind" && gap("template", "youtube")?.gapPct === 80);
check("analyze: reddit gap beating (ours 5000 > their 3400)", gap("template", "reddit")?.status === "beating");
check("analyze: kdp gap behind (BSR 2000 vs 567, inverted)", gap("ebook", "kdp")?.status === "behind");
check("analyze: instagram gap unknown (no ours yet)", gap("template", "instagram")?.status === "unknown");
check("analyze: actions from style angles (max 3)", (gap("template", "youtube")?.actions.length ?? 0) >= 2);
check("analyze: beating count is 1", plan.beating === 1);

// North star: #1's metric written to the goal ledger.
const reloaded = await GoalStore.load();
check("analyze: northStar youtube = #1 views 250000",
  reloaded.get("template", "youtube")?.northStar.topVideoViews === 250000);
check("analyze: northStar kdp = #1 BSR 1234",
  reloaded.get("template", "kdp")?.northStar.bestSellersRank === 1234);
check("analyze: setNorthStar stub goal has no history",
  (reloaded.get("template", "kdp")?.history.length ?? -1) === 0);

// Plan file round-trip.
const saved = await loadPlan();
check("analyze: plan file round-trips", saved?.generatedAt === plan.generatedAt && (saved?.gaps.length ?? 0) === plan.gaps.length);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL BEAT-THE-TOP TESTS PASSED");
}

main();
