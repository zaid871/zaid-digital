/**
 * Shared Power Pool — the third place (spec §11).
 *
 * Every model's output is deposited here AFTER separate generation; the
 * synthesis step draws what it needs from the pool. The pool stores
 * outputs (full responses, reasoning fragments, code, scores) — never
 * weights, never "thinking" itself. Each new prompt still needs fresh
 * inference; the pool is per-run memory, not a model.
 *
 * Storage: storage/hub/pool.jsonl (JSON lines, newest last, trimmed to
 * the last 500 deposits so the file cannot grow without bound).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { hubDir } from "./quota";
import type { PoolDeposit } from "./types";

const MAX_DEPOSITS = 500;

export function poolPath(): string {
  return join(hubDir(), "pool.jsonl");
}

function readLines(): string[] {
  try {
    if (!existsSync(poolPath())) return [];
    return readFileSync(poolPath(), "utf-8").split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

/** Deposit one contribution into the pool. Returns the deposit count for this run. */
export function deposit(dep: PoolDeposit): number {
  mkdirSync(hubDir(), { recursive: true });
  const lines = readLines();
  lines.push(JSON.stringify(dep));
  const kept = lines.slice(-MAX_DEPOSITS);
  writeFileSync(poolPath(), kept.join("\n") + "\n", "utf-8");
  return draw(dep.runId).length;
}

/** Draw every deposit of one run, in deposit order. */
export function draw(runId: string): PoolDeposit[] {
  const out: PoolDeposit[] = [];
  for (const line of readLines()) {
    try {
      const parsed = JSON.parse(line) as PoolDeposit;
      if (parsed.runId === runId) out.push(parsed);
    } catch {
      // A corrupt line never blocks a draw; it is skipped.
    }
  }
  return out;
}

/** Total deposits currently stored (for diagnostics). */
export function poolSize(): number {
  return readLines().length;
}
