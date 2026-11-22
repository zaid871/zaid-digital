/**
 * test-seo-article: SEO article generator (mocked, 2 calls).
 * Run: npx tsx scripts/test-seo-article.ts
 */
import { buildSeoArticle } from "../src/lib/seo/article";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const OUTLINE = JSON.stringify({
  title: "Meal Prep Kaise Karein: Poore Hafte Ka Plan",
  metaDescription: "Meal prep seekho — 15 minute me poore hafte ka khana plan karo.",
  headings: ["Kyun meal prep", "Step-by-step plan", "Grocery list", "Galtiyan"],
});
const BODY = JSON.stringify({
  intro: "Intro with meal prep keyword.",
  sections: [
    { heading: "Kyun meal prep", body: "Body one." },
    { heading: "Step-by-step plan", body: "Sirf ₹499 me sab kuch!" },
    { heading: "Grocery list", body: "Body three." },
  ],
  faq: [
    { q: "Kitna time lagega?", a: "15 minute roz." },
    { q: "Best #1 tarika?", a: "Ye wala." },
    { q: "Fridge me kitne din tikega?", a: "3-4 din aaram se." },
  ],
  closing: "Shuru karo aaj hi!",
});

async function main() {
  let calls = 0;
  const mock = async () => { calls++; return calls === 1 ? OUTLINE : BODY; };
  const a = await buildSeoArticle(
    { topic: "meal prep", keywords: ["meal prep kaise karein", "budget meals"], productName: "Nashta Guide", productLink: "https://example.com/p" },
    mock
  );
  check("2 LLM calls", calls === 2);
  check("title kept", a.title === "Meal Prep Kaise Karein: Poore Hafte Ka Plan");
  check("slug generated", a.slug === "meal-prep-kaise-karein-poore-hafte-ka-plan", a.slug);
  check("price section dropped", !a.bodyMarkdown!.includes("₹499"));
  check("bad faq dropped", a.faq.length === 2);
  check("product link appended", a.bodyMarkdown!.includes("https://example.com/p"));
  check("warnings recorded", a.warnings.length === 2, JSON.stringify(a.warnings));
  check("meta ≤160", (a.metaDescription ?? "").length <= 160);

  try {
    await buildSeoArticle({ topic: "x", keywords: [] }, mock);
    check("empty keywords rejected", false);
  } catch (e) {
    check("empty keywords rejected", e instanceof DigitalError && e.code === "validation_error");
  }
  try {
    await buildSeoArticle({ topic: "meal prep", keywords: ["meal prep"] }, async () => "garbage");
    check("garbage hard-errors", false);
  } catch (e) {
    check("garbage hard-errors", e instanceof DigitalError && e.code === "generation_failed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
