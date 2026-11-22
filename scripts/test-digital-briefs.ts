/**
 * Digital briefs tests: miner latest.json (seeded) -> ranked briefs with
 * kind/theme mapping, catalog gap, uniqueness angles (AI + bank fallback),
 * trend/gap analysis. The seed latest.json is written to
 * storage/problem-miner/ for the test and removed afterwards.
 * Run: npx tsx scripts/test-digital-briefs.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  adSummaryToInput,
  formatProofList,
  runFourDFilter,
  scoreThreeSignals,
  type FourDInput,
  type ThreeSignalInput,
} from "../src/lib/digital/briefs";
import { generateBriefs } from "../src/lib/digital/briefs";
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

const LATEST_PATH = join(process.cwd(), "storage", "problem-miner", "latest.json");
const BRIEFS_PATH = join(process.cwd(), "storage", "digital", "briefs", "latest.json");

const SEED = {
  problems: [
    { text: "How do I make a monthly budget that actually works?", score: 82, niche: "budgeting", source: "reddit", trend: "rising" },
    { text: "I'm struggling to track my expenses every month", score: 74, niche: "budgeting", source: "google-suggest", trend: "rising" },
    { text: "Wish there was a simple wedding invitation card maker", score: 68, niche: "wedding cards", source: "google-suggest", trend: "stable" },
    { text: "How do I plan my study timetable for exams?", score: 61, niche: "study planning", source: "youtube-suggest", trend: "stable" },
  ],
  risingQueries: { budgeting: ["monthly budget template", "budget planner printable"] },
  scannedAt: "2026-11-08T00:00:00.000Z",
  niches: ["budgeting", "wedding cards", "study planning"],
};

function seedMiner() {
  mkdirSync(join(process.cwd(), "storage", "problem-miner"), { recursive: true });
  writeFileSync(LATEST_PATH, JSON.stringify(SEED, null, 2), "utf-8");
}

async function main() {
  const hadLatest = existsSync(LATEST_PATH) ? readFileSync(LATEST_PATH, "utf-8") : null;
  try {
    seedMiner();

    // 1. Bank fallback (textGen throws): mapping + gap + bank angles.
    const throwingGen: TextGen = async () => {
      throw new Error("no keys");
    };
    const r = await generateBriefs({ productTypes: ["template", "ebook"], maxBriefs: 4, useAi: true }, { textGen: throwingGen });
    check("briefs produced with bank fallback", r.briefs.length === 4, `got ${r.briefs.length}`);
    const budget = r.briefs.find((b) => b.niche === "budgeting" && b.productType === "template");
    check(
      "budgeting maps to chart/table + forest",
      !!budget && budget.kinds?.includes("chart") === true && budget.kinds?.includes("table") === true && budget.theme === "forest",
      JSON.stringify(budget?.kinds) + "/" + budget?.theme
    );
    const wedding = r.briefs.find((b) => b.niche === "wedding cards");
    check(
      "wedding maps to event + wine",
      !!wedding && wedding.kinds?.includes("event") === true && wedding.theme === "wine",
      JSON.stringify(wedding?.kinds) + "/" + wedding?.theme
    );
    check("budgeting trend is rising", budget?.trend === "rising");
    check("gap says no pack yet", (budget?.gap ?? "").includes("koi pack nahi"));
    check(
      "bank uniqueness angles present",
      r.briefs.every((b) => b.uniqueness.length === 2),
      r.briefs.map((b) => b.uniqueness.length).join(",")
    );
    check("ai fallback warning recorded", r.warnings.some((w) => w.includes("ai_angles_fallback")));
    check("analysis topKinds has chart", r.analysis.topKinds.some((k) => k.kind === "chart"));
    check("analysis rising queries kept", r.analysis.risingQueries.includes("monthly budget template"));
    check("briefs queue written", existsSync(BRIEFS_PATH));

    // 2. AI path: stub returns JSON angles + ebook outline.
    const aiGen: TextGen = async (prompt) => {
      const n = (prompt.match(/^\d+\. niche=/gm) ?? []).length;
      const arr = Array.from({ length: n }, (_, i) => ({
        uniqueness: [`AI angle ${i + 1}a`, `AI angle ${i + 1}b`],
        outline: ["Ch 1", "Ch 2", "Ch 3", "Ch 4", "Ch 5"],
      }));
      return `Here you go: ${JSON.stringify(arr)}`;
    };
    const r2 = await generateBriefs({ productTypes: ["template", "ebook"], maxBriefs: 5, useAi: true }, { textGen: aiGen });
    const ebook = r2.briefs.find((b) => b.productType === "ebook");
    check("ebook brief exists", !!ebook);
    check(
      "AI uniqueness angles used",
      !!ebook && ebook.uniqueness.some((u) => u.startsWith("AI angle")),
      ebook?.uniqueness.join(" | ") ?? ""
    );
    check(
      "AI ebook outline used",
      !!ebook && (ebook.ebookOutline ?? []).length === 5 && (ebook.ebookOutline ?? [])[0] === "Ch 1",
      (ebook?.ebookOutline ?? []).join(",")
    );
    check("no fallback warning on AI success", !r2.warnings.some((w) => w.includes("ai_angles_fallback")));

    // 3. Compliance: AI angle with a price is dropped, bank angle fills in.
    const badGen: TextGen = async () => JSON.stringify([{ uniqueness: ["Only $5 today", "Clean angle here"] }]);
    const r3 = await generateBriefs({ productTypes: ["template"], maxBriefs: 1, useAi: true }, { textGen: badGen });
    check(
      "price angle dropped",
      r3.briefs.length === 1 && !r3.briefs[0].uniqueness.join(" ").includes("$5"),
      r3.briefs[0]?.uniqueness.join(" | ") ?? ""
    );
    check("brief still has 2 angles after drop", r3.briefs[0]?.uniqueness.length === 2);

    // 4. Bestseller integration: manual competitor + style profile + market gap.
    const r3b = await generateBriefs(
      {
        productTypes: ["template"],
        maxBriefs: 2,
        useAi: true,
        includeYouTube: false,
        competitors: [{ title: "Ultimate Budget Planner Bundle — 50 pages", source: "Etsy", note: "10k sold" }],
      },
      { textGen: aiGen }
    );
    const bBrief = r3b.briefs.find((b) => b.niche === "budgeting" && b.productType === "template");
    check("brief has style profile", !!bBrief?.styleProfile?.includes("bundle"), bBrief?.styleProfile ?? "");
    check("brief has market gap", !!bBrief?.marketGap?.length, bBrief?.marketGap ?? "");
    check(
      "manual competitor in bestseller evidence",
      !!bBrief?.bestsellerEvidence?.some((e) => e.includes("Ultimate Budget Planner Bundle")),
      (bBrief?.bestsellerEvidence ?? []).join(" | ")
    );
    check("uniqueness still 2 with bestseller lane", bBrief?.uniqueness.length === 2);

    // 5. Miner hasn't run: empty briefs + warning, no throw.
    rmSync(LATEST_PATH, { force: true });
    const r4 = await generateBriefs({ productTypes: ["template"], maxBriefs: 4 });
    check("not mined -> empty briefs", r4.briefs.length === 0);
    check("not mined warning recorded", r4.warnings.some((w) => w.includes("not_mined_yet")));
  } finally {
    if (hadLatest !== null) writeFileSync(LATEST_PATH, hadLatest, "utf-8");
    else rmSync(LATEST_PATH, { force: true });
  }

    // --- Winning-product validation: Three Signal Test (Utkarsh Gose) ---

  // Strong: all three pass (45 days, 15 versions, 6 sellers).
  {
    const r = scoreThreeSignals({ adAgeDays: 45, versionCount: 15, sellerCount: 6 });
    check("strong: 45d + 15 versions + 6 sellers", r.verdict === "strong" && r.score === 6, `${r.verdict}/${r.score}`);
    check("strong: all three pass", r.signals.every((s) => s.status === "pass"));
  }

  // Moderate: 2 pass + 1 fail (no crowd signal).
  {
    const r = scoreThreeSignals({ adAgeDays: 45, versionCount: 15, sellerCount: 1 });
    check("moderate: crowd fail drops it to 4/6", r.verdict === "moderate" && r.score === 4, `${r.verdict}/${r.score}`);
  }

  // Weak: nothing running long, no versions, no sellers.
  {
    const r = scoreThreeSignals({ adAgeDays: 3, versionCount: 1, sellerCount: 1 });
    check("weak: 3d + 1 version + 1 seller", r.verdict === "weak" && r.score === 0, `${r.verdict}/${r.score}`);
  }

  // Saturated: 500 sellers overrides strong time + versions.
  {
    const r = scoreThreeSignals({ adAgeDays: 90, versionCount: 20, sellerCount: 500 });
    check("saturated: 500 sellers = too late", r.verdict === "saturated", r.verdict);
    check("saturated: crowd signal is fail", r.signals.find((s) => s.signal === "crowd")?.status === "fail");
  }

  // Partials: 10 days + 5 versions + 50 sellers = 3/6 → weak.
  {
    const r = scoreThreeSignals({ adAgeDays: 10, versionCount: 5, sellerCount: 50 });
    check("partials: 10d + 5v + 50s = 3/6 weak", r.verdict === "weak" && r.score === 3, `${r.verdict}/${r.score}`);
    check("partials: all three partial", r.signals.every((s) => s.status === "partial"));
  }

  // Time boundaries: 6 fail, 7 partial, 29 partial, 30 pass.
  {
    const t = (d: number) => scoreThreeSignals({ adAgeDays: d, versionCount: 0, sellerCount: 0 }).signals[0].status;
    check("time: 6d fail", t(6) === "fail");
    check("time: 7d partial", t(7) === "partial");
    check("time: 29d partial", t(29) === "partial");
    check("time: 30d pass", t(30) === "pass");
  }

  // Versions boundaries: 2 fail, 3 partial, 9 partial, 10 pass.
  {
    const v = (n: number) => scoreThreeSignals({ adAgeDays: 0, versionCount: n, sellerCount: 0 }).signals[1].status;
    check("versions: 2 fail", v(2) === "fail");
    check("versions: 3 partial", v(3) === "partial");
    check("versions: 9 partial", v(9) === "partial");
    check("versions: 10 pass", v(10) === "pass");
  }

  // Crowd boundaries: 0 fail, 2 pass, 20 pass, 21 partial, 499 partial.
  {
    const c = (n: number) => scoreThreeSignals({ adAgeDays: 0, versionCount: 0, sellerCount: n }).signals[2].status;
    check("crowd: 0 fail", c(0) === "fail");
    check("crowd: 2 pass", c(2) === "pass");
    check("crowd: 20 pass", c(20) === "pass");
    check("crowd: 21 partial", c(21) === "partial");
    check("crowd: 499 partial", c(499) === "partial");
  }

  // Custom saturation cap: 100 sellers saturates when cap is 100.
  {
    const r = scoreThreeSignals({ adAgeDays: 45, versionCount: 15, sellerCount: 100, saturationCap: 100 });
    check("custom cap: 100 sellers saturates at cap 100", r.verdict === "saturated", r.verdict);
  }

  // Negative / garbage inputs clamp to 0, never crash.
  {
    const r = scoreThreeSignals({ adAgeDays: -5, versionCount: NaN, sellerCount: -1 } as ThreeSignalInput);
    check("clamp: negative/NaN inputs → weak, no crash", r.verdict === "weak" && r.score === 0, `${r.verdict}/${r.score}`);
  }

  // adSummaryToInput: null with no ads, mapping otherwise.
  {
    check("adSummaryToInput: null when no oldest ad", adSummaryToInput({ oldestAdAgeDays: null, versionCount: 0, sellerCount: 0 }) === null);
    const in1 = adSummaryToInput({ oldestAdAgeDays: 40, versionCount: 12, sellerCount: 6 });
    check("adSummaryToInput: maps fields", in1 !== null && in1.adAgeDays === 40 && in1.versionCount === 12 && in1.sellerCount === 6);
  }

  // Proof List: evidence lines + 10-idea cap.
  {
    const items = Array.from({ length: 12 }, (_, i) => ({
      idea: `Idea ${i + 1}`,
      result: scoreThreeSignals({ adAgeDays: 45, versionCount: 15, sellerCount: 6 }),
    }));
    const list = formatProofList(items);
    check("proof list: carries idea + verdict", list.includes("Idea 1") && list.includes("STRONG"));
    check("proof list: carries signal evidence", list.includes("time: pass") && list.includes("crowd: pass"));
    check("proof list: capped at 10 ideas", list.includes("10. Idea 10") && !list.includes("11. Idea 11"));
  }

  

  // --- Winning-product validation: 4D Filter (Utkarsh Gose) ---
  const yes = (reason: string) => ({ score: 1, reason });
  const no = (reason: string) => ({ score: 0, reason });

  // 4/4 → proceed.
  {
    const r = runFourDFilter({ dard: yes("hurts now"), demo: yes("5s before/after"), daam: yes("math works"), delivery: yes("one week") });
    check("4/4 → proceed", r.verdict === "proceed" && r.passes === 4, `${r.verdict}/${r.passes}`);
    check("proceed guidance says proceed", r.guidance.includes("proceed"));
  }

  // 3/4 → fix the weak one (delivery).
  {
    const r = runFourDFilter({ dard: yes("hurts now"), demo: yes("5s demo"), daam: yes("math works"), delivery: no("needs a month to build") });
    check("3/4 → fix_weak", r.verdict === "fix_weak" && r.passes === 3, `${r.verdict}/${r.passes}`);
    check("weakest is delivery", r.weakest === "delivery" && r.weakestScore === 0);
    check("guidance targets delivery", r.guidance.includes("Delivery") || r.guidance.includes("ONE WEEK"));
  }

  // 2/4 → reconsider.
  {
    const r = runFourDFilter({ dard: yes("hurts now"), demo: yes("5s demo"), daam: no("ads eat the margin"), delivery: no("needs a month") });
    check("2/4 → reconsider", r.verdict === "reconsider" && r.passes === 2, `${r.verdict}/${r.passes}`);
  }

  // 0/4 → reconsider.
  {
    const r = runFourDFilter({ dard: no("someday problem"), demo: no("cannot show"), daam: no("no margin"), delivery: no("cannot build") });
    check("0/4 → reconsider", r.verdict === "reconsider" && r.passes === 0, `${r.verdict}/${r.passes}`);
  }

  // Graded scores: 0.8/0.6/0.4/0.9 → 3 pass, weakest is daam.
  {
    const r = runFourDFilter({
      dard: { score: 0.8, reason: "hurts now" },
      demo: { score: 0.6, reason: "demo possible" },
      daam: { score: 0.4, reason: "thin margin" },
      delivery: { score: 0.9, reason: "one week" },
    });
    check("graded: 3 pass, weakest daam", r.verdict === "fix_weak" && r.weakest === "daam" && r.weakestScore === 0.4, `${r.verdict}/${r.weakest}`);
    check("graded: per-D reasons kept", r.perD.find((d) => d.key === "daam")?.reason === "thin margin");
  }

  // Threshold is inclusive: all 0.5 → 4 pass → proceed.
  {
    const r = runFourDFilter({
      dard: { score: 0.5, reason: "borderline" },
      demo: { score: 0.5, reason: "borderline" },
      daam: { score: 0.5, reason: "borderline" },
      delivery: { score: 0.5, reason: "borderline" },
    });
    check("threshold inclusive: 0.5 counts as pass", r.verdict === "proceed" && r.passes === 4, `${r.verdict}/${r.passes}`);
  }

  // Tie for weakest: first in Dard → Demo → Daam → Delivery order wins.
  {
    const r = runFourDFilter({ dard: no("a"), demo: no("b"), daam: yes("c"), delivery: yes("d") });
    check("tie: weakest is first in order (dard)", r.weakest === "dard", r.weakest);
  }

  // Out-of-range scores clamp; garbage → 0.
  {
    const input = { dard: { score: 5, reason: "x" }, demo: { score: -2, reason: "x" }, daam: { score: NaN, reason: "x" }, delivery: { score: 1, reason: "x" } } as FourDInput;
    const r = runFourDFilter(input);
    check("clamp: 5→1, -2→0, NaN→0", r.passes === 2 && r.perD.find((d) => d.key === "dard")?.score === 1, `${r.passes}`);
  }

  

console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("SOME DIGITAL-BRIEFS TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL DIGITAL-BRIEFS TESTS PASSED");
}

main();
