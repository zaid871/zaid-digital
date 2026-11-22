/**
 * test-problem-miner: Problem Miner v1 with mocked fetch.
 * Reddit/suggest responses are fixtures; trends bridge is stubbed via
 * monkey-patched trendDirection (real bridge tested separately — it
 * degrades to "unknown" on 429, verified live).
 * Run: npx tsx scripts/test-problem-miner.ts
 */
import {
  scanReddit, expandSuggest, scoreProblems, mineProblems,
  scanYouTubeSuggest, risingQueries,
} from "../src/lib/discovery/problem-miner";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const REDDIT_FIXTURE = {
  data: {
    children: [
      { data: { title: "I'm struggling with meal prep on a budget", selftext: "How do I plan?", score: 120, num_comments: 45, permalink: "/r/x/1", created_utc: Date.now() / 1000 - 86400 } },
      { data: { title: "My cat is cute", selftext: "look at him", score: 5000, num_comments: 900, permalink: "/r/x/2", created_utc: Date.now() / 1000 - 86400 } },
      { data: { title: "Wish there was a simple budget planner", selftext: "", score: 30, num_comments: 5, permalink: "/r/x/3", created_utc: Date.now() / 1000 - 40 * 86400 } },
    ],
  },
};

const GOOGLE_FIXTURE = ["how to meal prep", ["how to meal prep for the week", "how to meal prep chicken", "meal prep ideas", "is anyone else sick of meal prep cleanup"]];
const YOUTUBE_FIXTURE = ["how to meal prep", ["how to meal prep for beginners", "meal prep video ideas"]];
const AMAZON_FIXTURE = { suggestions: [{ value: "meal prep containers" }, { value: "how do i store meal prep" }] };

function mockFetch(url: string): Promise<Response> {
  let body: unknown;
  if (url.includes("reddit.com")) body = REDDIT_FIXTURE;
  else if (url.includes("ds=yt")) body = YOUTUBE_FIXTURE;
  else if (url.includes("suggestqueries.google.com")) body = GOOGLE_FIXTURE;
  else if (url.includes("completion.amazon.com")) body = AMAZON_FIXTURE;
  else body = {};
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

async function main() {
  const fetchFn = mockFetch as unknown as typeof fetch;

  // scanReddit: pain posts kept, cat post dropped
  const reddit = await scanReddit("meal prep", ["mealprep"], fetchFn);
  check("reddit keeps pain posts", reddit.length === 2, `got ${reddit.length}`);
  check("reddit evidence url", reddit[0].evidence.startsWith("https://www.reddit.com/r/"));
  check("reddit engagement captured", reddit[0].engagement === 120 && reddit[0].comments === 45);

  // expandSuggest: only pain-signal suggestions kept
  const suggest = await expandSuggest("meal prep", fetchFn);
  const texts = suggest.map((s) => s.text);
  check("suggest keeps pain queries", texts.includes("is anyone else sick of meal prep cleanup"));
  check("suggest drops clean queries", !texts.includes("meal prep ideas"));
  check("amazon suggest parsed", texts.includes("how do i store meal prep"));
  check("sources labeled", suggest.every((s) => s.source === "google-suggest" || s.source === "amazon-suggest"));

  // scanYouTubeSuggest: same keyless service, client=youtube — pain only
  const yt = await scanYouTubeSuggest("meal prep", fetchFn);
  const ytTexts = yt.map((h) => h.text);
  check("youtube keeps pain queries", ytTexts.includes("how to meal prep for beginners"));
  check("youtube drops clean queries", !ytTexts.includes("meal prep video ideas"));
  check("youtube source labeled", yt.every((h) => h.source === "youtube-suggest"));

  // risingQueries: empty topics -> {} (never throws)
  const rq = await risingQueries([]);
  check("risingQueries empty topics -> {}", Object.keys(rq).length === 0);

  // scoreProblems: deterministic, sorted, deduped
  const cards = scoreProblems(
    [...reddit, ...suggest].map((h) => ({ ...h, engagement: h.engagement ?? 0, comments: h.comments ?? 0 })),
    { "meal prep": "rising" }
  );
  check("cards scored 0-100", cards.every((c) => c.score >= 0 && c.score <= 100));
  check("sorted desc", cards.every((c, i) => i === 0 || cards[i - 1].score >= c.score));
  check("signals recorded", cards[0].signals.length > 0);
  check("trend applied", cards.every((c) => c.trend === "rising"));
  // dedupe
  const dupes = scoreProblems([
    { text: "How do I meal prep?", niche: "x", source: "reddit" as const, evidence: "u1", engagement: 1, comments: 1 },
    { text: "how do i meal prep!", niche: "x", source: "reddit" as const, evidence: "u2", engagement: 1, comments: 1 },
  ]);
  check("dedupe works", dupes.length === 1);

  // mineProblems end-to-end (trends will be "unknown" in sandbox — fine)
  const mined = await mineProblems({ niches: ["meal prep"], subreddits: ["mealprep"], maxPerNiche: 10 }, fetchFn);
  check("mine returns problems", mined.problems.length > 0 && mined.problems.length <= 10);
  check("mine has scannedAt", typeof mined.scannedAt === "string");
  check("mine returns risingQueries key", typeof mined.risingQueries === "object");
  // Itch seed scores fill the top-10 by default; with itch off, the
  // YouTube hit must surface (wiring check, not a scoring claim).
  const minedNoItch = await mineProblems(
    { niches: ["meal prep"], subreddits: ["mealprep"], maxPerNiche: 10, includeFixMyItch: false },
    fetchFn
  );
  check("mine includes youtube hits (itch off)", minedNoItch.problems.some((p) => p.source === "youtube-suggest"));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
