/**
 * Hub tests: router table, ensemble pause gates, Shared Power Pool,
 * quota guard, compliance scan, sandbox states, and runHub end-to-end
 * WITHOUT live keys (no-keys paths must fail honestly, never fake).
 * Engine lanes that need the network (image/video) are not live-tested
 * here — they are covered by their own provider tests + hub-eval.
 * Run: npx tsx scripts/test-hub.ts
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolated storage so tests never touch storage/hub.
process.env.HUB_STORAGE_DIR = mkdtempSync(join(tmpdir(), "hub-test-"));

import { HubError } from "../src/lib/hub/types";
import { routeTask, ensembleLegs } from "../src/lib/hub/router";
import { fanOut, synthesizeCode } from "../src/lib/hub/ensemble";
import { deposit, draw } from "../src/lib/hub/pool";
import { checkQuota, recordUse, setQuotaCount } from "../src/lib/hub/quota";
import { readLedger } from "../src/lib/hub/ledger";
import { runInSandbox } from "../src/lib/hub/sandbox";
import { hubRequestSchema, runHub, scanCompliance } from "../src/lib/hub/run";

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
function throwsCode(fn: () => unknown, code: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof HubError && e.code === code;
  }
}

async function main(): Promise<void> {
  console.log("hub router");
  const codePlan = routeTask("code", undefined, "code");
  check("code -> ensemble", codePlan.mode === "ensemble");
  check("ensemble has 4 legs (cap)", codePlan.legs.length === 4);
  check("synth is gpt-oss-120b", codePlan.synth.model === "openai/gpt-oss-120b");
  check("no retired llama/deepseek id in legs", !codePlan.legs.some((l) => /llama-3|deepseek/i.test(l.model)));
  check("ensembleLegs() respects cap", ensembleLegs().length <= 4);
  const chatPlan = routeTask("chat", undefined, "text");
  check("chat -> single fast 20b", chatPlan.mode === "single" && chatPlan.legs[0].model === "openai/gpt-oss-20b");
  const imgPlan = routeTask("image", undefined, "image");
  check("image -> engine", imgPlan.mode === "engine" && imgPlan.engineFormat === "image");
  const docPlan = routeTask("document", undefined, "docx");
  check("document+docx -> engine", docPlan.mode === "engine" && docPlan.engineFormat === "docx");
  check("unknown kind -> validation_error", throwsCode(() => routeTask("nope" as never, undefined, "text"), "validation_error"));
  check("code+docx -> format_mismatch", throwsCode(() => routeTask("code", undefined, "docx"), "format_mismatch"));
  check("pdf-report -> not_built", throwsCode(() => routeTask("chat", undefined, "pdf-report"), "not_built"));
  check("request schema rejects bad format", !hubRequestSchema.safeParse({ task: { kind: "chat", prompt: "hi" }, deliver: { format: "nope" } }).success);

  console.log("ensemble pause gates (fake caller)");
  const dupText = "Pehli baat yeh hai ke mehnat roz karni chahiye aur dusri baat yeh hai ke seekhna kabhi band nahi karna chahiye.";
  const fakeCaller = async (leg: { id: string }) => {
    if (leg.id === "slow") return new Promise<never>(() => undefined);
    if (leg.id === "err") throw new Error("boom");
    if (leg.id === "dup") return { text: dupText, durationMs: 3 };
    return { text: dupText, durationMs: 5 };
  };
  const legs = [
    { id: "ok", provider: "groq" as const, model: "openai/gpt-oss-120b" },
    { id: "slow", provider: "groq" as const, model: "openai/gpt-oss-20b" },
    { id: "err", provider: "gemini" as const, model: "gemini-2.0-flash" },
    { id: "dup", provider: "groq" as const, model: "qwen/qwen3.8-27b" },
  ];
  const fan = await fanOut(legs, "test prompt", { timeoutMs: 60, caller: fakeCaller });
  const byId = Object.fromEntries(fan.contributions.map((c) => [c.legId, c]));
  check("ok leg survives", byId.ok.status === "ok");
  check("slow leg paused by timeout", byId.slow.status === "paused" && byId.slow.pauseReason === "timeout");
  check("error leg paused", byId.err.status === "paused" && byId.err.pauseReason === "error");
  check("duplicate leg paused", byId.dup.status === "paused" && byId.dup.pauseReason === "duplicate");
  check("exactly 1 survivor", fan.survivors.length === 1);
  check("code synthesis picks survivor verbatim", synthesizeCode(fan.survivors).text === dupText);

  console.log("shared power pool");
  const runId = "test-run-1";
  deposit({ runId, lane: "text", legId: "ok", provider: "groq", model: "openai/gpt-oss-120b", kind: "text", text: dupText, score: 70, createdAt: new Date().toISOString() });
  deposit({ runId, lane: "text", legId: "dup", provider: "groq", model: "qwen/qwen3.8-27b", kind: "text", text: "doosra draft", score: 40, createdAt: new Date().toISOString() });
  const drawn = draw(runId);
  check("pool draw returns 2 deposits in order", drawn.length === 2 && drawn[0].legId === "ok" && drawn[1].text === "doosra draft");
  check("pool draw isolates other runs", draw("no-such-run").length === 0);

  console.log("quota guard");
  const model = "openai/gpt-oss-120b";
  setQuotaCount(model, 0);
  check("quota allows under limit", checkQuota(model).allowed);
  recordUse(model);
  check("recordUse increments", checkQuota(model).remaining === 999);
  setQuotaCount(model, 1000);
  check("quota blocks at limit", !checkQuota(model).allowed && checkQuota(model).remaining === 0);
  setQuotaCount(model, 0);

  console.log("compliance scan");
  check("price text rejected", scanCompliance("Sirf ₹499 me le lo, 50% off!").status === "rejected");
  check("guarantee text rejected", scanCompliance("100% guarantee ke saath best seller").status === "rejected");
  check("clean text approved", scanCompliance("Roz subah 30 minute walk karein, neend poori lein.").status === "approved");

  console.log("sandbox (no docker here)");
  const sb = await runInSandbox({ language: "javascript", code: "console.log(1)" });
  check("sandbox reports unavailable, never fake pass", sb.status === "unavailable");

  console.log("runHub without keys (honest failure)");
  const noKeys = await runHub({ task: { kind: "chat", prompt: "Namaste, ek line me batao." }, deliver: { format: "text" } });
  check("no-keys run fails, does not fake", !noKeys.ok && noKeys.error?.code === "not_configured");
  check("no-keys run is ledgered", readLedger(5).some((e) => e.runId === noKeys.runId));
  const mismatch = await runHub({ task: { kind: "code", prompt: "x=1" }, deliver: { format: "docx" } });
  check("format mismatch fails typed", !mismatch.ok && mismatch.error?.code === "format_mismatch");

  console.log("runHub ensemble with fake caller");
  const fakeHubCaller = async (leg: { id: string }, prompt: string) => {
    if (leg.id === "synth") return { text: "MERGED: teeno drafts ka behtareen hissa.", durationMs: 4 };
    return { text: `Draft from ${leg.id} — mehnat, seekhna aur sabr, teeno zaroori hain. ${prompt.slice(0, 20)}`, durationMs: 5 };
  };
  const ens = await runHub(
    { task: { kind: "reasoning", prompt: "Kaamyabi ke 3 usool batao." }, deliver: { format: "text" } },
    { caller: fakeHubCaller }
  );
  check("ensemble run ok with merged text", ens.ok && (ens.output.text ?? "").startsWith("MERGED:"));
  check("ensemble pool has deposits", ens.pool.deposits >= 4);
  check("ensemble ledger row exists", readLedger(5).some((e) => e.runId === ens.runId && e.ok));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
