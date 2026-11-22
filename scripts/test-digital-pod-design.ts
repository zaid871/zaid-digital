/**
 * test-digital-pod-design: E2S design filter + POD pricing guide +
 * supplier ladder (Nishkarsh Sharma POD playbook transfer).
 * Run: npx tsx scripts/test-digital-pod-design.ts
 */
import { scoreE2S, podPricingGuide, supplierLadder } from "../src/lib/digital/pod-design";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

async function main() {
  // --- E2S: pass cases ---
  const good = scoreE2S({ niche: "fishing", designText: "Don't Quit Fishing" });
  check("E2S pass: 3-word text + specific niche", good.passed && good.score === 6, JSON.stringify(good));

  const oneWord = scoreE2S({ niche: "teachers", designText: "Fearless" });
  check("E2S pass: 1-word text + specific niche (5/6)", oneWord.passed && oneWord.score === 5, JSON.stringify(oneWord));

  const graphic = scoreE2S({ niche: "gym" });
  check("E2S pass: graphic-only + specific niche (4/6, visual warning)",
    graphic.passed && graphic.score === 4 && graphic.warnings.length > 0, JSON.stringify(graphic));

  // --- E2S: fail cases ---
  const broad = scoreE2S({ niche: "cool", designText: "Stay Strong" });
  check("E2S fail: too-broad niche", !broad.passed && broad.dimensions.S.score === 0, JSON.stringify(broad));

  const everyone = scoreE2S({ niche: "everyone", designText: "Be Happy" });
  check("E2S fail: 'everyone' niche", !everyone.passed && everyone.reasons.some((r) => r.includes("E2S-S")), JSON.stringify(everyone));

  const longText = scoreE2S({ niche: "fishing", designText: "This is a very long sentence that nobody can read on a shirt" });
  check("E2S fail: 5+ word text", !longText.passed && longText.dimensions.two.score === 0, JSON.stringify(longText));

  const over40 = scoreE2S({ niche: "fishing", designText: "A".repeat(41) });
  check("E2S fail: text over 40 chars", !over40.passed && over40.dimensions.E.score === 0, JSON.stringify(over40));

  const emptyNiche = scoreE2S({ niche: "  ", designText: "Stay Strong" });
  check("E2S fail: empty niche", !emptyNiche.passed && emptyNiche.dimensions.S.score === 0, JSON.stringify(emptyNiche));

  // --- E2S: reasons are actionable ---
  check("E2S fail carries reasons", broad.reasons.length > 0 && broad.reasons[0].includes("E2S-S"), broad.reasons.join(" | "));

  // --- Pricing guide: India ---
  const inGuide = podPricingGuide("in");
  check("IN guide: base 350-450", inGuide.baseCost?.[0] === 350 && inGuide.baseCost?.[1] === 450, JSON.stringify(inGuide.baseCost));
  check("IN guide: sell 800-1200, start 799, settle 899",
    inGuide.sell[0] === 800 && inGuide.sell[1] === 1200 && inGuide.start === 799 && inGuide.settle === 899,
    JSON.stringify(inGuide));
  check("IN guide: size-tier bump 50-100", inGuide.sizeTierBump?.[0] === 50 && inGuide.sizeTierBump?.[1] === 100, JSON.stringify(inGuide.sizeTierBump));
  check("IN guide: compare-at is ALWAYS null (no fake discount)", inGuide.compareAt === null, String(inGuide.compareAt));

  // --- Pricing guide: international ---
  const intlGuide = podPricingGuide("intl");
  check("INTL guide: USD, sell 20-30, start 25",
    intlGuide.currency === "USD" && intlGuide.sell[0] === 20 && intlGuide.sell[1] === 30 && intlGuide.start === 25,
    JSON.stringify(intlGuide));
  check("INTL guide: base cost null (verify at draft, never invented)", intlGuide.baseCost === null, String(intlGuide.baseCost));
  check("INTL guide: compare-at null", intlGuide.compareAt === null, String(intlGuide.compareAt));

  // --- Supplier ladder ---
  const s0 = supplierLadder(0);
  check("ladder stage 0 at 0 sales", s0.stage === 0 && s0.supplier === "Printify", JSON.stringify(s0));
  const s9 = supplierLadder(9);
  check("ladder stage 0 at 9 sales", s9.stage === 0, JSON.stringify(s9));
  const s10 = supplierLadder(10);
  check("ladder stage 1 at 10 sales", s10.stage === 1, JSON.stringify(s10));
  const s49 = supplierLadder(49);
  check("ladder stage 1 at 49 sales", s49.stage === 1, JSON.stringify(s49));
  const s50 = supplierLadder(50);
  check("ladder stage 2 at 50 sales", s50.stage === 2 && s50.supplier.includes("Qikink"), JSON.stringify(s50));
  const sNeg = supplierLadder(-5);
  check("ladder clamps negative sales to 0", sNeg.stage === 0, JSON.stringify(sNeg));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
