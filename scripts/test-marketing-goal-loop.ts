/**
 * test-marketing-goal-loop: target = max achieved; gap detection; diagnosis.
 * Uses an isolated ledger path (env) so the real ledger is untouched.
 * Run: npx tsx scripts/test-marketing-goal-loop.ts
 */
process.env.MARKETING_GOALS_LEDGER_PATH = "/tmp/goal-loop-test-ledger.json";

import { unlink } from "fs/promises";
import {
  GoalStore, diagnoseGap, detectWinner, generateSubAngles,
  weaknessAudit, northStarProgress, sweepGoals, GAP_THRESHOLD,
} from "../src/lib/marketing/goal-loop";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const DIAG = JSON.stringify({
  hypotheses: [
    { cause: "Creative fatigue", evidence: "clicks fell 3 runs in a row", confidence: "medium" },
    { cause: "Posting time shift", evidence: "best run was 19:30 slot", confidence: "low" },
  ],
  suggestedFixes: ["Re-apply best-run creative", "Move back to 19:30 slot"],
});

async function main() {
  await unlink("/tmp/goal-loop-test-ledger.json").catch(() => {});
  const store = await GoalStore.load();

  // run 1: sets targets
  const g1 = store.recordRun({
    productKey: "nashta-guide", channel: "pinterest",
    metrics: { clicks: 100, saves: 20 },
    config: { creative: "A", slot: "19:30" }, primaryMetric: "clicks",
  });
  check("target = max after run 1", g1.targets.clicks === 100);
  check("bestConfig snapshot", (g1.bestConfig as Record<string, unknown>).creative === "A");

  // run 2: worse — target stays at max
  store.recordRun({
    productKey: "nashta-guide", channel: "pinterest",
    metrics: { clicks: 60, saves: 25 },
    config: { creative: "B", slot: "08:30" },
  });
  const g2 = store.get("nashta-guide", "pinterest")!;
  check("target stays max", g2.targets.clicks === 100 && g2.targets.saves === 25);
  check("bestConfig unchanged on worse run", (g2.bestConfig as Record<string, unknown>).creative === "A");

  // run 3: new best on primary → bestConfig updates
  store.recordRun({
    productKey: "nashta-guide", channel: "pinterest",
    metrics: { clicks: 150 }, config: { creative: "C", slot: "19:30" },
  });
  const g3 = store.get("nashta-guide", "pinterest")!;
  check("target raised on new best", g3.targets.clicks === 150);
  check("bestConfig updated", (g3.bestConfig as Record<string, unknown>).creative === "C");

  // gap: latest 150 vs target 150 → ok. Add a bad run → gap.
  store.recordRun({ productKey: "nashta-guide", channel: "pinterest", metrics: { clicks: 80 } });
  const gaps = store.checkGaps();
  const gap = gaps.find((x) => x.channel === "pinterest")!;
  check("gap detected under threshold", gap.underperforming === true, `gapPct=${gap.gapPct}`);
  check("threshold is 0.7", GAP_THRESHOLD === 0.7);

  // healthy goal → no flag
  store.recordRun({ productKey: "ok-product", channel: "reels", metrics: { views: 1000 }, primaryMetric: "views" });
  store.recordRun({ productKey: "ok-product", channel: "reels", metrics: { views: 950 } });
  const gaps2 = store.checkGaps();
  check("healthy goal not flagged", gaps2.find((x) => x.productKey === "ok-product")!.underperforming === false);

  // diagnosis with mock
  const latest = g3.history[g3.history.length - 1];
  const diag = await diagnoseGap(g3, latest, async () => DIAG);
  check("hypotheses parsed", diag.hypotheses.length === 2);
  check("honesty note present", diag.honestyNote.includes("pakki nahi"));
  check("reapply = best config", (diag.reapplyConfig as Record<string, unknown>).creative === "C");
  check("fixes parsed", diag.suggestedFixes.length === 2);

  // garbage → hard error
  try {
    await diagnoseGap(g3, latest, async () => "not json");
    check("garbage hard-errors", false);
  } catch (e) {
    check("garbage hard-errors", e instanceof DigitalError && e.code === "generation_failed");
  }

  // persistence round-trip
  await store.save();
  const reloaded = await GoalStore.load();
  check("ledger persists", reloaded.get("nashta-guide", "pinterest")!.targets.clicks === 150);

  // ---- flywheel v1: north star ----
  store.recordRun({
    productKey: "nashta-guide", channel: "reels",
    metrics: { views: 8000 }, primaryMetric: "views",
    northStar: { views: 10000 },
  });
  const ns = northStarProgress(store).find((x) => x.channel === "reels")!;
  check("north star recorded", ns.northStar === 10000);
  check("north star pct", ns.pctOfStar === 80 && ns.reached === false, `pct=${ns.pctOfStar}`);

  // ---- flywheel v1: winner 3x rule ----
  // 4 steady runs (median 100) then a 3.5x run → winner
  for (const v of [95, 100, 105, 98]) {
    store.recordRun({ productKey: "winner-prod", channel: "reels", metrics: { views: v }, primaryMetric: "views" });
  }
  const preGoal = store.get("winner-prod", "reels")!;
  check("no winner before spike", detectWinner(preGoal) === 0);
  store.recordRun({ productKey: "winner-prod", channel: "reels", metrics: { views: 350 }, primaryMetric: "views", config: { hook: "X" } });
  const winGoal = store.get("winner-prod", "reels")!;
  const mult = detectWinner(winGoal);
  check("winner detected at 3x+", mult >= 3, `mult=${mult}`);

  // sub-angles with mock
  const ANGLES = JSON.stringify({ angles: ["Angle ek", "Angle do", "Sirf ₹99 wala", "Angle char", "Angle paanch"] });
  const { angles, warnings } = await generateSubAngles("winner-prod", "reels", { hook: "X" }, async () => ANGLES);
  check("5 angles requested, price one dropped", angles.length === 4, JSON.stringify(angles));
  check("sub-angle warning recorded", warnings.length === 1);

  // sweep wires winner → contentQueue (use mock textGen that serves both shapes)
  const combo = async (prompt: string) => {
    if (prompt.includes("sub-angles")) return JSON.stringify({ angles: ["A1", "A2", "A3", "A4", "A5"] });
    return DIAG;
  };
  const report = await sweepGoals(store, combo);
  const w = report.winners.find((x) => x.productKey === "winner-prod")!;
  check("sweep reports winner", !!w && w.multiple >= 3);
  check("sub-angles queued on top", store.get("winner-prod", "reels")!.contentQueue.length === 5);
  check("sweep has northStar section", report.northStar.length > 0);
  check("sweep has weakness audit", report.weaknessAudit.length >= 7);

  // ---- flywheel v1: weakness audit ----
  const audit = weaknessAudit(store);
  const ids = audit.map((a) => a.id);
  check("7 weakness families covered",
    ["channel-diversity", "video-presence", "recency", "no-validation", "fake-claims", "no-hinglish", "manual-burnout"]
      .every((k) => ids.some((id) => id.startsWith(k))));
  // nashta-guide has pinterest+reels (2 channels, recent) → warn on diversity
  const div = audit.find((a) => a.id === "channel-diversity:nashta-guide")!;
  check("diversity warn at 2 channels", div.status === "warn", div.evidence);
  // winner-prod reels channel matches video heuristic → pass
  const vid = audit.find((a) => a.id === "video-presence:winner-prod")!;
  check("video heuristic pass", vid.status === "pass");
  // single-channel product → fail
  store.recordRun({ productKey: "lonely", channel: "blog", metrics: { visits: 10 }, primaryMetric: "visits" });
  const audit2 = weaknessAudit(store);
  check("single channel fails diversity",
    audit2.find((a) => a.id === "channel-diversity:lonely")!.status === "fail");
  check("blog-only fails video presence",
    audit2.find((a) => a.id === "video-presence:lonely")!.status === "fail");
  check("pipeline guards transparent",
    audit2.filter((a) => a.source === "pipeline").length === 4 &&
    audit2.every((a) => a.source === "pipeline" ? a.status === "pass" : true));

  await unlink("/tmp/goal-loop-test-ledger.json").catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
