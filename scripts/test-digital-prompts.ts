/**
 * Prompt-library tests: AI draft + bank fallback, compliance drops,
 * packaging (md/txt/json/manifest/zip).
 * Run: npx tsx scripts/test-digital-prompts.ts
 */
import { existsSync, readFileSync } from "fs";
import {
  ANGLE_SHIFTS,
  angleShiftLine,
  generatePromptLibrary,
  recommendAngle,
  type AngleShift,
} from "../src/lib/digital/prompts";
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

const OUT = "/tmp/digital-prompts-test";

const fakeAi: TextGen = async () =>
  JSON.stringify([
    { title: "AI Hook", prompt: "Write 5 hooks about fitness coaching for busy parents, each under 10 words.", category: "marketing", howToUse: "Test one per video." },
    { title: "AI Explainer", prompt: "Explain fitness coaching in simple words with one everyday example.", category: "learning", howToUse: "Paste into any chatbot." },
    { title: "AI Captions", prompt: "Write 3 captions about fitness coaching, each under 25 words.", category: "social", howToUse: "Rotate one per post." },
    { title: "AI Email", prompt: "Write a welcome email about fitness coaching with one useful tip.", category: "marketing", howToUse: "Send after signup." },
  ]);

const badAi: TextGen = async () =>
  JSON.stringify([
    { title: "Price trap", prompt: "Write a post promising 50% off and guaranteed income from fitness coaching.", category: "marketing", howToUse: "Do not use." },
    { title: "Good one", prompt: "Explain fitness coaching in simple words with one everyday example.", category: "learning", howToUse: "Paste into any chatbot." },
    { title: "Good two", prompt: "Write 3 captions about fitness coaching, each under 25 words.", category: "social", howToUse: "Rotate one per post." },
    { title: "Good three", prompt: "List 5 beginner mistakes in fitness coaching and the fix for each.", category: "learning", howToUse: "Turn into a checklist." },
  ]);

async function main() {
  // AI draft path.
  {
    const r = await generatePromptLibrary({ topic: "fitness coaching", count: 4 }, { textGen: fakeAi, outRoot: OUT });
    check("AI draft used (4 prompts)", r.prompts.length === 4);
    check("AI titles kept", r.prompts.some((p) => p.title === "AI Hook"));
    check("md/txt/json files exist", existsSync(r.files.markdown) && existsSync(r.files.text) && existsSync(r.files.json));
    check("md contains prompts", readFileSync(r.files.markdown, "utf-8").includes("AI Hook"));
    check("zip exists", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Bank fallback (no textGen).
  {
    const r = await generatePromptLibrary({ topic: "fitness coaching", count: 6 }, { outRoot: OUT });
    check("bank fallback (6 prompts)", r.prompts.length === 6);
    check("bank warning recorded", r.warnings.some((w) => w.startsWith("ai_draft_fallback")));
    check("bank prompts mention topic", r.prompts.every((p) => p.prompt.includes("fitness coaching")));
  }

  // Compliance: violator dropped, good ones kept.
  {
    const r = await generatePromptLibrary({ topic: "fitness coaching", count: 4 }, { textGen: badAi, outRoot: OUT });
    check("violating prompt dropped", r.prompts.length === 3 && r.prompts.every((p) => p.title !== "Price trap"));
    check("drop warning recorded", r.warnings.some((w) => w.startsWith("compliance_dropped")));
  }

  // Validation: short topic throws.
  {
    try {
      await generatePromptLibrary({ topic: "ab" }, { outRoot: OUT });
      check("short topic throws", false);
    } catch (e) {
      check("short topic throws", e instanceof DigitalError && e.code === "validation_error");
    }
  }

  // Count clamping.
  {
    const r = await generatePromptLibrary({ topic: "fitness coaching", count: 99 }, { outRoot: OUT });
    check("count clamped to bank size (12)", r.prompts.length === 12, `got ${r.prompts.length}`);
  }

    // --- Angle Shift (Utkarsh Gose) ---

  // Gap "too long" → format_change.
  {
    const r = recommendAngle(["too long"], "ebook");
    check("'too long' → format_change", r !== null && r.angle === "format_change", JSON.stringify(r?.angle));
  }

  // Gap "examples aren't Indian" → language_examples.
  {
    const r = recommendAngle(["examples aren't Indian"], "ebook");
    check("'examples aren't Indian' → language_examples", r !== null && r.angle === "language_examples", JSON.stringify(r?.angle));
  }

  // Gap "not for beginners" → narrow_audience.
  {
    const r = recommendAngle(["not for beginners"], "template");
    check("'not for beginners' → narrow_audience", r !== null && r.angle === "narrow_audience", JSON.stringify(r?.angle));
  }

  // Hinglish gap "lamba hai" → format_change.
  {
    const r = recommendAngle(["bohot lamba hai"], "ebook");
    check("Hinglish 'lamba' → format_change", r !== null && r.angle === "format_change", JSON.stringify(r?.angle));
  }

  // Majority wins: 2 format gaps beat 1 language gap.
  {
    const r = recommendAngle(["too long", "boring", "examples aren't Indian"], "ebook");
    check("majority: 2 format vs 1 language → format_change", r !== null && r.angle === "format_change" && r.matches === 2, JSON.stringify(r));
  }

  // Tie: 1 language vs 1 format → video order puts language_examples first.
  {
    const r = recommendAngle(["too long", "examples aren't Indian"], "ebook");
    check("tie: language_examples wins over format_change", r !== null && r.angle === "language_examples", JSON.stringify(r?.angle));
  }

  // No matching gap → null (no invented recommendation).
  {
    check("no match → null", recommendAngle(["great quality", "fast delivery"], "ebook") === null);
    check("empty gaps → null", recommendAngle([], "ebook") === null);
  }

  // Reason quotes the matched gap(s).
  {
    const r = recommendAngle(["too long"], "ebook");
    check("reason quotes the gap", r !== null && r.reason.includes("too long") && r.reason.includes("ebook"), r?.reason ?? "");
  }

  // All three shifts have description + example + prompt line.
  {
    const keys: AngleShift[] = ["narrow_audience", "language_examples", "format_change"];
    check(
      "all shifts documented",
      keys.every((k) => ANGLE_SHIFTS[k].description.length > 10 && ANGLE_SHIFTS[k].example.length > 10 && ANGLE_SHIFTS[k].promptLine.length > 10)
    );
    check("narrow example is the video's fresher example", ANGLE_SHIFTS.narrow_audience.example.includes("freshers"));
    check("format example is the video's 200-page example", ANGLE_SHIFTS.format_change.example.includes("200-page"));
  }

  // angleShiftLine: line for a set angle, empty when unset.
  {
    check("angleShiftLine: line for format_change", angleShiftLine("format_change").includes("checklist"));
    check("angleShiftLine: empty when unset", angleShiftLine(undefined) === "" && angleShiftLine(null) === "");
  }

  

console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
