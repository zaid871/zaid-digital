/**
 * Training-data collector tests (no live keys needed).
 * Verifies: record/readback roundtrip, verdict stats, malformed-line
 * tolerance, output cap, and runHub integration — an approved run
 * records an "approved" example, a compliance-rejected run records a
 * "rejected" example with the reason. No real training happens here;
 * this only proves the dataset gets built.
 * Run: npx tsx scripts/test-training-data.ts
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolated storage so tests never touch storage/hub.
process.env.HUB_STORAGE_DIR = mkdtempSync(join(tmpdir(), "training-data-test-"));

import {
  recordTrainingExample,
  readTrainingData,
  trainingDataStats,
  TRAINING_DATA_MAX_CHARS,
  type TrainingExample,
} from "../src/lib/hub/training-data";
import { runHub } from "../src/lib/hub/run";
import type { TextCaller } from "../src/lib/hub/ensemble";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name} ${extra}`);
  }
}

function example(over: Partial<TrainingExample> = {}): TrainingExample {
  return {
    runId: "run-test-1",
    createdAt: new Date().toISOString(),
    kind: "chat",
    mode: "single",
    instruction: "Say hello.",
    output: "Hello! How can I help?",
    verdict: "approved",
    models: ["openai/gpt-oss-20b"],
    ...over,
  };
}

const fakeCaller: TextCaller = async (leg, prompt) => ({
  text: `[${leg.model}] fake answer to: ${prompt.slice(0, 40)}`,
  durationMs: 5,
});

// Every leg returns a price — trips the compliance scan.
const priceCaller: TextCaller = async () => ({
  text: "This costs only $9.99, best deal ever!",
  durationMs: 5,
});

async function main(): Promise<void> {
  console.log("record + readback");
  check("empty store reads empty", readTrainingData().length === 0);
  check("record returns true", recordTrainingExample(example()) === true);
  const rows = readTrainingData();
  check("one row read back", rows.length === 1);
  check("instruction kept", rows[0].instruction === "Say hello.");
  check("verdict kept", rows[0].verdict === "approved");

  console.log("stats + cap");
  recordTrainingExample(example({ runId: "run-test-2", verdict: "rejected", reason: "compliance_rejected: price" }));
  recordTrainingExample(example({ runId: "run-test-3", verdict: "failed", reason: "sandbox_failed: boom" }));
  recordTrainingExample(example({ runId: "run-test-4", kind: "code", verdict: "approved" }));
  const stats = trainingDataStats();
  check("total 4", stats.total === 4);
  check("approved 2", stats.approved === 2);
  check("rejected 1", stats.rejected === 1);
  check("failed 1", stats.failed === 1);
  check("byKind chat 3, code 1", stats.byKind.chat === 3 && stats.byKind.code === 1);
  recordTrainingExample(example({ runId: "run-test-5", output: "x".repeat(9000) }));
  const capped = readTrainingData(1)[0];
  check(
    "output capped at max chars",
    capped.output.length === TRAINING_DATA_MAX_CHARS,
    `got ${capped.output.length}`
  );

  console.log("runHub integration (fake caller)");
  const before = trainingDataStats().total;
  const okRun = await runHub(
    { task: { kind: "chat", prompt: "Write a short greeting.", mode: "single" }, deliver: { format: "text" } },
    { caller: fakeCaller }
  );
  check("fake run ok", okRun.ok === true);
  const afterOk = readTrainingData(1)[0];
  check(
    "approved run recorded approved",
    trainingDataStats().total === before + 1 && afterOk.verdict === "approved",
    `verdict=${afterOk.verdict}`
  );
  check("recorded instruction is the prompt", afterOk.instruction === "Write a short greeting.");

  const badRun = await runHub(
    { task: { kind: "chat", prompt: "Write a product pitch.", mode: "ensemble" }, deliver: { format: "text" } },
    { caller: priceCaller }
  );
  check("price run not ok", badRun.ok === false);
  const afterBad = readTrainingData(1)[0];
  check(
    "rejected run recorded rejected with reason",
    afterBad.verdict === "rejected" && (afterBad.reason ?? "").includes("compliance_rejected"),
    `verdict=${afterBad.verdict} reason=${afterBad.reason}`
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
