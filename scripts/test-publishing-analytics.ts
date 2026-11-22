/**
 * Analytics auto-collection tests: IG/FB insights parsing, recent
 * records + insights, goal-loop recording (digital records enrich
 * their campaign's goal entry; affiliate records key by jobId), and
 * the productKey rule. Run: npx tsx scripts/test-publishing-analytics.ts
 */
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  collectAnalytics,
  fetchInsights,
  productKeyForRecord,
  recentRecordsWithInsights,
  type FetchFn,
  type PublishRecordRow,
} from "../src/lib/publishing/analytics";
import { GoalStore } from "../src/lib/marketing/goal-loop";

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

const OUT = "/tmp/analytics-test";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
process.env.MARKETING_GOALS_LEDGER_PATH = join(OUT, "ledger.json");

function igBody(views: number, likes: number) {
  return {
    data: [
      { name: "views", values: [{ value: views }] },
      { name: "reach", values: [{ value: views - 10 }] },
      { name: "likes", values: [{ value: likes }] },
      { name: "comments", values: [{ value: 2 }] },
      { name: "shares", values: [{ value: 1 }] },
      { name: "saved", values: [{ value: 3 }] },
    ],
  };
}
function fbBody(impressions: number, videoViews: number) {
  return {
    data: [
      { name: "post_impressions", values: [{ value: impressions }] },
      { name: "post_video_views", values: [{ value: videoViews }] },
      { name: "post_engaged_users", values: [{ value: 40 }] },
    ],
  };
}

const stubFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes("media-ig-1")) return new Response(JSON.stringify(igBody(120, 10)), { status: 200 });
  if (u.includes("media-ig-2")) return new Response(JSON.stringify(igBody(300, 25)), { status: 200 });
  if (u.includes("media-fb-1")) return new Response(JSON.stringify(fbBody(500, 400)), { status: 200 });
  if (u.includes("media-bad")) return new Response("nope", { status: 500 });
  throw new Error("network down");
}) as unknown as FetchFn;

function rec(over: Partial<PublishRecordRow> = {}): PublishRecordRow {
  return {
    platform: "instagram_reels",
    platformMediaId: "media-ig-1",
    jobId: "job-1",
    caption: "Wedding invitation templates\n\nDetails: https://example.com/wedding",
    publishedAt: new Date("2026-11-12T10:00:00Z"),
    videoUrl: "https://example.com/v.mp4",
    ...over,
  };
}

async function main() {
  // --- fetchInsights ---
  {
    const m = await fetchInsights("media-ig-1", "instagram", { fetchFn: stubFetch, igToken: "t" });
    check("IG insights parsed", m.views === 120 && m.reach === 110 && m.likes === 10 && m.shares === 1 && m.saved === 3, JSON.stringify(m));
    const fb = await fetchInsights("media-fb-1", "facebook", { fetchFn: stubFetch, fbToken: "t" });
    check("FB insights: views from post_video_views", fb.views === 400 && fb.reach === 500 && fb.engagedUsers === 40, JSON.stringify(fb));
    const noToken = await fetchInsights("media-ig-1", "instagram", { fetchFn: stubFetch });
    check("no token -> nulls, no fetch", noToken.views === null);
    const bad = await fetchInsights("media-bad", "instagram", { fetchFn: stubFetch, igToken: "t" });
    check("non-2xx -> nulls", bad.views === null);
    const down = await fetchInsights("media-gone", "instagram", { fetchFn: stubFetch, igToken: "t" });
    check("fetch throws -> nulls", down.views === null);
  }

  // --- recentRecordsWithInsights ---
  {
    const rows = await recentRecordsWithInsights({
      fetchFn: stubFetch, igToken: "t", fbToken: "t",
      records: [rec(), rec({ platformMediaId: "media-ig-2", jobId: "job-2", publishedAt: new Date("2026-11-13T10:00:00Z") })],
    });
    check("records get metrics attached", rows.length === 2 && rows[0].metrics.views === 300 && rows[1].metrics.views === 120, JSON.stringify(rows.map((r) => r.metrics.views)));
    check("records sorted newest first", rows[0].platformMediaId === "media-ig-2");
  }

  // --- productKeyForRecord ---
  {
    const byTitle = new Map([["wedding invitation templates", "wedding-invites"]]);
    check("digital caption first line -> campaign key", productKeyForRecord(rec(), byTitle) === "wedding-invites");
    check("no campaign match -> jobId", productKeyForRecord(rec({ caption: "Hook line here" }), byTitle) === "job-1");
    check("no jobId -> media key", productKeyForRecord(rec({ caption: "Hook", jobId: null }), byTitle) === "media:media-ig-1");
    check("nothing -> null", productKeyForRecord(rec({ caption: "", jobId: null, platformMediaId: null }), byTitle) === null);
  }

  // --- collectAnalytics ---
  {
    const store = await GoalStore.load();
    // Existing campaign goal with primaryMetric "posts" (from the tick).
    store.recordRun({ productKey: "wedding-invites", channel: "instagram", metrics: { posts: 1 }, primaryMetric: "posts" });
    const res = await collectAnalytics({
      fetchFn: stubFetch, igToken: "t", fbToken: "t", store,
      campaigns: [{ title: "Wedding invitation templates", productKey: "wedding-invites" }],
      records: [
        rec(),
        rec({ platformMediaId: "media-ig-2", jobId: "job-2", caption: "Hook line — best product", publishedAt: new Date("2026-11-13T10:00:00Z") }),
        rec({ platform: "facebook_reels", platformMediaId: "media-fb-1", jobId: "job-3", caption: "Another hook", publishedAt: new Date("2026-11-13T11:00:00Z") }),
      ],
    });
    check("collected 3 records", res.collected === 3 && res.recorded === 3 && res.errors.length === 0, JSON.stringify(res));
    const camp = store.get("wedding-invites", "instagram");
    check("digital record enriches the campaign goal", (camp?.history.at(-1)?.metrics.views ?? 0) === 120, JSON.stringify(camp?.history.at(-1)?.metrics));
    check("existing campaign keeps primaryMetric posts", camp?.primaryMetric === "posts", camp?.primaryMetric ?? "none");
    const aff = store.get("job-2", "instagram");
    check("affiliate record keys by jobId", aff != null && (aff.history.at(-1)?.metrics.views ?? 0) === 300, JSON.stringify(aff?.history.at(-1)?.metrics));
    check("new affiliate goal uses views as primary", aff?.primaryMetric === "views", aff?.primaryMetric ?? "none");
    const fb = store.get("job-3", "facebook");
    check("FB record lands on the facebook channel", fb != null && (fb.history.at(-1)?.metrics.views ?? 0) === 400, JSON.stringify(fb?.history.at(-1)?.metrics));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
