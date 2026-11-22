/**
 * Hub eval — 10 fixed real tasks, run against the live hub.
 *
 * Scores pipeline vs ensemble vs single on: run ok, sandbox pass (code),
 * compliance approval (text), and output length. Prints a table.
 * Numbers come ONLY from this run — never claimed before it runs.
 *
 * Requires GROQ_API_KEY and/or GEMINI_API_KEY in the environment (the
 * hub's load-bearing keys). Without either key the eval refuses to run
 * instead of printing zeros. Code tasks need Docker for the sandbox;
 * without it they fail honestly as sandbox_unavailable.
 *
 * Run: npx tsx scripts/hub-eval.ts
 */
import { runHub, type HubRunInput } from "../src/lib/hub/run";
import type { HubMode } from "../src/lib/hub/types";

interface EvalTask {
  name: string;
  input: HubRunInput;
  modes: HubMode[];
  expectCode: boolean;
}

const TASKS: EvalTask[] = [
  {
    name: "code-js-slugify",
    input: { task: { kind: "code", prompt: "Write a JavaScript function slugify(text) that lowercases, replaces spaces with hyphens, and strips non-alphanumeric characters except hyphens. Include a console.log test with 'Hello World! 2026'." }, deliver: { format: "code" } },
    modes: ["ensemble", "pipeline"],
    expectCode: true,
  },
  {
    name: "code-py-interest",
    input: { task: { kind: "code", prompt: "Write a Python function compound(principal, rate, years) that returns the compound interest amount rounded to 2 decimals. Include a print test with (10000, 0.08, 5)." }, deliver: { format: "code" } },
    modes: ["ensemble", "pipeline"],
    expectCode: true,
  },
  {
    name: "reasoning-saving",
    input: { task: { kind: "reasoning", prompt: "Bachat ke 3 sabse asaan usool batao, har usool ek line me, Roman Hinglish me." }, deliver: { format: "text" } },
    modes: ["ensemble", "single"],
    expectCode: false,
  },
  {
    name: "reasoning-video-ideas",
    input: { task: { kind: "reasoning", prompt: "Do video ideas compare karo: (1) ek product ka honest review, (2) product ke 3 hidden features. Kaunsa pehle banana chahiye aur kyun? 5 lines me jawab do." }, deliver: { format: "text" } },
    modes: ["ensemble", "single"],
    expectCode: false,
  },
  {
    name: "planning-7day",
    input: { task: { kind: "planning", prompt: "Ek affiliate product ke liye 7 din ka content plan banao: har din ek reel idea, Roman Hinglish me, bina price aur bina fake claims ke." }, deliver: { format: "text" } },
    modes: ["ensemble", "single"],
    expectCode: false,
  },
  {
    name: "caption-reel",
    input: { task: { kind: "caption", prompt: "Ek wireless earbuds reel ke liye 3-line Hinglish caption likho: hook, ek honest feature, aur comment CTA. No prices, no discounts, no fake claims." }, deliver: { format: "text" } },
    modes: ["single"],
    expectCode: false,
  },
  {
    name: "summary-paragraph",
    input: { task: { kind: "summary", prompt: "Summarize in 2 lines: 'Free-tier AI tools work well when the task is narrow and verifiable. A script generator can be checked by running the script. An image generator can be checked by looking at the image. What cannot be checked automatically is taste, timing, and audience fit — those still need a human.'" }, deliver: { format: "text" } },
    modes: ["single"],
    expectCode: false,
  },
  {
    name: "chat-greeting",
    input: { task: { kind: "chat", prompt: "Ek line me Namaste kaho aur poochho aaj kya banayein." }, deliver: { format: "text" } },
    modes: ["single"],
    expectCode: false,
  },
  {
    name: "longdoc-earbuds-outline",
    input: { task: { kind: "long-doc", prompt: "Students ke liye best budget earbuds chunne par ek detailed research outline banao: 6 sections, har section me 2-3 points. No prices, no fake specs, no invented reviews." }, deliver: { format: "text" } },
    modes: ["pipeline"],
    expectCode: false,
  },
  {
    name: "math-word-problem",
    input: { task: { kind: "math", prompt: "Ek dukaan 40 videos banati hai. Har video banane me 45 minute lagte hain. Kul kitne ghante lagenge? Step-by-step jawab do." }, deliver: { format: "text" } },
    modes: ["ensemble", "single"],
    expectCode: false,
  },
];

async function main(): Promise<void> {
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    console.log("EVAL NOT RUN: neither GROQ_API_KEY nor GEMINI_API_KEY is set.");
    console.log("Set at least one free key, then run: npx tsx scripts/hub-eval.ts");
    process.exit(1);
  }
  console.log("task | mode | ok | sandbox | compliance | ms | chars");
  let rows = 0;
  let passed = 0;
  for (const task of TASKS) {
    for (const mode of task.modes) {
      const started = Date.now();
      const result = await runHub(
        { ...task.input, task: { ...task.input.task, mode } },
        {}
      );
      const ms = Date.now() - started;
      const text = result.output.text ?? "";
      const sb = result.verification.sandbox;
      const comp = result.verification.compliance;
      const good = result.ok && (task.expectCode ? sb === "passed" : comp === "approved") && text.length > 0;
      if (good) passed++;
      rows++;
      console.log(
        `${task.name} | ${mode} | ${result.ok} | ${sb} | ${comp} | ${ms} | ${text.length}${result.error ? ` | ERROR ${result.error.code}` : ""}`
      );
    }
  }
  console.log(`\n${passed}/${rows} runs fully green (ok + ${"sandbox-passed or compliance-approved"} + non-empty output).`);
  console.log("These numbers are from this run only. Re-run after any router/model change.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
