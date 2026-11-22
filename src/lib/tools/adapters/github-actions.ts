/**
 * GitHub Actions dispatch adapter — free tier for public repos.
 *
 * Endpoint: POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/{id}/dispatches
 * Free tier (verified 2026-11-16): 4 vCPU + 16 GB per runner, 20
 * concurrent, job max 6 h. Requires GITHUB_TOKEN (classic PAT with
 * `repo` + `workflow` scopes, or a fine-grained PAT), GITHUB_REPO
 * ("owner/repo") and GITHUB_WORKFLOW_ID (workflow file name or id).
 * All three come from env, never from chat or the repo.
 *
 * The target workflow file MUST have a `workflow_dispatch` trigger —
 * a 204 means GitHub accepted the dispatch, not that the run finished.
 * Run status is tracked by polling the Actions API (not this adapter).
 */
import { z } from "zod";
import { requireEnv } from "../../providers/types";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const GHA_TOOL_ID = "gh-actions";

const TIMEOUT_MS = 30_000;

const GhInputSchema = z.object({
  ref: z.string().min(1).max(200).default("main"),
  inputs: z.record(z.string(), z.string()).optional(),
});

export function isConfigured(): boolean {
  return (
    requireEnv("GITHUB_TOKEN") !== null &&
    requireEnv("GITHUB_REPO") !== null &&
    requireEnv("GITHUB_WORKFLOW_ID") !== null
  );
}

export const githubActionsAdapter: ToolAdapter = {
  id: GHA_TOOL_ID,
  capabilities: ["parallel-compute"],
  isConfigured,
  async run(req: ToolRunRequest): Promise<ToolRunResult> {
    const started = Date.now();
    const paused = (
      reason: ToolRunResult["pauseReason"],
      code: string,
      message: string
    ): ToolRunResult => ({
      ok: false,
      toolId: GHA_TOOL_ID,
      jobId: req.jobId,
      status: "paused",
      pauseReason: reason,
      usage: { unitsUsed: 0, unit: "runs", costUsd: 0 },
      durationMs: Date.now() - started,
      error: { code, message },
    });
    const parsed = GhInputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused("error", "invalid_input", "Invalid GitHub Actions input.");
    }
    const token = requireEnv("GITHUB_TOKEN");
    const repo = requireEnv("GITHUB_REPO");
    const workflowId = requireEnv("GITHUB_WORKFLOW_ID");
    if (!token || !repo || !workflowId) {
      return paused(
        "not_configured",
        "not_configured",
        "Missing GITHUB_TOKEN / GITHUB_REPO / GITHUB_WORKFLOW_ID."
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify(parsed.data),
          signal: controller.signal,
        }
      );
      clearTimeout(timer);
      if (res.status === 204) {
        return {
          ok: true,
          toolId: GHA_TOOL_ID,
          jobId: req.jobId,
          status: "ok",
          output: { data: { dispatched: true, ref: parsed.data.ref } },
          usage: { unitsUsed: 1, unit: "runs", costUsd: 0 },
          durationMs: Date.now() - started,
        };
      }
      let detail = `http=${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) detail = body.message.slice(0, 200);
      } catch {
        // Keep the HTTP status as the detail.
      }
      if (res.status === 429) {
        return paused("rate_limited", "rate_limited", `GitHub rate limited. ${detail}`);
      }
      return paused("error", "upstream_error", `GitHub rejected the dispatch. ${detail}`);
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) {
        return paused("timeout", "timeout", "GitHub timed out.");
      }
      return paused("error", "unavailable", `GitHub unreachable: ${msg.slice(0, 120)}`);
    }
  },
};
