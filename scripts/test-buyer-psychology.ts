/**
 * test-buyer-psychology: ethical buyer-psychology copy patterns.
 * Pattern list sanity + banned-pattern scanner (fake urgency/scarcity,
 * invented social proof, guaranteed outcomes, false superlatives) +
 * prompt sections for sales copy and video scripts.
 * Run: npx tsx scripts/test-buyer-psychology.ts
 */
import {
  BANNED_PSYCHOLOGY_PATTERNS,
  BUYER_PSYCHOLOGY_PATTERNS,
  SALES_COPY_PSYCHOLOGY_LINES,
  SCRIPT_PSYCHOLOGY_LINES,
  psychologyPromptSection,
  scanPsychologyViolations,
  violatesPsychology,
} from "../src/lib/digital/buyer-psychology";

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

function has(text: string, id: string): boolean {
  return scanPsychologyViolations(text).includes(id);
}

async function main() {
  // 1. pattern list sanity
  check("6 ethical patterns", BUYER_PSYCHOLOGY_PATTERNS.length === 6);
  const ids = BUYER_PSYCHOLOGY_PATTERNS.map((p) => p.id);
  check("pattern ids unique", new Set(ids).size === ids.length);
  check(
    "every pattern has guidance + audience",
    BUYER_PSYCHOLOGY_PATTERNS.every(
      (p) => p.promptGuidance.length > 20 && p.appliesTo.length > 0,
    ),
  );
  check(
    "all 6 patterns apply to sales copy",
    BUYER_PSYCHOLOGY_PATTERNS.every((p) =>
      p.appliesTo.includes("sales_copy"),
    ),
  );

  // 2. banned list sanity
  const bannedIds = BANNED_PSYCHOLOGY_PATTERNS.map((b) => b.id);
  for (const id of [
    "fake_urgency",
    "fake_scarcity",
    "fake_social_proof",
    "guaranteed_outcome",
    "false_superlative",
  ]) {
    check(`banned pattern present: ${id}`, bannedIds.includes(id));
  }

  // 3. scanner catches each trick (psychology-only: base patterns miss these)
  check(
    "fake urgency caught",
    has("Hurry, only today — before midnight!", "fake_urgency"),
  );
  check(
    "fake scarcity caught",
    has("Only 3 left in stock, almost sold out!", "fake_scarcity"),
  );
  check(
    "fake social proof caught",
    has(
      "Join 10,000+ happy customers, see our testimonials!",
      "fake_social_proof",
    ),
  );
  check(
    "guaranteed outcome caught",
    has("100% guaranteed results, earn ₹50,000!", "guaranteed_outcome"),
  );
  check(
    "false superlative caught",
    has("The #1 best guide in India, sab se best!", "false_superlative"),
  );

  // 4. clean copy passes
  check(
    "clean copy passes",
    scanPsychologyViolations(
      "30 quick recipes with shopping lists included",
    ).length === 0,
  );
  check(
    "violatesPsychology false on clean",
    violatesPsychology("Beginner ke liye hai, step by step hai.") === false,
  );
  check(
    "violatesPsychology true on trick",
    violatesPsychology("Only 3 left — hurry!") === true,
  );

  // 5. prompt sections
  const salesJoined = SALES_COPY_PSYCHOLOGY_LINES.join("\n");
  for (const name of [
    "Value first",
    "Trust from verified facts only",
    "Objection handling",
    "Honest risk reversal",
    "10-second clarity",
    "Verified specificity",
  ]) {
    check(`sales section has pattern: ${name}`, salesJoined.includes(name));
  }
  const scriptJoined = SCRIPT_PSYCHOLOGY_LINES.join("\n");
  check(
    "script section leads with value",
    scriptJoined.includes("VALUE first"),
  );
  check(
    "script section has trust rule",
    scriptJoined.includes("verified facts"),
  );
  check(
    "script section answers a doubt",
    scriptJoined.includes("doubt"),
  );
  check(
    "psychologyPromptSection routes correctly",
    psychologyPromptSection("sales_copy") === SALES_COPY_PSYCHOLOGY_LINES &&
      psychologyPromptSection("script") === SCRIPT_PSYCHOLOGY_LINES,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
