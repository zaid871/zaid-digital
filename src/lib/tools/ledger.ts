/**
 * Tool Registry ledger — every dispatch writes a row, including failed
 * and paused dispatches (mirrors src/lib/hub/ledger.ts: "No ledger row
 * = the run didn't happen"). Storage is storage/tools/ledger.jsonl
 * (JSON lines, newest last).
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { toolsDir } from "./quota";
import type { ToolLedgerEntry } from "./types";

export function toolLedgerPath(): string {
  return join(toolsDir(), "ledger.jsonl");
}

/** Append a dispatch row. Returns the ledger id. */
export function appendToolLedger(
  entry: Omit<ToolLedgerEntry, "ledgerId" | "createdAt">
): string {
  mkdirSync(toolsDir(), { recursive: true });
  const ledgerId = randomUUID();
  const full: ToolLedgerEntry = {
    ...entry,
    ledgerId,
    createdAt: new Date().toISOString(),
  };
  appendFileSync(toolLedgerPath(), JSON.stringify(full) + "\n", "utf-8");
  return ledgerId;
}

/** Read the most recent `limit` rows, newest first. Never throws. */
export function readToolLedger(limit = 20): ToolLedgerEntry[] {
  try {
    if (!existsSync(toolLedgerPath())) return [];
    const lines = readFileSync(toolLedgerPath(), "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const rows: ToolLedgerEntry[] = [];
    for (const line of lines.slice(-Math.max(1, limit))) {
      try {
        rows.push(JSON.parse(line) as ToolLedgerEntry);
      } catch {
        // A corrupt line never blocks a read; it is skipped.
      }
    }
    return rows.reverse();
  } catch {
    return [];
  }
}
