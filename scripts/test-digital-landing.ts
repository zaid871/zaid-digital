/**
 * Landing-page tests: AI draft + supplied copy + bank fallback,
 * compliance drops, HTML structure, packaging.
 * Run: npx tsx scripts/test-digital-landing.ts
 */
import { existsSync, readFileSync } from "fs";
import { generateLandingPage } from "../src/lib/digital/landing";
import { DigitalError, type TextGen } from "../src/lib/digital/ebook";

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

const OUT = "/tmp/digital-landing-test";

const fakeAi: TextGen = async () =>
  JSON.stringify({
    tagline: "Fitness coaching, aapki raftaar se.",
    features: [
      "Simple 7-day starter plan",
      "Daily 20-minute workouts",
      "Meal ideas for busy days",
      "Weekly check-in and support",
    ],
  });

async function main() {
  // AI draft path.
  {
    const r = await generateLandingPage(
      { businessName: "FitWithZaid", topic: "fitness coaching" },
      { textGen: fakeAi, outRoot: OUT }
    );
    const html = readFileSync(r.file, "utf-8");
    check("AI tagline in HTML", html.includes("Fitness coaching, aapki raftaar se."));
    check("AI features in HTML", html.includes("Simple 7-day starter plan") && html.includes("Weekly check-in and support"));
    check("CTA present", html.includes("Shuru karein"));
    check("single self-contained file", html.includes("<style>") && !html.includes('src="http'));
    check("zip exists", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Supplied copy wins over AI.
  {
    const r = await generateLandingPage(
      { businessName: "FitWithZaid", tagline: "My own tagline", features: ["One", "Two", "Three"].map((x) => `${x} feature line here`) },
      { textGen: fakeAi, outRoot: OUT }
    );
    const html = readFileSync(r.file, "utf-8");
    check("supplied tagline wins", html.includes("My own tagline"));
    check("supplied features used", html.includes("One feature line here"));
  }

  // Bank fallback (no textGen, no features).
  {
    const r = await generateLandingPage({ businessName: "FitWithZaid", topic: "fitness coaching" }, { outRoot: OUT });
    const html = readFileSync(r.file, "utf-8");
    check("bank features used", html.includes("Simple to start"));
    check("bank warning recorded", r.warnings.some((w) => w.startsWith("ai_draft_fallback")));
  }

  // Compliance: violating feature dropped.
  {
    const r = await generateLandingPage(
      {
        businessName: "FitWithZaid",
        tagline: "Honest fitness help.",
        features: ["Guaranteed results in 7 days", "Simple 7-day starter plan", "Daily 20-minute workouts"],
      },
      { outRoot: OUT }
    );
    const html = readFileSync(r.file, "utf-8");
    check("violating feature dropped", !html.includes("Guaranteed results") && html.includes("Simple 7-day starter plan"));
    check("drop warning recorded", r.warnings.some((w) => w.startsWith("compliance_dropped")));
  }

  // Validation: short name throws.
  {
    try {
      await generateLandingPage({ businessName: "x" }, { outRoot: OUT });
      check("short name throws", false);
    } catch (e) {
      check("short name throws", e instanceof DigitalError && e.code === "validation_error");
    }
  }

  // Light theme.
  {
    const r = await generateLandingPage(
      { businessName: "FitWithZaid", theme: "light", tagline: "Light tagline here", features: ["Feature one here", "Feature two here", "Feature three here"] },
      { outRoot: OUT }
    );
    const html = readFileSync(r.file, "utf-8");
    check("light theme bg", html.includes("#FAF7F2"));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
