import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { readLatestBriefs } from "@/lib/digital/briefs";

/**
 * GET /api/v1/digital/briefs/latest — read the briefs queue (latest run).
 * Never an error when nothing was generated yet: { briefs: [] }.
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  return success(await readLatestBriefs());
}
