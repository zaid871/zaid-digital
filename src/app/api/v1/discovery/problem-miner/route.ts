import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { mineProblems } from "@/lib/discovery/problem-miner";
import { readLatestProblems } from "@/lib/discovery/latest";

/**
 * GET /api/v1/discovery/problem-miner — read the last mined top-10.
 *
 * Same payload as GET /api/v1/discovery/problem-miner/latest (the URL the
 * v2 generation workflows' demand pre-check calls): { mined: true,
 * problems } when a weekly run has happened, or { mined: false,
 * problems: [] } when it hasn't — never an error, so a workflow can
 * proceed with a warning instead of blocking on missing data.
 */

/**
 * POST /api/v1/discovery/problem-miner — Problem Miner v1 weekly run.
 *
 * Body: { niches: ["meal prep", "budgeting"], subreddits?: [...], maxPerNiche?: 10, includeFixMyItch?: true }
 * Mines Reddit (public JSON) + Google/Amazon/YouTube Suggest (keyless) +
 * Fix My Itch (live fetch, verified seed fallback) + Google Trends
 * (pytrends bridge: direction + rising related queries, degrades to
 * "unknown" / {}). Deterministic scoring, no AI quota.
 * Top-10 problems + rising queries saved to storage/problem-miner/latest.json
 * for review → pre-sell gate feed + idea briefs.
 */
const bodySchema = z.object({
  niches: z.array(z.string().min(2).max(60)).min(1).max(5),
  subreddits: z.array(z.string().min(2).max(40)).max(8).optional(),
  maxPerNiche: z.number().int().min(1).max(20).optional(),
  includeFixMyItch: z.boolean().optional(),
});

export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  return success(await readLatestProblems());
}

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid problem-miner payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await mineProblems(parsed.data);
    const dir = join(process.cwd(), "storage", "problem-miner");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "latest.json"), JSON.stringify(result, null, 2));
    return success(result);
  } catch (err) {
    return failure("mine_failed", err instanceof Error ? err.message : String(err), 502);
  }
}
