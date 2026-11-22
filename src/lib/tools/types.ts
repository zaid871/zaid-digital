/**
 * Tool Registry — shared types (design: docs/tool-registry.md).
 *
 * Mirrors src/lib/hub/types.ts: typed results, pause reasons, ledger
 * entries, env-configured IDs (never hardcoded secrets). A tool is only
 * "wired" after a live test (see docs/tool-registry.md §15) — code
 * existing is not wiring.
 */
import { z } from "zod";
import { randomUUID } from "crypto";

export const TOOL_CAPABILITIES = [
  "text-llm",
  "gpu-video",
  "lora-train",
  "gpu-batch",
  "parallel-compute",
  "webhook-ingress",
  "object-storage",
  "db-backup",
  "queue-backup",
  "email",
  "monitoring",
] as const;
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];

export const TOOL_STATUSES = ["candidate", "wired", "paused", "dead"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

/** Why a dispatch paused — always logged, never silent. */
export const TOOL_PAUSE_REASONS = [
  "timeout",
  "error",
  "rate_limited",
  "quota_exceeded",
  "duplicate",
  "too_short",
  "empty",
  "not_wired",
  "tool_dead",
  "not_configured",
] as const;
export type ToolPauseReason = (typeof TOOL_PAUSE_REASONS)[number];

export const ToolQuotaSchema = z.object({
  perDay: z.number().int().nonnegative().optional(),
  perWeek: z.number().int().nonnegative().optional(),
  perMonth: z.number().int().nonnegative().optional(),
  /** What one unit is: "requests", "gpu-minutes", "gpu-hours", "emails", "monitors". */
  unit: z.string().min(1),
});

/**
 * One registry entry. `secretEnv` holds only the env-var NAME (e.g.
 * "NVIDIA_API_KEY") — never a value. `adapter` names the code module
 * that implements the tool, or null when no adapter exists yet; a tool
 * with no adapter cannot be routed to.
 */
export const ToolEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: z.array(z.enum(TOOL_CAPABILITIES)).min(1),
  /** Verified numbers only — no marketing figure without a check date. */
  limits: z.record(z.string(), z.string()),
  quota: ToolQuotaSchema,
  /** When the free allowance ends or renews, e.g. "credit-based, refills monthly". */
  expiry: z.string().min(1),
  /** Next tool to try when this one pauses. Must itself be wired. */
  fallback: z.string().nullable(),
  cost: z.string().min(1),
  status: z.enum(TOOL_STATUSES),
  /** Last live check (YYYY-MM-DD). Older than 30 days = re-check before wiring. */
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  secretEnv: z.string().min(1).optional(),
  adapter: z.string().nullable(),
});
export type ToolEntry = z.infer<typeof ToolEntrySchema>;

export const ToolRegistryFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  tools: z.array(ToolEntrySchema),
});
export type ToolRegistryFile = z.infer<typeof ToolRegistryFileSchema>;

export const ToolRunRequestSchema = z.object({
  toolId: z.string().min(1),
  capability: z.enum(TOOL_CAPABILITIES),
  jobId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().positive().max(3_600_000).default(60_000),
});
export type ToolRunRequest = z.infer<typeof ToolRunRequestSchema>;

export interface ToolRunResult {
  ok: boolean;
  toolId: string;
  jobId: string;
  status: "ok" | "paused";
  pauseReason?: ToolPauseReason;
  output?: {
    files?: string[];
    data?: Record<string, unknown>;
    text?: string;
  };
  usage: { unitsUsed: number; unit: string; costUsd: 0 };
  durationMs: number;
  error?: { code: string; message: string };
}

export interface ToolLedgerEntry {
  ledgerId: string;
  runId: string;
  createdAt: string;
  toolId: string;
  capability: ToolCapability;
  jobId: string;
  ok: boolean;
  status: "ok" | "paused";
  pauseReason?: ToolPauseReason;
  errorCode?: string;
  unitsUsed: number;
  durationMs: number;
}

export interface ToolAdapter {
  id: string;
  capabilities: ToolCapability[];
  /** True when its secret env var is present. Never logs the value. */
  isConfigured(): boolean;
  run(req: ToolRunRequest): Promise<ToolRunResult>;
}

export function newToolRunId(): string {
  return randomUUID();
}

/** A tool whose lastVerified is older than this is re-checked before wiring. */
export const REGISTRY_STALE_DAYS = 30;

export function isStale(lastVerified: string, now = new Date()): boolean {
  const checked = new Date(`${lastVerified}T00:00:00Z`).getTime();
  if (Number.isNaN(checked)) return true;
  return now.getTime() - checked > REGISTRY_STALE_DAYS * 24 * 60 * 60 * 1000;
}
