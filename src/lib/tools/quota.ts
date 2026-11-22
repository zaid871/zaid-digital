/**
 * Tool Registry — quota guard (mirrors src/lib/hub/quota.ts).
 *
 * Counters live in storage/tools/quota.json, date-keyed on the
 * Asia/Calcutta day. Checked BEFORE a dispatch, never after: on limit
 * the tool pauses with typed `quota_exceeded`. Never throws — a broken
 * counter file means "allow", and the caller logs remaining: -1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { envInt } from "../hub/types";

export function toolsDir(): string {
  return (
    process.env.TOOLS_STORAGE_DIR ||
    join(process.cwd(), "storage", "tools")
  );
}

export function quotaPath(): string {
  return join(toolsDir(), "quota.json");
}

interface ToolCounts {
  day: number;
  week: number;
  month: number;
}

interface QuotaFile {
  /** Asia/Calcutta calendar day (YYYY-MM-DD). */
  date: string;
  /** ISO week key, e.g. "2026-W47". */
  week: string;
  /** Month key, e.g. "2026-11". */
  month: string;
  counts: Record<string, ToolCounts>;
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Calcutta" });
}

function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function emptyCounts(): ToolCounts {
  return { day: 0, week: 0, month: 0 };
}

function readQuotaFile(): QuotaFile {
  const date = todayKey();
  const week = isoWeekKey();
  const month = monthKey();
  try {
    if (!existsSync(quotaPath())) {
      return { date, week, month, counts: {} };
    }
    const parsed = JSON.parse(readFileSync(quotaPath(), "utf-8")) as QuotaFile;
    if (!parsed.counts || typeof parsed.counts !== "object") {
      return { date, week, month, counts: {} };
    }
    // Reset windows that rolled over; keep the others.
    const counts: Record<string, ToolCounts> = {};
    for (const [toolId, c] of Object.entries(parsed.counts)) {
      counts[toolId] = {
        day: parsed.date === date ? c.day : 0,
        week: parsed.week === week ? c.week : 0,
        month: parsed.month === month ? c.month : 0,
      };
    }
    return { date, week, month, counts };
  } catch {
    return { date, week, month, counts: {} };
  }
}

function writeQuotaFile(data: QuotaFile): void {
  mkdirSync(toolsDir(), { recursive: true });
  writeFileSync(quotaPath(), JSON.stringify(data, null, 2), "utf-8");
}

export interface QuotaCheck {
  allowed: boolean;
  /** Units left in the tightest window, or -1 when the counter is unreadable. */
  remaining: number;
  unit: string;
}

/**
 * Check a tool before dispatching. `caps` are the entry's numeric
 * quota (perDay/perWeek/perMonth) in `unit`. A missing cap = no limit
 * on that window. `HUB_DAILY_REQUEST_LIMIT`-style env override is not
 * used here — each tool's cap comes from its registry entry.
 */
export function checkToolQuota(
  toolId: string,
  caps: { perDay?: number; perWeek?: number; perMonth?: number },
  unit: string
): QuotaCheck {
  const data = readQuotaFile();
  const used = data.counts[toolId] ?? emptyCounts();
  const remaining: number[] = [];
  if (caps.perDay !== undefined) remaining.push(caps.perDay - used.day);
  if (caps.perWeek !== undefined) remaining.push(caps.perWeek - used.week);
  if (caps.perMonth !== undefined) remaining.push(caps.perMonth - used.month);
  if (remaining.length === 0) return { allowed: true, remaining: -1, unit };
  const left = Math.min(...remaining);
  return { allowed: left > 0, remaining: Math.max(0, left), unit };
}

/** Record units used by one completed dispatch (call once per attempt that reached the tool). */
export function recordToolUse(toolId: string, units: number): void {
  const data = readQuotaFile();
  const used = data.counts[toolId] ?? emptyCounts();
  data.counts[toolId] = {
    day: used.day + units,
    week: used.week + units,
    month: used.month + units,
  };
  writeQuotaFile(data);
}

/** Test helper: set a tool's counters directly. */
export function setToolQuotaCount(
  toolId: string,
  counts: Partial<ToolCounts>
): void {
  const data = readQuotaFile();
  const used = data.counts[toolId] ?? emptyCounts();
  data.counts[toolId] = { ...used, ...counts };
  writeQuotaFile(data);
}

/** Daily request cap override for text legs, mirroring the hub env knob. */
export function dailyLimit(): number {
  return envInt("HUB_DAILY_REQUEST_LIMIT", 1000);
}
