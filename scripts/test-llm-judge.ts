/**
 * LLM-judge tests: opinions map correctly, garbage -> unavailable, and
 * the judge can NEVER approve (the type forbids it).
 * Run: npx tsx scripts/test-llm-judge.ts
 */
import { judgeNeedsReview, type JudgeTextGen } from "../src/lib/pipeline/llm-judge";

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

const INPUT = {
  failedChecks: [{ name: "content/hook-early", detail: "first cue at 1.4s, limit 1.0s" }],
  narrations: ["Ye mixer har kaam asaan kar deta hai."],
  productCategory: "kitchen",
};

async function main() {
  {
    const gen: JudgeTextGen = async () =>
      JSON.stringify({
        opinion: "confirm_flag",
        rationale: "The hook-early flag looks right.",
        suggestedFix: "Move the hook line earlier.",
      });
    const r = await judgeNeedsReview(INPUT, gen);
    check("confirm_flag parsed", r.opinion === "confirm_flag");
    check("rationale + fix carried", r.rationale.includes("hook-early") && r.suggestedFix === "Move the hook line earlier.");
  }
  {
    const gen: JudgeTextGen = async () =>
      JSON.stringify({ opinion: "escalate_reject", rationale: "Narration hides a guarantee.", suggestedFix: null });
    const r = await judgeNeedsReview(INPUT, gen);
    check("escalate_reject parsed", r.opinion === "escalate_reject" && r.suggestedFix === null);
  }
  {
    const gen: JudgeTextGen = async () => "ye koi JSON nahi";
    const r = await judgeNeedsReview(INPUT, gen);
    check("garbage -> unavailable", r.opinion === "unavailable");
  }
  {
    const gen: JudgeTextGen = async () => {
      throw new Error("provider down");
    };
    const r = await judgeNeedsReview(INPUT, gen);
    check("provider failure -> unavailable, never throws", r.opinion === "unavailable");
  }
  {
    // Even a model that tries to approve gets mapped to unavailable.
    const gen: JudgeTextGen = async () =>
      JSON.stringify({ opinion: "approve", rationale: "looks fine" });
    const r = await judgeNeedsReview(INPUT, gen);
    check("'approve' output rejected -> unavailable", r.opinion === "unavailable");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL LLM-JUDGE TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
