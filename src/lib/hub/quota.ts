/**
 * Hub quota guard — Groq free-tier daily allowances, enforced BEFORE the
 * call, never after (spec §5). Each live text model gets its own
 * allowance (30 RPM / 1,000 RPD / 8,000 TPM per model, verified
 * 2026-11-06). This guard tracks requests/day per model in
 * storage/hub/quota.json. On limit the leg is paused with typed
 * `quota_exceeded` — never a silent fallback that pretends success.
 *
 * Counters reset when the calendar date changes (Asia/Calcutta day).
 * Single-process file store: the backend runs one Node process per
 * container, and every hub call awaits its quota check+record in
 * sequence, so no two calls interleave inside one process.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { envInt } from "./types";

export const HUB_DAILY_REQUEST_LIMIT = 1000;

export function hubDir(): string {
  return process.env.HUB_STORAGE_DIR || join(process.cwd(), "storage", "hub");
}

export function quotaPath(): string {
  return join(hubDir(), "quota.json");
}

interface QuotaFile {
  date: string;
  counts: Record<string, number>;
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Calcutta" });
}

function readQuotaFile(): QuotaFile {
  const today = todayKey();
  try {
    if (!existsSync(quotaPath())) return { date: today, counts: {} };
    const parsed = JSON.parse(readFileSync(quotaPath(), "utf-8")) as QuotaFile;
    if (parsed.date !== today || !parsed.counts || typeof parsed.counts !== "object") {
      return { date: today, counts: {} };
    }
    return parsed;
  } catch {
    return { date: today, counts: {} };
  }
}

function writeQuotaFile(data: QuotaFile): void {
  mkdirSync(hubDir(), { recursive: true });
  writeFileSync(quotaPath(), JSON.stringify(data, null, 2), "utf-8");
}

export function dailyLimit(): number {
  return envInt("HUB_DAILY_REQUEST_LIMIT", HUB_DAILY_REQUEST_LIMIT);
}

/** Check a model before calling it. Never throws — a broken counter file means "allow", logged by the caller via `remaining: -1`. */
export function checkQuota(model: string): { allowed: boolean; remaining: number } {
  const data = readQuotaFile();
  const used = data.counts[model] ?? 0;
  const limit = dailyLimit();
  return { allowed: used < limit, remaining: Math.max(0, limit - used) };
}

/** Record one completed provider call (call this once per attempt that reached the provider). */
export function recordUse(model: string): void {
  const data = readQuotaFile();
  data.counts[model] = (data.counts[model] ?? 0) + 1;
  writeQuotaFile(data);
}

/** Test helper: set a model's counter directly. */
export function setQuotaCount(model: string, count: number): void {
  const data = readQuotaFile();
  data.counts[model] = count;
  writeQuotaFile(data);
}
