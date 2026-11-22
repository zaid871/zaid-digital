/**
 * test-digital-faq: auto-FAQ generator.
 * Run: npx tsx scripts/test-digital-faq.ts
 */
import { generateFaq } from "../src/lib/digital/faq";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const INPUT = { productName: "Sehatmand Nashta Guide", productType: "ebook" as const, about: ["30 recipes", "15 min each"] };

const FULL = JSON.stringify({
  faqs: [
    { q: "Isme kya hai?", a: "30 quick nashta recipes." },
    { q: "Kitna time lagega?", a: "Har recipe 15 minute me." },
  ],
});

const VIOLATING = JSON.stringify({
  faqs: [
    { q: "Kya ye #1 guide hai?", a: "Haan best hai." }, // banned -> dropped
    { q: "Price kya hai?", a: "Sirf ₹499." }, // price -> dropped
    { q: "Kaun use kar sakta hai?", a: "Busy log." },
  ],
});

async function main() {
  const full = await generateFaq(INPUT, async () => FULL);
  check("ai faqs kept", full.items.length === 5, `got ${full.items.length}`); // 2 AI + 3 support
  check("support faqs appended", full.items[2].q === "Download kaise karun?");
  check("format answer per type", full.items[3].a.includes("PDF"));
  check("no warnings on clean", full.warnings.length === 0);

  const pod = await generateFaq({ productName: "Tee", productType: "pod" }, async () => FULL);
  check("pod format answer", pod.items[3].a.includes("Printify"));

  const bad = await generateFaq(INPUT, async () => VIOLATING);
  check("violating items dropped", bad.items.length === 4, `got ${bad.items.length}`); // 1 AI + 3 support
  check("warnings recorded", bad.warnings.length === 2);

  try {
    await generateFaq(INPUT, async () => "garbage");
    check("garbage hard-errors", false);
  } catch (e) {
    check("garbage hard-errors", e instanceof DigitalError && e.code === "generation_failed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
