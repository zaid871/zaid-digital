/**
 * Ad-hoc verification for the analytics + weekly reporting modules (§16, §17).
 * Uses MOCK metric data (clearly labeled) — no platform APIs, no invented numbers.
 *
 * Run: npx tsx scripts/test-analytics.ts
 */
import {
  buildWeeklyReport,
  collectMetrics,
  engagementRate,
  type MetricsProvider,
  type PublishMetrics,
} from "../src/lib/analytics";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---- MOCK metrics (fictional numbers for testing only) ----
const mockMetrics: PublishMetrics[] = [
  {
    publishRecordId: "mock-r1", platform: "instagram_reels",
    productName: "Mock Kettle", category: "Kitchen", hook: "Stop wasting mornings",
    views: 1000, reach: 900, engagement: 100, likes: 80, comments: 20,
    linkClicks: 12, conversions: 1, revenueUsd: 2.5, collectedAt: "2026-10-19T10:00:00Z",
  },
  {
    publishRecordId: "mock-r2", platform: "instagram_reels",
    productName: "Mock Lamp", category: "Kitchen", hook: "Everyone needs this",
    views: 2000, reach: 1800, engagement: 60, likes: 50, comments: 10,
    linkClicks: 5, conversions: 0, revenueUsd: 0, collectedAt: "2026-10-19T10:00:00Z",
  },
  {
    publishRecordId: "mock-r3", platform: "facebook_reels",
    productName: "Mock Mat", category: "Electronics", hook: "Watch this",
    views: 500, reach: 450, engagement: 0, likes: 0, comments: 0,
    linkClicks: 0, collectedAt: "2026-10-19T10:00:00Z",
  },
  {
    publishRecordId: "mock-r4", platform: "instagram_reels",
    productName: "Mock Gadget", category: "Electronics", hook: "New gadget alert",
    views: null, engagement: null, collectedAt: "2026-10-19T10:00:00Z",
  },
  {
    publishRecordId: "mock-r5", platform: "instagram_reels",
    productName: "Mock Zero", category: "Kitchen", hook: "Zero views hook",
    views: 0, engagement: 5, collectedAt: "2026-10-19T10:00:00Z",
  },
];

const causalWords = /(proves|proven|guarantees?|will increase|causes? more)/i;

async function main() {
  // ---- engagementRate ----
  check("rate 100/1000 = 0.1", engagementRate(mockMetrics[0]) === 0.1);
  check("rate null when views null", engagementRate(mockMetrics[3]) === null);
  check("rate null when views are zero (no div-by-zero)", engagementRate(mockMetrics[4]) === null);

  // ---- weekly report ----
  const report = buildWeeklyReport(mockMetrics, "2026-W42");

  check("totals: 5 posts", report.totals.posts === 5);
  check("totals: 3500 views", report.totals.totalViews === 3500, `got ${report.totals.totalViews}`);
  check("totals: 4 records with view data", report.totals.recordsWithViews === 4);
  check("totals: 165 engagement", report.totals.totalEngagement === 165);
  check("totals: 2.5 revenue", report.totals.totalRevenueUsd === 2.5);

  check("top hook #1 is the 10% hook", report.topHooks[0]?.detail.includes("Stop wasting mornings") === true);
  check("top hook shows 10.0%", report.topHooks[0]?.title.includes("10.0%") === true);
  check("all top-hook insights labeled observed", report.topHooks.every((i) => i.strength === "observed"));
  check(
    "no causal wording in top hooks",
    report.topHooks.every((i) => !causalWords.test(i.title) && !causalWords.test(i.detail))
  );

  const kitchen = report.categoryPerformance.find((c) => c.category === "Kitchen");
  const electronics = report.categoryPerformance.find((c) => c.category === "Electronics");
  check("kitchen: 3 posts, 3000 views", kitchen?.posts === 3 && kitchen?.totalViews === 3000);
  check("electronics: 2 posts", electronics?.posts === 2);
  check("categories labeled observed", report.categoryPerformance.every((c) => c.strength === "observed"));

  check(
    "weak pattern: zero-engagement post flagged",
    report.weakPatterns.some((w) => w.title.includes("zero recorded engagement"))
  );
  check(
    "weak pattern: missing-data post flagged, not treated as failure",
    report.weakPatterns.some((w) => w.detail.includes("not a performance signal"))
  );
  check("weak patterns labeled observed", report.weakPatterns.every((w) => w.strength === "observed"));

  check("disclaimer present", report.disclaimer.length > 0);
  check("disclaimer: observed not proven", report.disclaimer.includes("not proven causal results"));
  check("disclaimer: views are not sales", report.disclaimer.includes("views are not sales"));

  // ---- experiments: hypotheses only ----
  check("experiments suggested", report.experiments.length > 0);
  check(
    "all experiments labeled hypothesis",
    report.experiments.every((e) => e.strength === "hypothesis")
  );
  check(
    "experiment wording is hypothetical",
    report.experiments.every(
      (e) => /may be|proposal to test/i.test(e.hypothesis) && !causalWords.test(e.hypothesis)
    )
  );
  check(
    "experiment note says proposal not finding",
    report.experiments.every((e) => e.note.includes("Proposal to test"))
  );

  // ---- collectMetrics: actual data only, never invented ----
  const goodProvider: MetricsProvider = {
    name: "mock-good",
    collect: async (record) => ({
      publishRecordId: record.publishRecordId,
      platform: record.platform,
      views: 42,
      collectedAt: new Date().toISOString(),
    }),
  };
  const nullProvider: MetricsProvider = {
    name: "mock-empty",
    collect: async () => null,
  };
  const badProvider: MetricsProvider = {
    name: "mock-bad",
    collect: async () => {
      throw new Error("mock API down");
    },
  };
  const negativeProvider: MetricsProvider = {
    name: "mock-negative",
    collect: async (record) => ({
      publishRecordId: record.publishRecordId,
      platform: record.platform,
      views: -10, // physically impossible → sanitized to null
      collectedAt: new Date().toISOString(),
    }),
  };

  const collected = await collectMetrics(
    [{ publishRecordId: "r1", platform: "instagram_reels" }],
    [goodProvider, nullProvider, badProvider, negativeProvider]
  );
  check("null provider invents nothing (no metric added)", collected.metrics.filter((m) => m.views === 42).length === 1);
  check("provider error recorded, not thrown", collected.errors.length === 1 && collected.errors[0]?.provider === "mock-bad");
  const neg = collected.metrics.find((m) => m.views === null);
  check("negative views sanitized to null", neg !== undefined);
  check(
    "exactly 2 metrics recorded (good + sanitized), nothing invented",
    collected.metrics.length === 2,
    `got ${collected.metrics.length}`
  );

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
