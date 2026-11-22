/**
 * Cloudflare Workers adapter — deploys / checks the webhook-ingress
 * Worker (src/lib/tools/workers/webhook-ingress). The Worker itself
 * runs on Cloudflare after deploy; this adapter only manages the
 * deployment, it does not process webhooks.
 *
 * Requires CLOUDFLARE_API_TOKEN in env and the `wrangler` CLI on PATH
 * (npm i -g wrangler). Without either, the adapter pauses with
 * not_configured. The Worker needs META_APP_SECRET + META_VERIFY_TOKEN
 * set via `wrangler secret put` and VM_WEBHOOK_URL in wrangler.toml —
 * the adapter does not set those (secrets never pass through dispatch).
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const CF_WORKERS_TOOL_ID = "cf-workers";
const WORKER_DIR = join("src", "lib", "tools", "workers", "webhook-ingress");

const CfWorkersInputSchema = z.object({
  /** deploy = wrangler deploy; status = list deployments for this worker. */
  action: z.enum(["deploy", "status"]).default("status"),
});

export function isConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim());
}

function runCli(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "wrangler",
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, cwd: join(process.cwd(), WORKER_DIR) },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: string | number };
          reject(new Error(`wrangler exit ${e.code ?? "?"}: ${String(stderr ?? "").slice(-300)}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

export const cfWorkersAdapter: ToolAdapter = {
  id: CF_WORKERS_TOOL_ID,
  capabilities: ["webhook-ingress"],
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
      usage: { unitsUsed: 0, unit: "requests", costUsd: 0 },
      durationMs: Date.now() - started,
      error: { code, message },
    });
    const parsed = CfWorkersInputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused("error", "invalid_input", "Invalid Workers input: need action deploy|status.");
    }
    if (!isConfigured()) {
      return paused(
        "not_configured",
        "not_configured",
        "Missing CLOUDFLARE_API_TOKEN (the token in the keys file failed verification — re-send it)."
      );
    }
    if (!existsSync(join(process.cwd(), WORKER_DIR, "wrangler.toml"))) {
      return paused("error", "missing_worker", "Webhook-ingress worker dir is missing wrangler.toml.");
    }
    try {
      const out = await runCli(
        parsed.data.action === "deploy" ? ["deploy"] : ["deployments", "list"],
        120_000
      );
      return {
        ok: true,
        toolId: req.toolId,
        jobId: req.jobId,
        status: "ok",
        output: { text: out.stdout.slice(0, 2000) },
        usage: { unitsUsed: 0, unit: "requests", costUsd: 0 },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        return paused("not_configured", "cli_missing", "The `wrangler` CLI is not on PATH.");
      }
      if (msg.includes("timed out") || msg.includes("ETIMEDOUT")) {
        return paused("timeout", "timeout", "Wrangler timed out.");
      }
      return paused("error", "wrangler_failed", msg.slice(0, 300));
    }
  },
};
