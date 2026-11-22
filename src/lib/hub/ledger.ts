/**
 * Hub ledger — every run writes a row, including failed runs (spec §5:
 * "No ledger row = the run didn't happen"). Storage is
 * storage/hub/ledger.jsonl (JSON lines, newest last). Postgres
 * persistence is a deploy-time addition: the same entry shape is what
 * the Prisma layer will store, so the JSONL file is the source of truth
 * until the backend is deployed with its database.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { hubDir } from "./quota";
import type { LedgerEntry } from "./types";

export function ledgerPath(): string {
  return join(hubDir(), "ledger.jsonl");
}

/** Append a run row. Returns the ledger id. */
export function appendLedger(
  entry: Omit<LedgerEntry, "ledgerId" | "createdAt">
): string {
  mkdirSync(hubDir(), { recursive: true });
  const ledgerId = randomUUID();
  const full: LedgerEntry = {
    ...entry,
    ledgerId,
    createdAt: new Date().toISOString(),
  };
  appendFileSync(ledgerPath(), JSON.stringify(full) + "\n", "utf-8");
  return ledgerId;
}

/** Read the most recent `limit` rows, newest first. Never throws. */
export function readLedger(limit = 20): LedgerEntry[] {
  try {
    if (!existsSync(ledgerPath())) return [];
    const lines = readFileSync(ledgerPath(), "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const rows: LedgerEntry[] = [];
    for (const line of lines.slice(-Math.max(1, limit))) {
      try {
        rows.push(JSON.parse(line) as LedgerEntry);
      } catch {
        // A corrupt line never blocks a read; it is skipped.
      }
    }
    return rows.reverse();
  } catch {
    return [];
  }
}
