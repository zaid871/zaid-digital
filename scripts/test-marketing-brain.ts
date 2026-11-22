/**
 * Marketing Brain tests: scoring signals, format decision, daily plan
 * (affiliate pick, slot assignment, weekly coverage, carousel picks),
 * calibration, and the campaigns-tick carousel branch + plan ordering.
 * Run: npx tsx scripts/test-marketing-brain.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildDailyPlan,
  calibrate,
  captionForAffiliate,
  fireAffiliateReel,
  formatFor,
  planDay,
  scoreProduct,
  type AffiliateVideo,
  type BrainPlan,
  type PackImages,
} from "../src/lib/marketing/brain";
import { GoalStore } from "../src/lib/marketing/goal-loop";
import { tickCampaign, tickAllCampaigns, type Campaign } from "../src/lib/marketing/campaigns";
import type { FetchFn } from "../src/lib/marketing/brain";

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

const NOW = new Date(); // real now — Nov 2026: wedding + new-year season active
const DAY = 86400000;

function mkCampaign(over: Partial<Campaign> = {}): Campaign {
  const created = new Date(NOW.getTime() - 20 * DAY);
  return {
    id: "cmp-test",
    createdAt: created.toISOString(),
    productKey: "test-product",
    url: "https://example.com/product",
    title: "Test Product",
    productType: "ebook",
    fit: { auto: ["pinterest", "linkedin"], manual: ["x"], reasons: [] },
    status: "active",
    posts: 0,
    lastPostAt: null,
    actions: [],
    lastDecision: null,
    ...over,
  };
}

function video(jobId: string, title: string, renderedDaysAgo: number): AffiliateVideo {
  return {
    jobId,
    title,
    productUrl: `https://example.com/${jobId}`,
    downloadUrl: `https://example.com/video-${jobId}.mp4`,
    caption: captionForAffiliate(title, "Best product", ["Feature one", "Feature two"], `https://example.com/${jobId}`),
    renderedAt: new Date(NOW.getTime() - renderedDaysAgo * DAY).toISOString(),
  };
}

async function main() {
  // --- Scoring signals ---
  check("seasonal 50 -> 75 in Nov (wedding)", scoreProduct({ demandScore: 50, text: "Wedding invitation pack", lastPromotedAt: NOW.toISOString() }, NOW).total === 75, String(scoreProduct({ demandScore: 50, text: "Wedding invitation pack", lastPromotedAt: NOW.toISOString() }, NOW).total));
  check("non-seasonal 50 stays 50", scoreProduct({ demandScore: 50, text: "Fitness workout log", lastPromotedAt: NOW.toISOString() }, NOW).total === 50, String(scoreProduct({ demandScore: 50, text: "Fitness workout log", lastPromotedAt: NOW.toISOString() }, NOW).total));
  {
    const s = scoreProduct({ demandScore: 60, text: "Wedding invitation pack", trend: "rising", pastViews: 200, medianViews: 100 }, NOW);
    check("rising + winner lifts score", s.total > 85, `total=${s.total} reasons=${s.reasons.join("|")}`);
    const f = scoreProduct({ demandScore: 60, text: "Fitness workout log", trend: "falling", pastViews: 20, medianViews: 100 }, NOW);
    check("falling + loser dampens score", f.total < 65, `total=${f.total}`);
  }
  {
    const urgent = scoreProduct({ demandScore: 50, text: "Fitness workout log", lastPromotedAt: new Date(NOW.getTime() - 10 * DAY).toISOString() }, NOW);
    check("unpromoted 10d gets +30 coverage", urgent.coverage === 30 && urgent.total === 80, `coverage=${urgent.coverage} total=${urgent.total}`);
    const soon = scoreProduct({ demandScore: 50, text: "Fitness workout log", lastPromotedAt: new Date(NOW.getTime() - 5 * DAY).toISOString() }, NOW);
    check("unpromoted 5d gets +15 coverage", soon.coverage === 15 && soon.total === 65, `coverage=${soon.coverage} total=${soon.total}`);
    const fresh = scoreProduct({ demandScore: 50, text: "Fitness workout log", createdAt: new Date(NOW.getTime() - 2 * DAY).toISOString(), lastPromotedAt: NOW.toISOString() }, NOW);
    check("fresh product gets +5", fresh.fresh === 5 && fresh.total === 55, `fresh=${fresh.fresh} total=${fresh.total}`);
    const capped = scoreProduct({ demandScore: 100, text: "Wedding invitation pack", trend: "rising", lastPromotedAt: new Date(NOW.getTime() - 10 * DAY).toISOString() }, NOW);
    check("score caps at 100", capped.total === 100, `total=${capped.total}`);
  }

  // --- Format decision ---
  check("marketed elsewhere -> carousel", formatFor(true) === "carousel");
  check("not marketed elsewhere -> reel", formatFor(false) === "reel");

  // --- Caption (same pattern as ads-marketing build-reels-payload) ---
  {
    const cap = captionForAffiliate("Test Product", "Best product", ["A", "B", "C", "D"], "https://example.com/p");
    check("caption has name + desc + 3 features + link", cap.includes("Test Product") && cap.includes("Best product") && cap.includes("✓ C") && !cap.includes("✓ D") && cap.includes("Details: https://example.com/p"), cap);
  }

  // --- Daily plan (pure planDay with a stub store) ---
  const OUT = "/tmp/marketing-brain-test";
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "goals"), { recursive: true });
  process.env.MARKETING_GOALS_LEDGER_PATH = join(OUT, "goals", "ledger.json");
  const store = await GoalStore.load();
  // c-wedding: marketed on pinterest yesterday (elsewhere -> carousel candidate).
  store.recordRun({ productKey: "wedding-invites", channel: "pinterest", metrics: { posts: 1 }, primaryMetric: "posts" });
  // c-fitness: strong past IG views (winner).
  store.recordRun({ productKey: "fitness-log", channel: "instagram", metrics: { views: 500 }, primaryMetric: "views" });
  // c-budget: unpromoted 10 days (coverage urgent).
  await store.save();

  const packs: PackImages[] = [
    { dir: "wedding-pack-x", niche: "wedding", packName: "Wedding invitation pack", pngs: ["d1.png", "d2.png", "d3.png", "d4.png"] },
  ];
  const campaigns = [
    mkCampaign({ id: "c-wedding", productKey: "wedding-invites", title: "Wedding invitation templates", niche: "wedding", url: "https://example.com/wedding", lastPostAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
    mkCampaign({ id: "c-fitness", productKey: "fitness-log", title: "Fitness workout log", niche: "fitness", url: "https://example.com/fitness", lastPostAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
    mkCampaign({ id: "c-budget", productKey: "budget-tracker", title: "Budget tracker", niche: "budget", url: "https://example.com/budget", lastPostAt: new Date(NOW.getTime() - 10 * DAY).toISOString() }),
  ];
  const plan = planDay(
    { campaigns: campaigns.map((c) => ({ ...c, progress: null })), affiliateVideos: [video("job-old", "Fitness band", 3), video("job-wed", "Wedding invitation video", 1)], store, packs, origin: "https://example.com" },
    NOW
  );
  check("affiliate pick is the seasonal video", plan.affiliate?.jobId === "job-wed", plan.affiliate?.title ?? "none");
  check("affiliate pick is a reel", plan.affiliate?.format === "reel");
  check("plan has 3 slots", plan.slots.length === 3, `slots=${plan.slots.length}`);
  check("coverage flags the 10d-unpromoted campaign", plan.coverage.unpromoted7d.includes("c-budget"), JSON.stringify(plan.coverage));
  check("coverage-forced campaign made the slots", plan.slots.some((s) => s.campaignId === "c-budget"), plan.slots.map((s) => s.campaignId).join(","));
  {
    const w = plan.slots.find((s) => s.campaignId === "c-wedding");
    check("wedding campaign (marketed on pinterest) gets carousel", w?.format === "carousel", w?.format ?? "none");
    check("carousel pick carries 4 pack image URLs", (w?.imageUrls.length ?? 0) === 4, JSON.stringify(w?.imageUrls));
    check("carousel image URLs are public file URLs", (w?.imageUrls[0] ?? "").startsWith("https://example.com/api/v1/digital/files/wedding-pack-x/"), w?.imageUrls[0] ?? "");
    const f = plan.slots.find((s) => s.campaignId === "c-fitness");
    check("fitness campaign (not marketed elsewhere) gets reel", f?.format === "reel", f?.format ?? "none");
  }
  check("dailyAd is the top digital pick", plan.dailyAd?.productName === plan.slots[0].title, plan.dailyAd?.productName ?? "none");
  check("plan records predictions", plan.predictions.length === plan.slots.length + 1, `preds=${plan.predictions.length}`);
  {
    // Placements: IG is the anchor, never the only channel.
    const reelPick = plan.slots.find((s) => s.campaignId === "c-fitness");
    const reelChannels = (reelPick?.placements ?? []).map((p) => `${p.channel}:${p.format}`).join(",");
    check("reel pick places on IG + FB + Pinterest + LinkedIn + Threads + X draft", reelChannels === "instagram:reel,facebook:reel,pinterest:pin,linkedin:post,threads:post,x:draft", reelChannels);
    const carPick = plan.slots.find((s) => s.campaignId === "c-wedding");
    const carChannels = (carPick?.placements ?? []).map((p) => `${p.channel}:${p.format}`).join(",");
    check("carousel pick places on IG + Pinterest + LinkedIn + Threads + X (no FB)", carChannels === "instagram:carousel,pinterest:pin,linkedin:post,threads:post,x:draft", carChannels);
    check("carousel pick reasons state the FB skip", (carPick?.reasons ?? []).some((r) => r.includes("facebook: skip")), (carPick?.reasons ?? []).join(" | "));
    check("pick channels match placements", JSON.stringify((carPick?.channels ?? [])) === JSON.stringify((carPick?.placements ?? []).map((p) => p.channel)));
    check("affiliate pick places on IG + FB", (plan.affiliate?.placements ?? []).map((p) => p.channel).join(",") === "instagram,facebook", (plan.affiliate?.placements ?? []).map((p) => p.channel).join(","));
  }

  // --- buildDailyPlan writes the plan to disk (stub deps, no live DB) ---
  {
    const plan2 = await buildDailyPlan({
      now: NOW,
      origin: "https://example.com",
      outRoot: OUT,
      campaigns: campaigns.map((c) => ({ ...c, progress: null })),
      readyVideos: [video("job-wed", "Wedding invitation video", 1)],
      store,
      packs,
    });
    check("buildDailyPlan returns the affiliate pick", plan2.affiliate?.jobId === "job-wed");
    const saved = JSON.parse(readFileSync(join(OUT, "storage", "marketing", "brain", "latest.json"), "utf-8")) as BrainPlan;
    check("plan persisted to latest.json", saved.date === plan2.date && saved.slots.length === 3);
  }

  // --- Calibration: top pick won on day 1, lost on day 2 -> 0.5 ---
  {
    const y = new Date(NOW.getTime() - 1 * DAY).toISOString().slice(0, 10);
    const y2 = new Date(NOW.getTime() - 2 * DAY).toISOString().slice(0, 10);
    const mkGoal = (productKey: string, rows: Array<{ at: string; views: number }>) => ({
      productKey,
      channel: "instagram",
      primaryMetric: "views",
      targets: { views: Math.max(...rows.map((r) => r.views)) },
      northStar: {},
      bestConfig: {},
      bestAt: rows[0].at,
      history: rows.map((r) => ({ at: r.at, metrics: { views: r.views }, config: {} })),
      runs: rows.length,
      lastDiagnosis: null,
      contentQueue: [],
      winnerRuns: [],
    });
    const ledger: Record<string, unknown> = {
      "c-a::instagram": mkGoal("c-a", [
        { at: `${y}T10:00:00.000Z`, views: 500 },
        { at: `${y2}T10:00:00.000Z`, views: 50 },
      ]),
      "c-b::instagram": mkGoal("c-b", [
        { at: `${y}T10:00:00.000Z`, views: 100 },
        { at: `${y2}T10:00:00.000Z`, views: 400 },
      ]),
    };
    const ledgerPath = join(OUT, "goals", "ledger-cal.json");
    writeFileSync(ledgerPath, JSON.stringify(ledger), "utf-8");
    process.env.MARKETING_GOALS_LEDGER_PATH = ledgerPath;
    const store2 = await GoalStore.load();
    const fakePlans: BrainPlan[] = [
      { ...plan, date: y, predictions: [{ id: "c-a", kind: "campaign", score: 90 }, { id: "c-b", kind: "campaign", score: 60 }] },
      { ...plan, date: y2, predictions: [{ id: "c-a", kind: "campaign", score: 90 }, { id: "c-b", kind: "campaign", score: 60 }] },
    ];
    const cal = calibrate(fakePlans, store2);
    check("calibration: top pick won 1 of 2 days -> 0.5", cal.days === 2 && cal.wins === 1 && cal.accuracy === 0.5, JSON.stringify(cal));
    check("calibration with no data -> null", calibrate([], store2).accuracy === null);
  }

  // --- Campaigns tick: carousel branch + plan ordering ---
  {
    const CAMP_DIR = "/tmp/marketing-brain-test-campaigns";
    rmSync(CAMP_DIR, { recursive: true, force: true });
    mkdirSync(CAMP_DIR, { recursive: true });
    process.env.MARKETING_CAMPAIGNS_PATH = join(CAMP_DIR, "campaigns.json");
    process.env.MARKETING_GOALS_LEDGER_PATH = join(CAMP_DIR, "ledger.json");
    process.env.N8N_BASE_URL = "http://n8n:5678";
    process.env.N8N_WEBHOOK_SECRET = "test-secret";
    process.env.PINTEREST_ACCESS_TOKEN = "test-pin-token";
    process.env.PINTEREST_BOARD_ID = "test-board";
    process.env.LINKEDIN_ACCESS_TOKEN = "test-li-token";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:test123";
    const c1 = mkCampaign({ id: "c1", productKey: "prod-1", title: "Wedding invitation templates", url: "https://example.com/wedding" });
    const c2 = mkCampaign({ id: "c2", productKey: "prod-2", title: "Fitness workout log", url: "https://example.com/fitness" });
    writeFileSync(join(CAMP_DIR, "campaigns.json"), JSON.stringify([c1, c2]), "utf-8");
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: unknown, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : null });
      const u = String(url);
      if (u.includes("api.pinterest.com")) {
        return { ok: true, status: 200, json: async () => ({ id: "pin-1" }), text: async () => "" } as unknown as Response;
      }
      if (u.includes("api.linkedin.com")) {
        return {
          ok: true,
          status: 201,
          headers: { get: (n: string) => (n.toLowerCase() === "x-restli-id" ? "post-1" : null) },
          text: async () => "",
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;
    }) as unknown as FetchFn;
    const peak = new Date("2026-11-20T02:30:00Z"); // 08:00 IST — peak window
    const planStub: BrainPlan = {
      ...plan,
      date: "2026-11-20",
      slots: [
        { slot: "07:30", campaignId: "c1", jobId: null, title: "Wedding invitation templates", format: "carousel", channels: ["instagram", "pinterest", "linkedin", "x"], placements: [{ channel: "instagram", format: "carousel", reason: "x" }, { channel: "pinterest", format: "pin", reason: "x" }, { channel: "linkedin", format: "post", reason: "x" }, { channel: "x", format: "draft", reason: "x" }], imageUrls: ["https://example.com/a.png", "https://example.com/b.png"], caption: "Wedding templates", score: 90, reasons: [] },
        { slot: "08:30", campaignId: "c2", jobId: null, title: "Fitness workout log", format: "reel", channels: ["instagram", "facebook"], placements: [{ channel: "instagram", format: "reel", reason: "x" }, { channel: "facebook", format: "reel", reason: "x" }], imageUrls: [], caption: "Fitness log", score: 70, reasons: [] },
      ],
    };
    const store3 = await GoalStore.load();
    const r1 = await tickCampaign(c1, { now: peak, fetchFn, store: store3, plan: planStub });
    check("carousel tick fires the IG carousel webhook", calls.some((c) => String(c.url).endsWith("/webhook/digital/instagram") && (c.body as { mediaType?: string }).mediaType === "carousel"), JSON.stringify(calls));
    check("carousel tick note names the carousel", r1.note.includes("Carousel post ho gaya"), r1.note);
    check("carousel tick also publishes Pinterest + LinkedIn", calls.some((c) => String(c.url).includes("api.pinterest.com")) && calls.some((c) => String(c.url).includes("api.linkedin.com")), calls.map((c) => c.url).join(","));
    check("carousel tick note lists the other channels", r1.note.includes("pinterest: published") && r1.note.includes("linkedin: published"), r1.note);
    const savedCamps = JSON.parse(readFileSync(join(CAMP_DIR, "campaigns.json"), "utf-8")) as Campaign[];
    check("carousel tick increments posts", savedCamps.find((c) => c.id === "c1")?.posts === 1, JSON.stringify(savedCamps.map((c) => [c.id, c.posts])));
    // Ordering: plan lists c2 first — tickAllCampaigns must process c2 first.
    writeFileSync(join(CAMP_DIR, "campaigns.json"), JSON.stringify([c1, c2]), "utf-8");
    const planReversed: BrainPlan = { ...planStub, slots: [...planStub.slots].reverse() };
    const results = await tickAllCampaigns({ now: peak, fetchFn, plan: planReversed });
    check("tickAllCampaigns follows plan order", results.map((r) => r.campaignId).join(",") === "c2,c1", results.map((r) => r.campaignId).join(","));
  }

  // --- Affiliate fire: IG + FB both, same video ---
  {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: unknown, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : null });
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;
    }) as unknown as FetchFn;
    process.env.N8N_BASE_URL = "http://n8n:5678";
    process.env.N8N_WEBHOOK_SECRET = "test-secret";
    const affPlan: BrainPlan = {
      ...plan,
      affiliate: {
        slot: null,
        campaignId: null,
        jobId: "job-wed",
        title: "Wedding invitation video",
        format: "reel",
        channels: ["instagram", "facebook"],
        placements: [
          { channel: "instagram", format: "reel", reason: "x" },
          { channel: "facebook", format: "reel", reason: "x" },
        ],
        imageUrls: [],
        downloadUrl: "https://example.com/video-job-wed.mp4",
        caption: "Wedding video caption",
        niche: "gadgets",
        score: 80,
        reasons: [],
      },
    };
    const r = await fireAffiliateReel(affPlan, { now: NOW, fetchFn, publishedToday: false, outRoot: OUT });
    check("affiliate fire: IG webhook called", calls.some((c) => String(c.url).endsWith("/webhook/affiliate/instagram")), calls.map((c) => c.url).join(","));
    check("affiliate fire: FB webhook called too (IG only nahi)", calls.some((c) => String(c.url).endsWith("/webhook/affiliate/facebook")), calls.map((c) => c.url).join(","));
    check("affiliate fire reports both", r.fired === true && r.fbFired === true, JSON.stringify(r));
    const igCall = calls.find((c) => String(c.url).endsWith("/webhook/affiliate/instagram"));
    check("both webhooks get the same video + caption", (igCall?.body as { downloadUrl?: string }).downloadUrl === "https://example.com/video-job-wed.mp4", JSON.stringify(igCall?.body));
    check("fire carries the affiliate niche for account routing",
      (igCall?.body as { product?: { niche?: string } }).product?.niche === "gadgets", JSON.stringify(igCall?.body));
    const r2 = await fireAffiliateReel(affPlan, { now: NOW, fetchFn, publishedToday: true, outRoot: OUT });
    check("already published today -> no second fire", r2.fired === false && r2.fbFired === false, JSON.stringify(r2));
  }

  // --- Affiliate past performance (brain deepening, 2026-11-13) ---
  // Affiliate videos are scored with their goal-loop history (keyed by
  // jobId, recorded by the analytics collector), and that history also
  // feeds the median the campaigns use.
  {
    store.recordRun({ productKey: "camp-a", channel: "instagram", metrics: { views: 100 }, primaryMetric: "views" });
    store.recordRun({ productKey: "camp-b", channel: "instagram", metrics: { views: 120 }, primaryMetric: "views" });
    store.recordRun({ productKey: "job-hot", channel: "instagram", metrics: { views: 500 }, primaryMetric: "views" });
    await store.save();
    const liftPlan = planDay(
      {
        campaigns: [
          mkCampaign({ id: "c-a", productKey: "camp-a", title: "Camp A", niche: "general", lastPostAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
          mkCampaign({ id: "c-b", productKey: "camp-b", title: "Camp B", niche: "general", lastPostAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
        ].map((c) => ({ ...c, progress: null })),
        affiliateVideos: [video("job-hot", "Hot product", 1), video("job-cold", "Cold product", 1)],
        store, packs: [], origin: "https://example.com",
      },
      NOW
    );
    // Median of [100, 120, 500] is 120; hot perf 500/120 clamps to 1.3.
    // Base 50 + fresh 5 + never-promoted coverage 15 = 70 x 1.3 = 91.
    check("affiliate with past views outranks a fresh video", liftPlan.affiliate?.jobId === "job-hot", liftPlan.affiliate?.jobId ?? "none");
    check("hot affiliate score reflects the 1.3 perf lift", liftPlan.affiliate?.score === 91, `score=${liftPlan.affiliate?.score}`);
  }
  {
    // Median inclusion: with only camp-a (100) + job-hot (1000), the
    // median is 1000, so camp-a's perf is 100/1000 -> 0.7 -> score 35.
    // (Without the affiliate history the median would be 100 -> 50.)
    store.recordRun({ productKey: "job-hot2", channel: "instagram", metrics: { views: 1000 }, primaryMetric: "views" });
    await store.save();
    const medPlan = planDay(
      {
        campaigns: [
          mkCampaign({ id: "c-a", productKey: "camp-a", title: "Camp A", niche: "general", lastPostAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
        ].map((c) => ({ ...c, progress: null })),
        affiliateVideos: [video("job-hot2", "Hot product two", 1)],
        store, packs: [], origin: "https://example.com",
      },
      NOW
    );
    check("affiliate history feeds the shared median", medPlan.slots[0]?.score === 35, `slot score=${medPlan.slots[0]?.score}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL MARKETING-BRAIN TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
