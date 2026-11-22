/**
 * Tool dispatch — routes a job to a tool by CAPABILITY, never by tool
 * name (design §6). Order: routable tools first (wired + adapter +
 * not stale), then explicit fallback links. Max 2 attempts per job.
 * Quota is checked BEFORE each call; every attempt — success, pause,
 * failure — writes a ledger row. A dispatch that reaches no tool
 * returns a typed `tool_not_wired` pause, never a fake success.
 *
 * Tools without an adapter in ADAPTERS cannot be routed to, even when
 * the registry lists them: hub legs (groq/gemini) dispatch through the
 * hub, the HF Space dispatches through the video pool, and Pingzen has
 * no adapter code yet (candidate). Modal, Kaggle and Workers adapters
 * were added 2026-11-22 (Phase 2) — they stay candidate until a live
 * test flips their registry status.
 */
import { z } from "zod";
import { getTool, loadRegistry, routableTools } from "./registry";
import { checkToolQuota, recordToolUse } from "./quota";
import { appendToolLedger } from "./ledger";
import { nimAdapter } from "./adapters/nim";
import { resendAdapter } from "./adapters/resend";
import { githubActionsAdapter } from "./adapters/github-actions";
import { r2Adapter } from "./adapters/r2";
import { modalAdapter } from "./adapters/modal";
import { kaggleAdapter } from "./adapters/kaggle";
import { cfWorkersAdapter } from "./adapters/cf-workers";
import {
  TOOL_CAPABILITIES,
  type ToolAdapter,
  type ToolCapability,
  type ToolEntry,
  type ToolRunResult,
} from "./types";

export const DispatchInputSchema = z.object({
  capability: z.enum(TOOL_CAPABILITIES),
  jobId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().positive().max(3_600_000).default(60_000),
});
export type DispatchInput = z.infer<typeof DispatchInputSchema>;

export type DispatchOutcome = ToolRunResult & { ledgerId: string };

const ADAPTERS: Record<string, ToolAdapter> = {
  nim: nimAdapter,
  resend: resendAdapter,
  "github-actions": githubActionsAdapter,
  // Registry key is "s3-storage" (shared by the r2 and b2 entries) —
  // the module is r2.ts, but dispatch looks up by the registry's
  // adapter field, not by file name. A "r2" key here used to silently
  // miss and return tool_not_wired for both entries (fixed 2026-11-22).
  "s3-storage": r2Adapter,
  modal: modalAdapter,
  kaggle: kaggleAdapter,
  "cf-workers": cfWorkersAdapter,
};

const MAX_ATTEMPTS = 2;

function ledger(
  entry: ToolEntry | null,
  input: DispatchInput,
  result: ToolRunResult
): string {
  return appendToolLedger({
    runId: input.jobId,
    toolId: entry?.id ?? "none",
    capability: input.capability,
    jobId: input.jobId,
    ok: result.ok,
    status: result.status,
    pauseReason: result.pauseReason,
    errorCode: result.error?.code,
    unitsUsed: result.usage.unitsUsed,
    durationMs: result.durationMs,
  });
}

function pausedResult(
  toolId: string,
  input: DispatchInput,
  reason: NonNullable<ToolRunResult["pauseReason"]>,
  code: string,
  message: string
): ToolRunResult {
  return {
    ok: false,
    toolId,
    jobId: input.jobId,
    status: "paused",
    pauseReason: reason,
    usage: { unitsUsed: 0, unit: "units", costUsd: 0 },
    durationMs: 0,
    error: { code, message },
  };
}

export async function dispatchTool(
  input: DispatchInput
): Promise<DispatchOutcome> {
  const { tools } = loadRegistry();
  const attempts: ToolEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: ToolEntry | null): void => {
    if (!entry || seen.has(entry.id) || attempts.length >= MAX_ATTEMPTS) return;
    seen.add(entry.id);
    attempts.push(entry);
  };
  for (const entry of routableTools(tools, input.capability)) push(entry);
  // Follow explicit fallback links from the first routable tool.
  let cursor = attempts[0] ?? null;
  while (cursor?.fallback) {
    const next = getTool(tools, cursor.fallback);
    if (!next) break;
    if (routableTools(tools, input.capability).some((t) => t.id === next.id)) {
      push(next);
    }
    cursor = next;
  }

  if (attempts.length === 0) {
    const result = pausedResult(
      "none",
      input,
      "not_wired",
      "tool_not_wired",
      `No wired tool offers capability "${input.capability}". Check GET /api/v1/tools/registry — the tool may still be a candidate (no live test yet) or dead.`
    );
    return { ...result, ledgerId: ledger(null, input, result) };
  }

  let last: DispatchOutcome | null = null;
  for (const entry of attempts) {
    const quota = checkToolQuota(
      entry.id,
      {
        perDay: entry.quota.perDay,
        perWeek: entry.quota.perWeek,
        perMonth: entry.quota.perMonth,
      },
      entry.quota.unit
    );
    if (!quota.allowed) {
      const result = pausedResult(
        entry.id,
        input,
        "quota_exceeded",
        "quota_exceeded",
        `Tool "${entry.id}" is out of quota (${entry.quota.unit} remaining: ${quota.remaining}).`
      );
      last = { ...result, ledgerId: ledger(entry, input, result) };
      continue;
    }
    const adapter = entry.adapter ? ADAPTERS[entry.adapter] : undefined;
    if (!adapter) {
      const result = pausedResult(
        entry.id,
        input,
        "not_wired",
        "tool_not_wired",
        `Tool "${entry.id}" is wired in the registry but has no adapter code (${entry.adapter ?? "none"}).`
      );
      last = { ...result, ledgerId: ledger(entry, input, result) };
      continue;
    }
    const result = await adapter.run({
      toolId: entry.id,
      capability: input.capability as ToolCapability,
      jobId: input.jobId,
      input: input.input,
      timeoutMs: input.timeoutMs,
    });
    recordToolUse(entry.id, result.usage.unitsUsed);
    return { ...result, ledgerId: ledger(entry, input, result) };
  }
  // Every attempt paused (quota / not-wired / not-configured): return the last one.
  return (
    last ?? {
      ...pausedResult(
        "none",
        input,
        "not_wired",
        "tool_not_wired",
        "No tool could take this job."
      ),
      ledgerId: ledger(null, input, {
        ok: false,
        toolId: "none",
        jobId: input.jobId,
        status: "paused",
        pauseReason: "not_wired",
        usage: { unitsUsed: 0, unit: "units", costUsd: 0 },
        durationMs: 0,
      }),
    }
  );
}
