/**
 * Marketing campaign tests — no live network: n8n forward is stubbed,
 * env paths point at /tmp so real files are untouched.
 */
process.env.MARKETING_CAMPAIGNS_PATH = "/tmp/campaigns-test.json";
process.env.MARKETING_GOALS_LEDGER_PATH = "/tmp/campaigns-test-ledger.json";
process.env.MARKETING_PROMOTIONS_PATH = "/tmp/campaigns-test-promos.json";
process.env.N8N_BASE_URL = "http://n8n.test";
process.env.N8N_WEBHOOK_SECRET = "test-secret";

import { rm } from "fs/promises";
import {
  createCampaign, setCampaignStatus, loadCampaigns, fitCategoryFor,
  paceFor, decideNextAction, tickCampaign, readProgress,
  type Campaign, type FetchFn,
} from "../src/lib/marketing/campaigns";
import { autoPlatforms, manualPlatforms } from "../src/lib/publishing/platform-fit";
import { GoalStore } from "../src/lib/marketing/goal-loop";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const PEAK = new Date("2026-11-12T08:00:00+05:30"); // 08:00 IST — peak window
const OFF_PEAK = new Date("2026-11-12T12:00:00+05:30"); // 12:00 IST — off-peak

function mkCampaign(over: Partial<Campaign> = {}): Campaign {
  const now = new Date("2026-11-11T08:00:00+05:30");
  // Fit is computed from the real platform-fit table (like createCampaign
  // does) — never hardcoded, or the test stops testing reality.
  const category = fitCategoryFor("ebook");
  return {
    id: "cmp-test",
    createdAt: now.toISOString(),
    productKey: "test-product",
    url: "https://example.com/product",
    title: "Test Product",
    productType: "ebook",
    fit: {
      auto: autoPlatforms({ name: "Test Product", category }),
      manual: manualPlatforms({ name: "Test Product", category }),
      reasons: [],
    },
    status: "active",
    posts: 0,
    lastPostAt: null,
    actions: [],
    lastDecision: null,
    ...over,
  };
}

function withTarget(days = 10, value = 1000, metric: "views" | "clicks" | "posts" | "sales" = "views"): Campaign {
  const created = new Date("2026-11-11T08:00:00+05:30");
  return mkCampaign({
    createdAt: created.toISOString(),
    target: {
      metric,
      value,
      deadlineDays: days,
      deadlineAt: new Date(created.getTime() + days * 86400000).toISOString(),
    },
  });
}

// --- fit mapping ---
check("ebook maps to digital_products_templates", fitCategoryFor("ebook") === "digital_products_templates");
check("template maps to digital_products_templates", fitCategoryFor("template_pack") === "digital_products_templates");
check("pod maps to useful_physical", fitCategoryFor("pod") === "useful_physical");
check("website maps to other_permissible", fitCategoryFor("website") === "other_permissible");

// --- pace math (campaign created 2026-11-11 08:00 IST, 10-day deadline) ---
{
  // At 2026-11-12 08:00 IST: 1 day elapsed of 10 -> expected 100 of 1000.
  const c = withTarget(10, 1000);
  const onTrack = paceFor(c, 800, PEAK);
  check("pace on-track when ahead of expected", onTrack.label === "on-track" && onTrack.level === 0);
  const behind = paceFor(c, 40, PEAK);
  check("pace behind at 40% of expected", behind.label === "behind" && behind.level === 1);
  const urgent = paceFor(c, 20, PEAK);
  check("pace urgent at 20% of expected", urgent.label === "urgent" && urgent.level === 2);
  const noData = paceFor(c, null, PEAK);
  check("pace no-data when progress unknown", noData.label === "no-data" && noData.ratio === null);
  const noTarget = paceFor(mkCampaign(), 50, PEAK);
  check("pace no-target without a target", noTarget.label === "no-target");
  const done = paceFor(c, 1000, PEAK);
  check("pace on-track when target met", done.label === "on-track" && done.ratio === 1);
}

// --- decision engine ---
{
  // Off-peak -> wait, with the next slot named.
  const d0 = decideNextAction(withTarget(), null, OFF_PEAK);
  check("off-peak -> wait", d0.action === "wait" && d0.reason.includes("19:30"));
  // Peak, on-track -> post top-1 auto platform only.
  const d1 = decideNextAction(withTarget(), 800, PEAK);
  check("peak + on-track -> post top-1", d1.action === "post" && d1.level === 0 && d1.channels.length === 1);
  // Peak, behind -> post all auto platforms.
  const d2 = decideNextAction(withTarget(), 40, PEAK);
  check("peak + behind -> post all auto", d2.action === "post" && d2.level === 1 && d2.channels.length === 3);
  // Peak, urgent -> post all + manual X draft.
  const d3 = decideNextAction(withTarget(), 20, PEAK);
  check("peak + urgent -> all + X draft", d3.action === "post" && d3.level === 2 && d3.includeManualDraft === true);
  // Too soon since last post -> wait.
  const recent = withTarget();
  recent.lastPostAt = new Date("2026-11-12T07:00:00+05:30").toISOString(); // 1h ago
  const d4 = decideNextAction(recent, 800, PEAK);
  check("last post 1h ago -> wait (min gap)", d4.action === "wait" && d4.reason.includes("intezar"));
  // Deadline passed + unmet -> missed.
  const past = withTarget(1, 1000);
  past.target = { ...past.target!, deadlineAt: new Date("2026-11-11T09:00:00+05:30").toISOString() };
  const d5 = decideNextAction(past, 100, new Date("2026-11-12T08:00:00+05:30"));
  check("deadline passed + unmet -> missed", d5.action === "missed");
  // Target met -> done.
  const d6 = decideNextAction(withTarget(), 1000, PEAK);
  check("target met -> done", d6.action === "done");
  // No target, peak, no recent post -> post (normal cadence).
  const d7 = decideNextAction(mkCampaign(), null, PEAK);
  check("no target -> post normally", d7.action === "post" && d7.level === 0);
}

// --- progress reading from the goal-loop ledger ---
async function main() {
  await rm("/tmp/campaigns-test.json", { force: true });
  await rm("/tmp/campaigns-test-ledger.json", { force: true });
  await rm("/tmp/campaigns-test-promos.json", { force: true });

  // createCampaign: bad URL rejected, deadline computed, fit stored.
  let badUrlRejected = false;
  try { await createCampaign({ url: "http://localhost:3000/x" }); } catch { badUrlRejected = true; }
  check("create rejects localhost URL", badUrlRejected);

  const c1 = await createCampaign({
    url: "https://meri-dukaan.com/budget-planner",
    title: "Budget Planner",
    productType: "template_pack",
    target: { metric: "views", value: 5000, deadlineDays: 30 },
  });
  check("create stores fit auto platforms", c1.fit.auto.includes("pinterest") && c1.fit.auto.includes("linkedin"));
  check("create computes deadlineAt 30 days out",
    Math.abs(new Date(c1.target!.deadlineAt).getTime() - (Date.now() + 30 * 86400000)) < 60_000);
  check("create productKey is the title slug", c1.productKey === "budget-planner");

  // Seed the ledger: views recorded for this productKey on 2 channels.
  const store = await GoalStore.load();
  store.recordRun({ productKey: "budget-planner", channel: "instagram", metrics: { views: 1200 }, primaryMetric: "views" });
  store.recordRun({ productKey: "budget-planner", channel: "pinterest", metrics: { views: 800 }, primaryMetric: "views" });
  await store.save();
  const reloaded = await GoalStore.load();
  const prog = await readProgress(c1, reloaded);
  check("progress sums latest views across channels (2000)", prog.value === 2000);

  // No data -> null, never faked as zero.
  const c2 = await createCampaign({ url: "https://doosri-dukaan.com/", title: "Doosri Dukaan", target: { metric: "clicks", value: 100, deadlineDays: 7 } });
  const prog2 = await readProgress(c2, reloaded);
  check("progress null when no metrics recorded", prog2.value === null);

  // Sales target -> null progress (selling layer parked).
  const c3 = await createCampaign({ url: "https://teesri-dukaan.com/", title: "Teesri Dukaan", target: { metric: "sales", value: 50, deadlineDays: 14 } });
  const prog3 = await readProgress(c3, reloaded);
  check("sales progress null (unmeasurable without selling layer)", prog3.value === null);

  // Posts metric -> counted by the campaign itself.
  const prog4 = await readProgress({ ...c1, posts: 3, target: { ...c1.target!, metric: "posts" } }, reloaded);
  check("posts progress is the campaign's own count", prog4.value === 3);

  // Pause / resume.
  const paused = await setCampaignStatus(c1.id, "paused");
  check("pause works", paused?.status === "paused");
  const resumed = await setCampaignStatus(c1.id, "active");
  check("resume works", resumed?.status === "active");

  // --- tick: peak + no data -> post fires the webhook, records a goal run ---
  let calls = 0;
  const okFetch = (async () => { calls += 1; return { ok: true, status: 200 }; }) as unknown as FetchFn;
  const fresh = await loadCampaigns();
  const tickTarget = fresh.find((x) => x.id === c2.id)!; // no clicks data -> no-data -> post
  const t1 = await tickCampaign(tickTarget, { now: PEAK, fetchFn: okFetch });
  check("tick at peak posts", t1.decision.action === "post" && t1.status === "active");
  check("tick fired the webhook once", calls === 1);
  check("tick counted the post", (await loadCampaigns()).find((x) => x.id === c2.id)?.posts === 1);
  const afterTick = await GoalStore.load();
  const goalRun = afterTick.get("doosri-dukaan", "instagram");
  check("tick recorded a posts goal run", goalRun?.history[goalRun.history.length - 1]?.metrics.posts === 1);

  // --- tick: off-peak -> wait, no webhook call ---
  const t2 = await tickCampaign(tickTarget, { now: OFF_PEAK, fetchFn: okFetch });
  check("tick off-peak waits", t2.decision.action === "wait");
  check("off-peak tick made no webhook call", calls === 1);

  // --- tick: webhook down -> post decision stands, promotion queued (not faked) ---
  const downFetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as FetchFn;
  const t3 = await tickCampaign({ ...tickTarget, lastPostAt: null }, { now: PEAK, fetchFn: downFetch });
  check("webhook down -> decision still post, note says queued", t3.decision.action === "post" && t3.note.includes("queue"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL CAMPAIGN TESTS PASSED");
}

main();
