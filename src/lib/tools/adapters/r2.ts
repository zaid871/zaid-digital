/**
 * R2 object-storage adapter — thin wrapper over the existing S3 storage
 * backend (src/lib/storage.ts), which already speaks S3-compatible
 * endpoints. R2 is just S3 with an R2 endpoint: set S3_ENDPOINT to the
 * R2 account endpoint, S3_REGION to "auto", S3_FORCE_PATH_STYLE to
 * "true", plus S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY from the R2
 * dashboard (user creates them; never in chat).
 *
 * No new S3 client code here on purpose — the storage backend is the
 * adapter. This module only shapes its put() call into a ToolRunResult.
 */
import { statSync } from "fs";
import { z } from "zod";
import { getStorage } from "../../storage";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const R2_TOOL_ID = "r2";

const R2InputSchema = z.object({
  localPath: z.string().min(1),
  key: z.string().min(1).max(1024),
});

export function isConfigured(): boolean {
  return (
    Boolean(process.env.S3_BUCKET?.trim()) &&
    Boolean(process.env.S3_ACCESS_KEY?.trim()) &&
    Boolean(process.env.S3_SECRET_KEY?.trim())
  );
}

export const r2Adapter: ToolAdapter = {
  id: R2_TOOL_ID,
  capabilities: ["object-storage"],
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
      usage: { unitsUsed: 0, unit: "GB", costUsd: 0 },
      durationMs: Date.now() - started,
      error: { code, message },
    });
    const parsed = R2InputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused("error", "invalid_input", "Invalid R2 input: need localPath + key.");
    }
    if (!isConfigured()) {
      return paused(
        "not_configured",
        "not_configured",
        "Missing S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY (R2 credentials)."
      );
    }
    let sizeGb: number;
    try {
      sizeGb = statSync(parsed.data.localPath).size / 1_000_000_000;
    } catch {
      return paused(
        "error",
        "invalid_input",
        `Local file not found: ${parsed.data.localPath}`
      );
    }
    try {
      const storage = getStorage();
      const url = await storage.put(parsed.data.localPath, parsed.data.key);
      return {
        ok: true,
        toolId: req.toolId,
        jobId: req.jobId,
        status: "ok",
        output: { files: [url], data: { key: parsed.data.key } },
        usage: { unitsUsed: Math.max(0.001, sizeGb), unit: "GB", costUsd: 0 },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return paused("error", "upstream_error", `R2 upload failed: ${msg.slice(0, 200)}`);
    }
  },
};
