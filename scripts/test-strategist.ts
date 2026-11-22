/**
 * test-strategist: Universal Marketing Strategist.
 * Mock textGen; deterministic playbook verified across product kinds.
 * Run: npx tsx scripts/test-strategist.ts
 */
import { buildPlan } from "../src/lib/marketing/strategist";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const MOCK_OK = JSON.stringify({
  angles: ["Subah ki bhaag-daud khatam", "Sirf ₹499 me pao", "15 minute me taiyaar nashta"],
  hooks: ["Ye galti mat karo", "99% log isme fail hote hain", "Best #1 tarika"],
});

const BASE = {
  productName: "Nashta Guide",
  kind: "digital_product" as const,
  priceBand: "low" as const,
  audience: "busy professionals",
  marketBreadth: "broad" as const,
  goal: "sales" as const,
  assets: { hasVideo: true, hasLanding: true, hasEmail: false },
  features: ["30 recipes"],
};

async function main() {
  // broad digital product
  const p1 = await buildPlan(BASE, async () => MOCK_OK);
  check("channel queue non-empty", p1.channelQueue.length >= 3);
  check("broad → reels first", p1.channelQueue[0] === "reels_shorts", p1.channelQueue.join(","));
  check("5 stages", p1.stages.length === 5 && p1.stages[0].stage === "validate");
  check("validate always first", p1.stages[0].channels.includes("presell_gate"));
  // price + #1 claim dropped from angles/hooks
  check("violating angle dropped", p1.angles.length === 2 && !p1.angles.join().includes("₹"));
  check("violating hook dropped", p1.hooks.length === 2);
  check("warnings recorded", p1.warnings.length >= 2);

  // micro market, low price → communities first (no trust override)
  const p2 = await buildPlan({ ...BASE, marketBreadth: "micro" }, async () => MOCK_OK);
  check("micro → communities first", p2.channelQueue[0] === "reddit_communities", p2.channelQueue.join(","));
  // micro + high-ticket service → trust reorder wins (correct: nobody buys ₹5k+ from a comment)
  const p2b = await buildPlan({ ...BASE, marketBreadth: "micro", kind: "service", priceBand: "high" }, async () => MOCK_OK);
  check("micro high-ticket → trust first", p2b.channelQueue[0] === "youtube_tutorials", p2b.channelQueue.join(","));
  check("micro tactics include outreach",
    p2.stages.some((s) => s.tactics.some((t) => t.includes("Direct outreach"))));

  // high-ticket → trust reorder
  const p3 = await buildPlan({ ...BASE, priceBand: "high", kind: "service" }, async () => MOCK_OK);
  check("high-ticket → youtube first", p3.channelQueue[0] === "youtube_tutorials", p3.channelQueue.join(","));

  // affiliate → seo + warning
  const p4 = await buildPlan({ ...BASE, kind: "affiliate" }, async () => MOCK_OK);
  check("affiliate gets seo", p4.channelQueue.includes("seo_articles"));
  check("affiliate sales warning", p4.warnings.some((w) => w.includes("buyer-intent")));

  // no email → email channel removed
  check("no email asset → nurture removed", !p1.channelQueue.includes("email_nurture"));

  // agency namespacing
  const p5 = await buildPlan({ ...BASE, client: "Sharma Sweets" }, async () => MOCK_OK);
  check("client namespace", p5.productKey === "Sharma Sweets:Nashta Guide");

  // LLM failure → plan still stands
  const p6 = await buildPlan(BASE, async () => { throw new DigitalError("provider_unavailable", "down"); });
  check("llm fail → structure intact", p6.channelQueue.length >= 3 && p6.stages.length === 5);
  check("llm fail → warning", p6.warnings.some((w) => w.includes("unavailable")));

  // validation
  try {
    await buildPlan({ ...BASE, productName: "x" }, async () => MOCK_OK);
    check("bad brief rejected", false);
  } catch { check("bad brief rejected", true); }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
