/**
 * Digital marketing-toolkit tests: sales copy + FAQ + captions +
 * social templates + checklist, all from stubbed AI (no live keys).
 * The stub routes by prompt prefix, like the real chain would answer.
 * Run: npx tsx scripts/test-digital-marketing-toolkit.ts
 */
import { existsSync, readFileSync } from "fs";
import { DigitalError } from "../src/lib/digital/ebook";
import { generateMarketingToolkit } from "../src/lib/digital/marketing-toolkit";

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

const OUT = "/tmp/digital-marketing-toolkit-test";

const SALES_JSON = JSON.stringify({
  headline: "Apna planner, apne hisaab se",
  subheadline: "Har din ka plan ek jagah — saaf, simple, print-ready.",
  problemSection: "Plans bikhre rehte hain — phone me notes, diary me list, aur kuch yaad nahi rehta.",
  outcomeBullets: ["Har subah 2 minute me din tayyar", "Kagaz par plan, dimaag halka"],
  insideList: ["30 daily planner pages", "Weekly check-in page", "Habit tracker"],
  whoIsItFor: "Unke liye jo apna din kagaz par plan karna pasand karte hain.",
  ctaLine: "Aaj se apna din plan karo.",
  trustLine: "Sample pages dekh kar decide karo — jo dikhta hai wahi milta hai.",
  objectionAnswers: ["Print karna aasan hai — A4 par seedha print hota hai."],
  riskNote: "Digital file hai — print karke istemal karo.",
});

const FAQ_JSON = JSON.stringify({
  faqs: [
    { q: "Ye kis format me milega?", a: "PDF format me milega — phone, tablet aur computer par khulta hai." },
    { q: "Print kaise karun?", a: "A4 paper par seedha print karo — pages print-ready hain." },
    { q: "Koi issue ho to?", a: "Support se contact karo — order details ke saath." },
  ],
});

async function stubTextGen(prompt: string): Promise<string> {
  if (prompt.startsWith("Write sales-page copy")) return SALES_JSON;
  if (prompt.startsWith("Write 5-7 frequently asked questions")) return FAQ_JSON;
  throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
}

async function main() {
  // Happy path — full bundle with stubbed AI.
  {
    const r = await generateMarketingToolkit(
      {
        productName: "Daily Planner Pack",
        productType: "template_pack",
        features: ["30 daily pages", "Weekly check-in", "Habit tracker"],
        audience: "students aur professionals",
        outcomes: ["Din plan karna aasan"],
        niche: "planner",
        handle: "@test",
        theme: "dark",
      },
      { textGen: stubTextGen, outRoot: OUT }
    );
    check("product name kept", r.productName === "Daily Planner Pack");
    check("sales-copy.md exists", existsSync(`${r.dir}/sales-copy.md`));
    const copyMd = readFileSync(`${r.dir}/sales-copy.md`, "utf-8");
    check("sales copy has headline", copyMd.includes("Apna planner, apne hisaab se"));
    check("sales copy has trust line", copyMd.includes("Sample pages dekh kar decide karo"));
    check("faq.md exists", existsSync(`${r.dir}/faq.md`));
    const faqMd = readFileSync(`${r.dir}/faq.md`, "utf-8");
    check("faq has 3 questions", faqMd.includes("Ye kis format me milega?") && faqMd.includes("Print kaise karun?"));
    check("captions.md exists", existsSync(`${r.dir}/captions.md`));
    const capMd = readFileSync(`${r.dir}/captions.md`, "utf-8");
    check(
      "captions built from sales copy (headline + CTA + hashtag)",
      capMd.includes("Apna planner, apne hisaab se") && capMd.includes("Aaj se apna din plan karo.") && capMd.includes("#planner")
    );
    check("launch-checklist.md exists", existsSync(`${r.dir}/launch-checklist.md`));
    const cl = readFileSync(`${r.dir}/launch-checklist.md`, "utf-8");
    check("checklist has best-time slots", cl.includes("07:30") && cl.includes("19:30"));
    // Pack count clamps to min 4 (templates.ts) — 4 designs x svg+png = 8 files.
    check("social templates copied in", r.files.socialTemplates.length === 8, `got ${r.files.socialTemplates.length}`);
    for (const f of r.files.socialTemplates) {
      check(`social file exists: ${f}`, existsSync(`${r.dir}/${f}`));
    }
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as { type: string };
    check("manifest type marketing_toolkit", manifest.type === "marketing_toolkit");
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Short product name rejected.
  {
    let caught: unknown = null;
    try {
      await generateMarketingToolkit({ productName: "X" }, { textGen: stubTextGen, outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "short productName -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-MARKETING-TOOLKIT TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
