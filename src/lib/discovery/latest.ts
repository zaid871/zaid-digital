/**
 * Read the last Problem Miner run (storage/problem-miner/latest.json).
 *
 * Shared by GET /api/v1/discovery/problem-miner and
 * GET /api/v1/discovery/problem-miner/latest — the v2 generation
 * workflows' demand pre-check calls the /latest URL. Returns
 * { mined: false, problems: [] } when no run has happened yet — never
 * throws, so a workflow can proceed with a warning instead of blocking.
 */
import { readFile } from "fs/promises";
import { join } from "path";

export interface LatestProblem {
  text: string;
  score: number | null;
  niche: string;
  source: string;
}

export interface LatestProblems {
  mined: boolean;
  minedAt: string | null;
  problems: LatestProblem[];
}

export async function readLatestProblems(): Promise<LatestProblems> {
  const file = join(process.cwd(), "storage", "problem-miner", "latest.json");
  try {
    const raw = await readFile(file, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const problems = Array.isArray((parsed as { problems?: unknown }).problems)
      ? ((parsed as { problems: unknown[] }).problems as Array<Record<string, unknown>>)
      : [];
    return {
      mined: true,
      minedAt: (parsed as { minedAt?: string }).minedAt ?? null,
      problems: problems.slice(0, 10).map((p) => ({
        text: String(p.text ?? p.problem ?? ""),
        score: typeof p.score === "number" ? p.score : null,
        niche: String(p.niche ?? ""),
        source: String(p.source ?? ""),
      })),
    };
  } catch {
    return { mined: false, minedAt: null, problems: [] };
  }
}
