/**
 * Modal GPU adapter — $30/mo credit (~50 h T4 / ~14 h A100-40GB).
 *
 * Modal is Python-first: the adapter shells out to the `modal` CLI
 * (`modal run <worker>::<fn> --payload-json '<json>'`). Every worker
 * function takes exactly one kwarg, payload_json, and prints one
 * `RESULT_JSON:{...}` line at the end — the adapter parses that line
 * and ignores the rest of the CLI output.
 *
 * Requires MODAL_TOKEN_ID + MODAL_TOKEN_SECRET in env and the `modal`
 * CLI on PATH (pip install modal; `modal setup`). Without either, the
 * adapter pauses with not_configured — never a fake run. Workers live
 * in src/lib/tools/workers/modal-*.py; the registry's modal entry
 * lists which function serves which capability.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const MODAL_TOOL_ID = "modal";

const ModalInputSchema = z.object({
  /** Worker function: wan-generate | upscale | remove-background | whisper | transcribe-batch. */
  function: z.enum(["wan-generate", "upscale", "remove-background", "whisper", "transcribe-batch"]),
  /** Arbitrary JSON payload for the worker function. */
  args: z.record(z.string(), z.unknown()).default({}),
});

/** Worker file + function name for each dispatchable function. */
const FUNCTIONS: Record<string, { file: string; fn: string }> = {
  "wan-generate": { file: "modal-wan.py", fn: "generate" },
  upscale: { file: "modal-upscale.py", fn: "upscale" },
  "remove-background": { file: "modal-upscale.py", fn: "remove_background" },
  whisper: { file: "modal-whisper.py", fn: "transcribe" },
  "transcribe-batch": { file: "modal-whisper.py", fn: "transcribe_batch" },
};

export function isConfigured(): boolean {
  return (
    Boolean(process.env.MODAL_TOKEN_ID?.trim()) &&
    Boolean(process.env.MODAL_TOKEN_SECRET?.trim())
  );
}

function runCli(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("modal", args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: string | number };
        reject(new Error(`modal exit ${e.code ?? "?"}: ${String(stderr ?? "").slice(-300)}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const modalAdapter: ToolAdapter = {
  id: MODAL_TOOL_ID,
  capabilities: ["gpu-video", "lora-train", "gpu-batch"],
  isConfigured,
  async run(req: ToolRunRequest): Promise<ToolRunResult> {
    const started = Date.now();
    const paused = (
      reason: ToolRunResult["pauseReason"],
      code: string,
      message: string
    ): ToolRunResult => ({
      ok: false,
      toolId: req.toolId,
      jobId: req.jobId,
      status: "paused",
      pauseReason: reason,
      usage: { unitsUsed: 0, unit: "gpu-minutes", costUsd: 0 },
      durationMs: Date.now() - started,
      error: { code, message },
    });
    const parsed = ModalInputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused("error", "invalid_input", "Invalid Modal input: need function + args.");
    }
    if (!isConfigured()) {
      return paused(
        "not_configured",
        "not_configured",
        "Missing MODAL_TOKEN_ID / MODAL_TOKEN_SECRET (modal setup) or the modal CLI."
      );
    }
    const target = FUNCTIONS[parsed.data.function];
    const workerPath = join(process.cwd(), "src", "lib", "tools", "workers", target.file);
    if (!existsSync(workerPath)) {
      return paused("error", "missing_worker", `Modal worker file missing: ${target.file}.`);
    }
    let out: { stdout: string; stderr: string };
    try {
      out = await runCli(
        ["run", `${workerPath}::${target.fn}`, "--payload-json", JSON.stringify(parsed.data.args)],
        Math.min(req.timeoutMs, 3_600_000)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        return paused("not_configured", "cli_missing", "The `modal` CLI is not on PATH.");
      }
      if (msg.includes("timed out") || msg.includes("ETIMEDOUT")) {
        return paused("timeout", "timeout", "Modal run timed out.");
      }
      return paused("error", "modal_failed", msg.slice(0, 300));
    }
    const line = out.stdout.split("\n").find((l) => l.startsWith("RESULT_JSON:"));
    if (!line) {
      return paused(
        "error",
        "no_result",
        "Modal run finished but printed no RESULT_JSON line."
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line.slice("RESULT_JSON:".length)) as Record<string, unknown>;
    } catch {
      return paused("error", "bad_result", "Modal RESULT_JSON line was not valid JSON.");
    }
    const gpuMinutes =
      typeof data.gpu_minutes === "number" && Number.isFinite(data.gpu_minutes)
        ? data.gpu_minutes
        : 0;
    return {
      ok: true,
      toolId: req.toolId,
      jobId: req.jobId,
      status: "ok",
      output: {
        data: { ...data, gpu_minutes: undefined, function: parsed.data.function },
        files:
          typeof data.output_path === "string" ? [data.output_path] : undefined,
      },
      usage: { unitsUsed: gpuMinutes, unit: "gpu-minutes", costUsd: 0 },
      durationMs: Date.now() - started,
    };
  },
};
