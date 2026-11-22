/**
 * Season mode tests: season windows, keyword match, the boost rule
 * (seasonal +25, but a non-seasonal item with higher demand still wins),
 * campaign pace escalation, and the auto-generate tick ranking.
 * Run: npx tsx scripts/test-digital-seasons.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  activeSeasons,
  DEFAULT_SEASONS,
  loadSeasons,
  matchSeason,
  pacePenaltyFor,
  rankWithSeason,
  scoreWithSeason,
  SEASON_BOOST,
  SEASON_PACE_PENALTY,
} from "../src/lib/digital/seasons";
import { runAutoGenerateTick, type FetchFn } from "../src/lib/digital/auto-generate";
import { decideNextAction, paceFor, type Campaign } from "../src/lib/marketing/campaigns";
import type { Brief } from "../src/lib/digital/briefs";

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

const NOV = new Date("2026-11-20T02:30:00Z"); // 20 Nov 2026 — wedding + new-year season
const JUL = new Date("2026-07-10T02:30:00Z"); // 10 Jul 2026 — back-to-school only
const FEB = new Date("2026-02-20T02:30:00Z"); // 20 Feb 2026 — wedding + ramadan-eid
const PEAK = new Date("2026-11-20T02:30:00Z"); // 08:00 IST — peak window

function mkCampaign(over: Partial<Campaign> = {}): Campaign {
  const created = new Date("2026-11-10T02:30:00Z");
  return {
    id: "cmp-season-test",
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
    target: {
      metric: "views",
      value: 1000,
      deadlineDays: 30,
      deadlineAt: new Date(created.getTime() + 30 * 86400000).toISOString(),
    },
    ...over,
  };
}

function brief(id: string, productType: Brief["productType"], niche: string, title: string, demandScore: number): Brief {
  return {
    id,
    productType,
    niche,
    title,
    audience: "test",
    angle: "test angle",
    demandEvidence: ["test"],
    demandScore,
    trend: "rising",
    gap: "test gap",
    uniqueness: ["test"],
    status: "queued",
  };
}

async function main() {
  // --- Season windows ---
  check("Nov: wedding + new-year active", activeSeasons(NOV).map((s) => s.id).join(",") === "wedding,new-year", activeSeasons(NOV).map((s) => s.id).join(","));
  check("Jul: back-to-school only", activeSeasons(JUL).map((s) => s.id).join(",") === "back-to-school", activeSeasons(JUL).map((s) => s.id).join(","));
  check("Feb 2026: wedding + ramadan-eid active", activeSeasons(FEB).map((s) => s.id).join(",") === "wedding,ramadan-eid", activeSeasons(FEB).map((s) => s.id).join(","));
  check("5 default seasons", DEFAULT_SEASONS.length === 5);
  check("loadSeasons defaults without file", (await loadSeasons("/tmp/digital-seasons-test-none")).length === 5);

  // --- Keyword match ---
  check("wedding invite matches wedding in Nov", matchSeason("Wedding invitation pack", NOV)?.id === "wedding");
  check("budget planner matches new-year in Nov", matchSeason("Budget planner 2027", NOV)?.id === "new-year");
  check("fitness matches nothing in Nov", matchSeason("Fitness workout log", NOV) === null);
  check("wedding text matches nothing in Jul", matchSeason("Wedding invitation pack", JUL) === null);

  // --- The boost rule (the user's condition) ---
  check("seasonal 60 -> 85", scoreWithSeason(60, "Wedding invitation pack", NOV).score === 60 + SEASON_BOOST);
  check("non-seasonal 60 stays 60", scoreWithSeason(60, "Fitness workout log", NOV).score === 60);
  {
    // THE override test: non-seasonal 90 beats seasonal 60 (85);
    // seasonal 70 (95) beats non-seasonal 90.
    const ranked = rankWithSeason(
      [
        { demandScore: 60, text: "Wedding invitation pack" },
        { demandScore: 90, text: "Fitness workout log" },
        { demandScore: 70, text: "Wedding planner" },
      ],
      NOV
    );
    check(
      "rank: seasonal 70 (95) > non-seasonal 90 > seasonal 60 (85)",
      ranked.map((r) => r.seasonScore).join(",") === "95,90,85",
      ranked.map((r) => r.seasonScore).join(",")
    );
    check("non-seasonal 90 outranks seasonal 60", ranked[1].demandScore === 90 && ranked[1].season === null);
  }

  // --- Campaign pace escalation ---
  check("pace penalty 0.2 for seasonal title", pacePenaltyFor("Wedding invitation templates", NOV) === SEASON_PACE_PENALTY);
  check("pace penalty 0 for non-seasonal title", pacePenaltyFor("Fitness workout log", NOV) === 0);
  {
    // 10 days elapsed of 30 -> expected 333 of 1000; progress 250 -> ratio 0.75.
    const seasonal = mkCampaign({ title: "Wedding invitation templates", niche: "wedding" });
    const plain = paceFor(seasonal, 250, NOV);
    check("no boost: ratio 0.75 is on-track", plain.label === "on-track" && plain.level === 0, plain.label);
    check("reported ratio stays real with boost", paceFor(seasonal, 250, NOV, SEASON_PACE_PENALTY).ratio === plain.ratio);
    const boosted = paceFor(seasonal, 250, NOV, SEASON_PACE_PENALTY);
    check("season boost: ratio 0.75 -> behind", boosted.label === "behind" && boosted.level === 1, boosted.label);
    const d = decideNextAction(seasonal, 250, PEAK);
    check("seasonal decision: post to all auto platforms", d.action === "post" && d.channels.length === 2, `${d.action} ${d.channels.join(",")}`);
    check("seasonal decision reason names the season", d.reason.includes("Wedding Season"), d.reason);
    const nonSeasonal = mkCampaign({ title: "Fitness workout log", niche: "fitness" });
    const d2 = decideNextAction(nonSeasonal, 250, PEAK);
    check("non-seasonal same ratio: post to top platform only", d2.action === "post" && d2.channels.length === 1, `${d2.action} ${d2.channels.join(",")}`);
    check("non-seasonal reason has no season note", !d2.reason.includes("season:"));
  }

  // --- Tick integration: season ranking picks, non-seasonal override holds ---
  {
    const OUT = "/tmp/digital-seasons-test-tick";
    rmSync(OUT, { recursive: true, force: true });
    const briefs = [
      brief("s1", "template", "wedding", "Wedding invitation pack", 60),
      brief("s2", "ebook", "fitness", "Fitness workout log", 90),
      brief("s3", "planner", "wedding", "Wedding planner", 70),
    ];
    mkdirSync(join(OUT, "briefs"), { recursive: true });
    writeFileSync(join(OUT, "briefs", "latest.json"), JSON.stringify({ briefs, analysis: {}, minedAt: "2026-11-16T01:30:00Z", warnings: [] }), "utf-8");
    const savedBase = process.env.N8N_BASE_URL;
    const savedSecret = process.env.N8N_WEBHOOK_SECRET;
    process.env.N8N_BASE_URL = "http://n8n:5678";
    process.env.N8N_WEBHOOK_SECRET = "test-secret";
    const calls: Array<{ url: string }> = [];
    const fetchFn = (async (url: unknown) => {
      calls.push({ url: String(url) });
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as FetchFn;
    const r = await runAutoGenerateTick({ fetchFn, outRoot: OUT, now: new Date("2026-11-16T02:30:00Z") });
    check("tick ok with seasons", r.ok === true);
    check("tick reports active seasons", r.seasons.join(",") === "wedding,new-year", r.seasons.join(","));
    check("tick pick order: seasonal 95, non-seasonal 90, seasonal 85", JSON.stringify(r.briefs) === JSON.stringify(["s3", "s2", "s1"]), JSON.stringify(r.briefs));
    const s1 = r.fires.find((f) => f.briefId === "s1" && f.kind === "product");
    check("seasonal brief ledger entry carries season + score", s1?.season === "wedding" && s1?.score === 85, JSON.stringify(s1));
    const s2 = r.fires.find((f) => f.briefId === "s2" && f.kind === "product");
    check("non-seasonal brief ledger entry has no season", s2?.season === undefined && s2?.score === 90, JSON.stringify(s2));
    if (savedBase === undefined) delete process.env.N8N_BASE_URL;
    else process.env.N8N_BASE_URL = savedBase;
    if (savedSecret === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    else process.env.N8N_WEBHOOK_SECRET = savedSecret;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-SEASONS TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
