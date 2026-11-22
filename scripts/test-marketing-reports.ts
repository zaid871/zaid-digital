/**
 * Weekly report tests: totals/by-channel/top-posts from real records +
 * insights, goal gaps, brain calibration, and honest notes.
 * Run: npx tsx scripts/test-marketing-reports.ts
 */
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { buildWeeklyReport, weekStart } from "../src/lib/marketing/reports";
import { GoalStore } from "../src/lib/marketing/goal-loop";
import type { BrainPlan } from "../src/lib/marketing/brain";
import type { FetchFn, PublishRecordRow } from "../src/lib/publishing/analytics";

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

const OUT = "/tmp/reports-test";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
process.env.MARKETING_GOALS_LEDGER_PATH = join(OUT, "ledger.json");

function igBody(views: number, likes: number, comments: number) {
  return {
    data: [
      { name: "views", values: [{ value: views }] },
      { name: "reach", values: [{ value: views }] },
      { name: "likes", values: [{ value: likes }] },
      { name: "comments", values: [{ value: comments }] },
      { name: "shares", values: [{ value: 0 }] },
      { name: "saved", values: [{ value: 0 }] },
    ],
  };
}
const stubFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes("media-a")) return new Response(JSON.stringify(igBody(500, 40, 5)), { status: 200 });
  if (u.includes("media-b")) return new Response(JSON.stringify(igBody(100, 5, 1)), { status: 200 });
  return new Response("nope", { status: 500 });
}) as unknown as FetchFn;

function rec(over: Partial<PublishRecordRow> = {}): PublishRecordRow {
  return {
    platform: "instagram_reels",
    platformMediaId: "media-a",
    jobId: "job-a",
    caption: "Wedding invitation templates\n\nDetails: https://example.com/wedding",
    publishedAt: new Date("2026-11-12T10:00:00Z"),
    videoUrl: "https://example.com/v.mp4",
    ...over,
  };
}

async function main() {
  check("weekStart is the Monday", weekStart(new Date("2026-11-13T12:00:00Z")) === "2026-11-09", weekStart(new Date("2026-11-13T12:00:00Z")));
  check("weekStart of a Monday is itself", weekStart(new Date("2026-11-09T12:00:00Z")) === "2026-11-09");

  const store = await GoalStore.load();
  // Campaign goal with a target: latest views below 70% of the max -> gap.
  store.recordRun({ productKey: "wedding-invites", channel: "instagram", metrics: { views: 500 }, primaryMetric: "views" });
  store.recordRun({ productKey: "wedding-invites", channel: "instagram", metrics: { views: 100 }, primaryMetric: "views" });

  // The plan date must be TODAY: recordRun stamps runs with the real
  // now, and calibrate() only counts views on the plan date.
  const today = new Date().toISOString().slice(0, 10);
  const plan: BrainPlan = {
    date: today,
    seasons: ["wedding"],
    affiliate: null,
    affiliateReason: "none",
    dailyAd: null,
    slots: [],
    coverage: { forcedIds: [], unpromoted7d: [] },
    predictions: [
      { id: "job-a", kind: "affiliate-video", score: 60 },
      { id: "wedding-invites", kind: "campaign", score: 80 },
    ],
    generatedAt: `${today}T01:00:00Z`,
  };

  const report = await buildWeeklyReport({
    fetchFn: stubFetch, igToken: "t", store, plans: [plan],
    campaigns: [{ title: "Wedding invitation templates", productKey: "wedding-invites" }],
    records: [
      rec(),
      rec({ platformMediaId: "media-b", jobId: "job-b", caption: "Hook line", publishedAt: new Date("2026-11-13T10:00:00Z") }),
    ],
    now: new Date("2026-11-13T12:00:00Z"),
  });
  check("week is the Monday", report.week === "2026-11-09", report.week);
  check("totals sum real views", report.totals.posts === 2 && report.totals.views === 600 && report.totals.likes === 45, JSON.stringify(report.totals));
  check("byChannel splits instagram", (report.byChannel.instagram?.posts ?? 0) === 2 && (report.byChannel.instagram?.views ?? 0) === 600);
  check("top post is the 500-view reel", report.topPosts[0]?.mediaId === "media-a" && report.topPosts[0]?.views === 500, JSON.stringify(report.topPosts[0]));
  check("top post carries the campaign key", report.topPosts[0]?.productKey === "wedding-invites", report.topPosts[0]?.productKey ?? "none");
  check("gaps flag the underperformer", report.gaps.some((g) => g.productKey === "wedding-invites" && g.underperforming), JSON.stringify(report.gaps));
  check("calibration counts the plan day", report.calibration.days === 1 && report.calibration.accuracy === 1, JSON.stringify(report.calibration));
  check("notes say views are not sales", report.notes.some((n) => n.includes("never sales")), report.notes.join(" | "));

  // Cold start: no plans -> accuracy null, note says so.
  const cold = await buildWeeklyReport({
    fetchFn: stubFetch, igToken: "t", store: await GoalStore.load(), plans: [], records: [], now: new Date("2026-11-13T12:00:00Z"),
  });
  check("cold start: no calibration claimed", cold.calibration.accuracy === null && cold.notes.some((n) => n.includes("cold-start")), JSON.stringify(cold.calibration));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
