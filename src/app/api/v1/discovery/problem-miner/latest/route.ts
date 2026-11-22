import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { readLatestProblems } from "@/lib/discovery/latest";

/**
 * GET /api/v1/discovery/problem-miner/latest — read the last mined top-10.
 *
 * This is the URL the v2 generation workflows' demand pre-check calls.
 * Same payload as GET /api/v1/discovery/problem-miner: { mined, minedAt,
 * problems } — { mined: false, problems: [] } when no weekly run has
 * happened yet, never an error, so a workflow proceeds with a warning
 * instead of blocking on missing data.
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  return success(await readLatestProblems());
}
