/**
 * test-digital-sales-copy: sales-page copy generator.
 * Mock textGen: full pack kept, violating fields dropped (never replaced),
 * garbage -> hard error.
 * Run: npx tsx scripts/test-digital-sales-copy.ts
 */
import { generateSalesCopy } from "../src/lib/digital/sales-copy";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const INPUT = {
  productName: "Sehatmand Nashta Guide",
  productType: "ebook" as const,
  features: ["30 quick recipes", "shopping lists"],
};

const FULL = JSON.stringify({
  headline: "Subah ki bhaag-daud khatam",
  subheadline: "30 quick nashta recipes jo 15 minute me taiyaar",
  problemSection: "Roz subah nashta skip karte ho? Ye guide tumhara routine badal degi.",
  outcomeBullets: ["15 minute me nashta", " Hafte bhar ka plan"],
  insideList: ["30 recipes", "Shopping lists"],
  whoIsItFor: "Busy professionals ke liye",
  ctaLine: "Abhi download karo",
  trustLine: "30 recipes, shopping lists included — sab kuch andar hai",
  objectionAnswers: ["Q: Beginner ke liye hai? A: Haan, step by step hai."],
  riskNote: "Andar 30 recipes aur lists hain; ye diet plan nahi hai.",
});

const VIOLATING = JSON.stringify({
  headline: "Sirf ₹499 me pao", // price -> dropped
  subheadline: "Best guide #1 choice", // banned claim -> dropped
  problemSection: "Subah ka time bachao.",
  outcomeBullets: ["15 minute me nashta", "100% guaranteed results"], // banned -> dropped item
  insideList: ["30 recipes"],
  whoIsItFor: "Sab ke liye",
  ctaLine: "Abhi lo",
});

// Psychology-only violations: the base PRICE/BANNED patterns miss these,
// the buyer-psychology scanner must catch them.
const PSYCH_VIOLATING = JSON.stringify({
  headline: "Subah ki bhaag-daud khatam",
  subheadline: "30 quick nashta recipes jo 15 minute me taiyaar",
  problemSection: "Roz subah nashta skip karte ho?",
  outcomeBullets: ["15 minute me nashta"],
  insideList: ["30 recipes"],
  whoIsItFor: "Busy professionals ke liye",
  ctaLine: "Abhi download karo",
  trustLine: "Hurry, only today — before midnight!", // fake urgency -> dropped
  objectionAnswers: ["Q: Kitne bache hain? A: Only 3 left in stock."], // fake scarcity -> dropped item
  riskNote: "Sab se best guide in India.", // false superlative -> dropped
});

async function main() {
  // 1. full pack kept
  const full = await generateSalesCopy(INPUT, async () => FULL);
  check("full headline kept", full.headline === "Subah ki bhaag-daud khatam");
  check("bullets kept", full.outcomeBullets.length === 2);
  check(
    "psychology fields kept",
    full.trustLine !== null &&
      full.objectionAnswers.length === 1 &&
      full.riskNote !== null,
  );
  check("no warnings on clean", full.warnings.length === 0, JSON.stringify(full.warnings));

  // 2. violating fields dropped, never replaced
  const bad = await generateSalesCopy(INPUT, async () => VIOLATING);
  check("price headline dropped", bad.headline === null);
  check("banned subheadline dropped", bad.subheadline === null);
  check("banned bullet item dropped", bad.outcomeBullets.length === 1 && bad.outcomeBullets[0] === "15 minute me nashta");
  check("warnings recorded", bad.warnings.length === 3, JSON.stringify(bad.warnings));
  check("clean fields survive", bad.problemSection !== null && bad.ctaLine === "Abhi lo");

  // 2b. psychology-only violations dropped by the new scanner
  const psych = await generateSalesCopy(INPUT, async () => PSYCH_VIOLATING);
  check("fake-urgency trustLine dropped", psych.trustLine === null);
  check("fake-scarcity objection dropped", psych.objectionAnswers.length === 0);
  check("false-superlative riskNote dropped", psych.riskNote === null);
  check("psychology warnings recorded", psych.warnings.length === 3, JSON.stringify(psych.warnings));
  check("psych clean fields survive", psych.headline !== null && psych.ctaLine === "Abhi download karo");

  // 3. garbage -> hard error
  try {
    await generateSalesCopy(INPUT, async () => "ye koi json nahi hai");
    check("garbage hard-errors", false);
  } catch (e) {
    check("garbage hard-errors", e instanceof DigitalError && e.code === "generation_failed");
  }

  // 4. validation
  try {
    await generateSalesCopy({ productName: "x", productType: "ebook" }, async () => FULL);
    check("short name rejected", false);
  } catch (e) {
    check("short name rejected", e instanceof DigitalError && e.code === "validation_error");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
