/**
 * Kaggle adapter — 30 GPU hrs/week, 2x T4 (16 GB VRAM each),
 * session max 12 h, 20 GB saved disk. P100 retired 15 Sep 2026 —
 * T4 x2 is the only free GPU now (one hour on T4 x2 uses one hour
 * of quota). Kaggle is CLI-based (no webhook): the adapter shells
 * out to the `kaggle` CLI. Phone verification is required once
 * before any GPU access.
 *
 * Requires KAGGLE_USERNAME + KAGGLE_KEY in env and the `kaggle` CLI on
 * PATH (pip install kaggle). A kernel is pushed from a kernel dir
 * (kernel-metadata.json + train script); on push the adapter copies the
 * dir to a temp dir and substitutes <kaggle-username> in the metadata
 * with $KAGGLE_USERNAME, so the checked-in file never carries a real
 * username. Without the CLI or the keys, the adapter pauses with
 * not_configured — never a fake run.
 *
 * Honest limit: Kaggle's T4 is 16 GB — it CANNOT run Wan 5B (needs
 * 24 GB). LoRA training here targets SD 1.5 (fits a T4); Wan-scale
 * video goes to Modal, not Kaggle.
 */
import { execFile } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const KAGGLE_TOOL_ID = "kaggle";

const KaggleInputSchema = z.object({
  /** push = upload + start the kernel; status = poll it; output = download results. */
  action: z.enum(["push", "status", "output"]),
  /** Kernel dir relative to the repo root, e.g. src/lib/tools/workers/kaggle-lora. */
  kernelDir: z.string().min(1).default("src/lib/tools/workers/kaggle-lora"),
  /** Kernel slug "<username>/<slug>" for status/output. Defaults to the metadata id. */
  kernelSlug: z.string().min(1).optional(),
  /** Where `output` downloads results to (repo-relative). */
  outputDir: z.string().min(1).default("storage/kaggle-output"),
});

export function isConfigured(): boolean {
  return (
    Boolean(process.env.KAGGLE_USERNAME?.trim()) &&
    Boolean(process.env.KAGGLE_KEY?.trim())
  );
}

function runCli(
  args: string[],
  timeoutMs: number,
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "kaggle",
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, cwd },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: string | number };
          reject(new Error(`kaggle exit ${e.code ?? "?"}: ${String(stderr ?? "").slice(-300)}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

/** Copy a kernel dir to temp, substituting the username placeholder in its metadata. */
function prepareKernelDir(kernelDir: string, username: string): string {
  const src = join(process.cwd(), kernelDir);
  const dest = join(tmpdir(), `kaggle-kernel-${Date.now()}`);
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (name === "kernel-metadata.json") {
      const text = readFileSync(from, "utf-8").replaceAll("<kaggle-username>", username);
      writeFileSync(to, text, "utf-8");
    } else {
      copyFileSync(from, to);
    }
  }
  return dest;
}

export const kaggleAdapter: ToolAdapter = {
  id: KAGGLE_TOOL_ID,
  capabilities: ["lora-train", "gpu-batch"],
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
    const parsed = KaggleInputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused("error", "invalid_input", "Invalid Kaggle input: need action + kernelDir.");
    }
    const username = process.env.KAGGLE_USERNAME;
    const key = process.env.KAGGLE_KEY;
    if (!username || !key) {
      return paused(
        "not_configured",
        "not_configured",
        "Missing KAGGLE_USERNAME / KAGGLE_KEY (kaggle.com/settings/account API token)."
      );
    }
    const { action, kernelDir, kernelSlug, outputDir } = parsed.data;
    let argv: string[];
    let cwd: string | undefined;
    if (action === "push") {
      const src = join(process.cwd(), kernelDir);
      if (!existsSync(join(src, "kernel-metadata.json"))) {
        return paused("error", "missing_kernel", `No kernel-metadata.json in ${kernelDir}.`);
      }
      cwd = prepareKernelDir(kernelDir, username);
      argv = ["kernels", "push", "-p", cwd];
    } else {
      const slug =
        kernelSlug ??
        (() => {
          try {
            const meta = JSON.parse(
              readFileSync(join(process.cwd(), kernelDir, "kernel-metadata.json"), "utf-8")
            ) as { id?: string };
            return typeof meta.id === "string" ? meta.id.replace("<kaggle-username>", username) : "";
          } catch {
            return "";
          }
        })();
      if (!slug) {
        return paused("error", "missing_slug", "kernelSlug is required for status/output.");
      }
      argv =
        action === "status"
          ? ["kernels", "status", slug]
          : ["kernels", "output", slug, "-p", join(process.cwd(), outputDir)];
    }
    try {
      const out = await runCli(argv, Math.min(req.timeoutMs, 600_000), cwd);
      return {
        ok: true,
        toolId: req.toolId,
        jobId: req.jobId,
        status: "ok",
        output: { text: out.stdout.slice(0, 2000) },
        usage: { unitsUsed: 0, unit: "gpu-minutes", costUsd: 0 },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        return paused("not_configured", "cli_missing", "The `kaggle` CLI is not on PATH.");
      }
      if (msg.includes("timed out") || msg.includes("ETIMEDOUT")) {
        return paused("timeout", "timeout", "Kaggle CLI timed out.");
      }
      return paused("error", "kaggle_failed", msg.slice(0, 300));
    }
  },
};
