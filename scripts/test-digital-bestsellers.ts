/**
 * Bestseller Style Analyzer tests: deterministic style extraction,
 * YouTube Data API (mocked fetch), no-key skip, manual competitors,
 * AI whats-missing/uniqueness + bank fallback, compliance drops.
 * Run: npx tsx scripts/test-digital-bestsellers.ts
 */
import {
  analyzeBestsellers,
  collectGaps,
  extractLekinLine,
  extractStyle,
  fetchTopVideos,
} from "../src/lib/digital/bestsellers";
import type { TextGen } from "../src/lib/digital/ebook";

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
  items: [
    { id: { videoId: "v1" }, snippet: { title: "Minimal Budget Planner Template | Printable Bundle", channelTitle: "PlanWithMe" } },
    { id: { videoId: "v2" }, snippet: { title: "Aesthetic Budget Planner 2026 — Canva Editable", channelTitle: "DesignDaily" } },
    { id: { videoId: "v3" }, snippet: { title: "How to make a budget planner for beginners", channelTitle: "MoneyTips" } },
  ],
};
const VIDEOS_FIXTURE = {
  items: [
    { id: "v1", statistics: { viewCount: "1200000" } },
    { id: "v2", statistics: { viewCount: "850000" } },
    { id: "v3", statistics: { viewCount: "40000" } },
  ],
};

const ETSY_SEARCH = {
  count: 2,
  results: [
    { listing_id: 22, title: "Aesthetic Budget Planner Bundle", url: "https://www.etsy.com/listing/22/y", price: { amount: 899, divisor: 100, currency_code: "USD" }, num_favorers: 2100, tags: ["bundle"], shop_id: 102 },
    { listing_id: 11, title: "Minimal Budget Planner", url: "https://www.etsy.com/listing/11/x", price: { amount: 1200, divisor: 100, currency_code: "USD" }, num_favorers: 450, tags: ["planner"], shop_id: 101 },
  ],
};
const ETSY_SHOP_102 = { shop_id: 102, transaction_sold_count: 3200 };
const ETSY_SHOP_101 = { shop_id: 101, transaction_sold_count: 15400 };
const ETSY_REVIEWS = { count: 340, results: [{ rating: 5 }] };

function mockFetch(url: string): Promise<Response> {
  let body: unknown = {};
  if (url.includes("/youtube/v3/search")) body = SEARCH_FIXTURE;
  else if (url.includes("/youtube/v3/videos")) body = VIDEOS_FIXTURE;
  else if (url.includes("openapi.etsy.com/v3/application/listings/active")) body = ETSY_SEARCH;
  else if (url.includes("openapi.etsy.com/v3/application/shops/102")) body = ETSY_SHOP_102;
  else if (url.includes("openapi.etsy.com/v3/application/shops/101")) body = ETSY_SHOP_101;
  else if (url.includes("openapi.etsy.com/v3/application/listings/") && url.includes("/reviews")) body = ETSY_REVIEWS;
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

async function main() {
  const fetchFn = mockFetch as unknown as typeof fetch;

  // 1. Deterministic style extraction.
  const s = extractStyle(["Minimal Budget Planner Template | Printable Bundle", "Aesthetic Canva editable for students"]);
  check("formats extracted", s.formats.includes("printable") && s.formats.includes("bundle") && s.formats.includes("canva"), s.formats.join(","));
  check("styles extracted", s.styles.includes("minimal") && s.styles.includes("aesthetic"), s.styles.join(","));
  check("audience extracted", s.audience.includes("students"), s.audience.join(","));

  // 2. YouTube top videos: parsed + sorted by views desc.
  const vids = await fetchTopVideos("budget planner template", "FAKE_KEY", fetchFn);
  check("3 videos parsed", vids.length === 3, `got ${vids.length}`);
  check("sorted by views desc", vids[0].views === 1200000 && vids[2].views === 40000, vids.map((v) => v.views).join(","));
  check("title kept", vids[0].title.includes("Minimal Budget Planner"));

  // 3. No key -> [] (never throws).
  const noKey = await fetchTopVideos("budget planner template", undefined, fetchFn);
  check("no key -> empty", noKey.length === 0);

  // 4. Full analysis with mocked YouTube + manual competitor + AI stub.
  const aiGen: TextGen = async () =>
    JSON.stringify([
      {
        whatsMissing: ["No Hinglish budget planner", "No printable + Excel bundle"],
        uniquenessInStyle: ["Hinglish minimal planner", "Printable + Excel bundle, same minimal look"],
      },
    ]);
  const r = await analyzeBestsellers(
    [{ niche: "budgeting", evidence: ["How do I make a monthly budget that actually works?"] }],
    {
      competitors: [{ title: "Ultimate Budget Planner Bundle — 50 pages", source: "Etsy", note: "10k sold" }],
      includeYouTube: true,
      useAi: true,
    },
    { textGen: aiGen, fetchFn }
  );
  // NOTE: no YOUTUBE_API_KEY in sandbox env -> videos skipped, warning recorded.
  const n = r.niches[0];
  check("one niche analyzed", r.niches.length === 1);
  check("style profile built", n.styleProfile.includes("printable") || n.styleProfile.includes("bundle"), n.styleProfile);
  check("manual competitor in evidence", n.bestsellerEvidence.some((e) => e.includes("Ultimate Budget Planner Bundle")), n.bestsellerEvidence.join(" | "));
  check("AI whats-missing used", n.whatsMissing.some((w) => w.includes("Hinglish")), n.whatsMissing.join(" | "));
  check("AI uniqueness-in-style used", n.uniquenessInStyle.some((u) => u.includes("Hinglish minimal")), n.uniquenessInStyle.join(" | "));
  check("youtube no-key warning recorded", r.warnings.some((w) => w.includes("youtube_skipped_no_key")));

  // 5. With a key in env, videos flow through (stubbed fetch).
  process.env.YOUTUBE_API_KEY = "FAKE_KEY";
  const r2 = await analyzeBestsellers(
    [{ niche: "budgeting", evidence: ["How do I make a monthly budget?"] }],
    { includeYouTube: true, useAi: false },
    { fetchFn }
  );
  check("videos in evidence with key", r2.niches[0].bestsellerEvidence.some((e) => e.startsWith("YT: Minimal")), r2.niches[0].bestsellerEvidence.join(" | "));
  check("bank fallback when useAi false", r2.niches[0].whatsMissing.length === 2 && r2.niches[0].uniquenessInStyle.length === 2);
  delete process.env.YOUTUBE_API_KEY;

  // 6. Bank fallback when the LLM throws + compliance drop.
  const throwingGen: TextGen = async () => {
    throw new Error("no keys");
  };
  const r3 = await analyzeBestsellers(
    [{ niche: "budgeting", evidence: ["How do I budget?"] }],
    { includeYouTube: false, useAi: true },
    { textGen: throwingGen }
  );
  check("bank whats-missing on AI fail", r3.niches[0].whatsMissing.length === 2);
  check("bank uniqueness on AI fail", r3.niches[0].uniquenessInStyle.length === 2);
  check("ai fallback warning recorded", r3.warnings.some((w) => w.includes("ai_style_fallback")));

  const badGen: TextGen = async () =>
    JSON.stringify([{ whatsMissing: ["Only $5 today", "Clean gap here"], uniquenessInStyle: ["Clean angle", "Another clean angle"] }]);
  const r4 = await analyzeBestsellers(
    [{ niche: "budgeting", evidence: ["How do I budget?"] }],
    { includeYouTube: false, useAi: true },
    { textGen: badGen }
  );
  check("price gap dropped", !r4.niches[0].whatsMissing.join(" ").includes("$5"), r4.niches[0].whatsMissing.join(" | "));
  check("whats-missing still 2 after drop", r4.niches[0].whatsMissing.length === 2);

  // 7. Etsy lane: with key + stubbed Etsy API, evidence has Etsy lines.
  process.env.ETSY_API_KEY = "KEY:SECRET";
  const r5 = await analyzeBestsellers(
    [{ niche: "budgeting", evidence: ["How do I budget?"] }],
    { includeYouTube: false, includeEtsy: true, useAi: false },
    { fetchFn }
  );
  check(
    "etsy evidence in bestseller evidence",
    r5.niches[0].bestsellerEvidence.some((e) => e.startsWith("Etsy: Aesthetic Budget Planner Bundle")),
    r5.niches[0].bestsellerEvidence.join(" | ")
  );
  check("etsy favorites in evidence", r5.niches[0].bestsellerEvidence.some((e) => e.includes("2100 favorites")));
  check("etsy shop sales in evidence", r5.niches[0].bestsellerEvidence.some((e) => e.includes("shop 3200 sales")));
  check("no etsy skip warning with key", !r5.warnings.some((w) => w.includes("etsy_skipped_no_key")));
  delete process.env.ETSY_API_KEY;

    // --- Lekin Line (Utkarsh Gose) ---

  // English "but".
  {
    const r = extractLekinLine("Good product but too long", 4);
    check("but: gap is 'too long'", r !== null && r.gap === "too long", JSON.stringify(r));
    check("but: marker recorded", r !== null && r.marker === "but");
  }

  // Hindi Roman "lekin" — exact words kept.
  {
    const r = extractLekinLine("achha hai lekin examples Indian nahi hain", 3);
    check("lekin: gap keeps exact words", r !== null && r.gap === "examples Indian nahi hain", JSON.stringify(r));
    check("lekin: marker recorded", r !== null && r.marker === "lekin");
  }

  // Hindi Roman "magar".
  {
    const r = extractLekinLine("quality achhi hai magar beginners ke liye nahi", 3);
    check("magar: gap extracted", r !== null && r.gap === "beginners ke liye nahi", JSON.stringify(r));
  }

  // Hindi Roman "par".
  {
    const r = extractLekinLine("achha hai par thoda mehenga hai", 3);
    check("par: gap extracted", r !== null && r.gap === "thoda mehenga hai", JSON.stringify(r));
  }

  // English "however".
  {
    const r = extractLekinLine("Well written, however the examples are all American", 3);
    check("however: gap extracted", r !== null && r.gap === "the examples are all American", JSON.stringify(r));
  }

  // Sentence-initial "although" + comma → main clause after the comma.
  {
    const r = extractLekinLine("Although useful, it is too detailed", 3);
    check("although: gap is the main clause", r !== null && r.gap === "it is too detailed", JSON.stringify(r));
  }

  // "though" at the end with nothing after → null.
  {
    const r = extractLekinLine("Good, though", 4);
    check("trailing though: null", r === null, JSON.stringify(r));
  }

  // No marker → null (5-star "very good, nice" is useless, as the video says).
  {
    check("no marker: null", extractLekinLine("Very good, nice product", 5) === null);
    check("empty text: null", extractLekinLine("   ", 3) === null);
  }

  // "but" inside another word does not match ("button", "contribute").
  {
    check("but inside a word: null", extractLekinLine("The button is nice", 4) === null);
    check("par inside a word: null", extractLekinLine("This is part of the pack", 4) === null);
  }

  // Devanagari markers.
  {
    const r = extractLekinLine("अच्छा है लेकिन उदाहरण भारतीय नहीं हैं", 3);
    check("Devanagari lekin: gap extracted", r !== null && r.gap === "उदाहरण भारतीय नहीं हैं", JSON.stringify(r));
  }

  // collectGaps: 3-star first, then 5-star, then 1-star (same priority class keeps order).
  {
    const gaps = collectGaps([
      { text: "Great but expensive", stars: 5 },
      { text: "Good but too long", stars: 3 },
      { text: "Bad but confusing", stars: 1 },
    ]);
    check(
      "collectGaps: 3-star first",
      gaps.length === 3 && gaps[0].gap === "too long" && gaps[0].stars === 3,
      JSON.stringify(gaps.map((g) => g.gap))
    );
    check("collectGaps: 5-star before 1-star (same class, input order)", gaps[1].gap === "expensive" && gaps[2].gap === "confusing");
  }

  // collectGaps: dedup — same gap twice counts once.
  {
    const gaps = collectGaps([
      { text: "Good but too long", stars: 3 },
      { text: "Nice but too long", stars: 3 },
      { text: "Okay but boring", stars: 3 },
    ]);
    check("collectGaps: dedup keeps 2 unique gaps", gaps.length === 2, JSON.stringify(gaps.map((g) => g.gap)));
  }

  // collectGaps: limit 5 by default.
  {
    const reviews = Array.from({ length: 7 }, (_, i) => ({ text: `Good but gap number ${i + 1}`, stars: 3 }));
    const gaps = collectGaps(reviews);
    check("collectGaps: default limit 5", gaps.length === 5, String(gaps.length));
    const gaps3 = collectGaps(reviews, 3);
    check("collectGaps: explicit limit 3", gaps3.length === 3, String(gaps3.length));
  }

  // collectGaps: no gaps at all → empty, never invented.
  {
    check("collectGaps: no markers → empty", collectGaps([{ text: "Very good, nice", stars: 5 }]).length === 0);
  }

  // collectGaps: review text is carried through for the human reader.
  {
    const gaps = collectGaps([{ text: "Good but too long", stars: 3 }]);
    check("collectGaps: review carried through", gaps[0].review === "Good but too long");
  }

  

console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("SOME BESTSELLERS TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL BESTSELLERS TESTS PASSED");
}

main();
