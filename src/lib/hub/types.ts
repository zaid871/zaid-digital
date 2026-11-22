/**
 * Unified Hub — shared types.
 *
 * Combination level (confirmed with the user, 2026-11-06, in his words):
 * APIs merge behind ONE gateway; the models stay separate; their outputs
 * gather in a third-place Shared Power Pool that later steps draw from.
 * No weight merge, no direct response merge, no shared thinking — the
 * pool joins outputs AFTER separate generation.
 *
 * Live model IDs (verified 2026-11-06 against console.groq.com/docs/models):
 * Groq free text legs are openai/gpt-oss-120b, openai/gpt-oss-20b and
 * qwen/qwen3.8-27b (Preview). Llama 3.1/3.3 are Enterprise-only and
 * DeepSeek-R1-Distill-Llama-70B is retired — never ship those IDs.
 * Model IDs are env config, never hardcoded into a call: the constants
 * below are only the defaults when the env var is unset.
 */
import { randomUUID } from "crypto";

/** Live-verified defaults (env overrides win — see router.ts). */
export const LIVE_GROQ_120B = "openai/gpt-oss-120b";
export const LIVE_GROQ_20B = "openai/gpt-oss-20b";
export const LIVE_GROQ_QWEN = "qwen/qwen3.8-27b";
export const LIVE_GEMINI_FLASH = "gemini-2.0-flash";

/** Fallback when the Qwen Preview model 404s (spec §10). */
export const QWEN_FALLBACK_MODEL = LIVE_GROQ_120B;

export function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

export function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type HubTaskKind =
  | "code"
  | "automation"
  | "n8n-json"
  | "reasoning"
  | "math"
  | "planning"
  | "long-doc"
  | "research"
  | "chat"
  | "summary"
  | "caption"
  | "image"
  | "video"
  | "ebook"
  | "template"
  | "document"
  | "spreadsheet";

export const HUB_TASK_KINDS: HubTaskKind[] = [
  "code",
  "automation",
  "n8n-json",
  "reasoning",
  "math",
  "planning",
  "long-doc",
  "research",
  "chat",
  "summary",
  "caption",
  "image",
  "video",
  "ebook",
  "template",
  "document",
  "spreadsheet",
];

/** Text modes. "engine" runs a built engine lane (image/video/digital). */
export type HubMode = "ensemble" | "pipeline" | "single" | "engine";

export type DeliverFormat =
  | "text"
  | "code"
  | "image"
  | "video"
  | "ebook-pdf"
  | "template-pack"
  | "docx"
  | "pptx"
  | "epub"
  | "xlsx"
  | "pdf-report";

export const HUB_DELIVER_FORMATS: DeliverFormat[] = [
  "text",
  "code",
  "image",
  "video",
  "ebook-pdf",
  "template-pack",
  "docx",
  "pptx",
  "epub",
  "xlsx",
  "pdf-report",
];

/** One lane of a run — only lanes the prompt asks for are opened (§11). */
export type HubLane = "text" | "code" | "visual" | "doc" | "video";

export type TextProvider = "groq" | "gemini";

export interface TextLeg {
  /** Stable id, e.g. "groq-120b". */
  id: string;
  provider: TextProvider;
  model: string;
}

/** One model's contribution to a run. */
export interface Contribution {
  legId: string;
  provider: TextProvider;
  model: string;
  lane: HubLane;
  text: string | null;
  status: "ok" | "paused";
  /** Why a contribution was paused — always logged, never silent. */
  pauseReason?: "timeout" | "error" | "rate_limited" | "quota_exceeded" | "duplicate" | "too_short" | "empty";
  durationMs: number;
  /** Deterministic score (0-100) used by the synthesizer; 0 when paused. */
  score: number;
}

/** One deposit into the Shared Power Pool (third place). */
export interface PoolDeposit {
  runId: string;
  lane: HubLane;
  legId: string;
  provider: TextProvider;
  model: string;
  kind: "text" | "code" | "image-prompt" | "plan" | "critique";
  text: string;
  score: number;
  createdAt: string;
}

export type SandboxStatus = "passed" | "failed" | "unavailable" | "skipped";
export type ComplianceStatus = "approved" | "rejected" | "needs_review" | "skipped";

export interface HubVerification {
  sandbox: SandboxStatus;
  sandboxDetail?: string;
  compliance: ComplianceStatus;
  complianceReasons?: string[];
  engine?: string;
  video?: "planned" | "rendered";
  retriesUsed: number;
}

export interface HubUsage {
  models: string[];
  calls: number;
  /** Always 0 on the free stack; kept so paid legs can never hide a cost. */
  costUsd: number;
}

export interface HubOutput {
  kind: DeliverFormat | "video-package";
  text?: string;
  files?: string[];
  /** Structured payload (e.g. video job payload, spreadsheet counts). */
  data?: Record<string, unknown>;
}

export interface HubErrorBody {
  code: string;
  message: string;
}

export interface HubResult {
  ok: boolean;
  runId: string;
  ledgerId: string;
  mode: HubMode;
  output: HubOutput;
  verification: HubVerification;
  usage: HubUsage;
  pool: { deposits: number; survivors: number };
  error?: HubErrorBody;
}

export interface LedgerEntry {
  ledgerId: string;
  runId: string;
  createdAt: string;
  taskKind: HubTaskKind;
  mode: HubMode;
  deliverFormat: DeliverFormat;
  models: string[];
  calls: number;
  costUsd: number;
  ok: boolean;
  errorCode?: string;
  verification: HubVerification;
  durationMs: number;
}

export class HubError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function newRunId(): string {
  return randomUUID();
}
