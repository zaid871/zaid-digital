import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { latestAutoGenerate } from "@/lib/digital/auto-generate";

/**
 * GET /api/v1/digital/auto-generate/latest — last auto-generate tick
 * summary (ledger tail, last 50 entries).
 */
export async function GET(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  return success(await latestAutoGenerate());
}
