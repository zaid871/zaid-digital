/**
 * Shard helper — split a big list into N shards and dispatch each shard
 * as one tool run (design: one dispatch per shard, the tool executes
 * shards in parallel on its own side — e.g. 20 GitHub Actions runners,
 * or one Modal call per shard).
 *
 * Dispatches run SEQUENTIALLY from here on purpose: each dispatch is a
 * quick API call, and the quota guard inside dispatchTool is per-call,
 * so sequential dispatch keeps quota accounting exact. The parallelism
 * lives on the tool side, not in this loop.
 */
import { dispatchTool, type DispatchOutcome } from "./dispatch";
import type { ToolCapability } from "./types";

/** Even split: shards differ by at most one item; empty shards dropped. */
export function splitIntoShards<T>(items: T[], shardCount: number): T[][] {
  const n = Math.max(1, Math.floor(shardCount));
  if (items.length === 0) return [];
  const size = Math.ceil(items.length / n);
  const shards: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    shards.push(items.slice(i, i + size));
  }
  return shards;
}

export interface ShardRunInput<T> {
  capability: ToolCapability;
  jobId: string;
  items: T[];
  shardCount: number;
  timeoutMs?: number;
  /** Build one dispatch input per shard (index 0-based). */
  shardInput: (shard: T[], index: number, total: number) => Record<string, unknown>;
}

export interface ShardRunResult {
  ok: boolean;
  shards: DispatchOutcome[];
  succeeded: number;
  failed: number;
}

/** Dispatch every shard; returns the per-shard outcomes (never throws). */
export async function runSharded<T>(input: ShardRunInput<T>): Promise<ShardRunResult> {
  const shards = splitIntoShards(input.items, input.shardCount);
  const outcomes: DispatchOutcome[] = [];
  for (let i = 0; i < shards.length; i++) {
    const outcome = await dispatchTool({
      capability: input.capability,
      jobId: `${input.jobId}-shard-${i}`,
      input: input.shardInput(shards[i], i, shards.length),
      timeoutMs: input.timeoutMs ?? 60_000,
    });
    outcomes.push(outcome);
  }
  return {
    ok: outcomes.every((o) => o.ok),
    shards: outcomes,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
  };
}
