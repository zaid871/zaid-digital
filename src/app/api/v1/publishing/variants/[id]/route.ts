/**
 * GET /api/v1/publishing/variants/[id] — variant build status.
 *
 * Polled by the repost workflow: "building" | "pending" -> keep waiting,
 * "ready" -> publish at the next best-time slot, "needs_review" ->
 * park for a human (never auto-publish a parked variant).
 */
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  const { id } = await params;
  const record = await db.publishRecord.findUnique({ where: { id } });
  if (!record) return failure("not_found", "Variant record not found.", 404);
  return success({
    id: record.id,
    status: record.status,
    caption: record.caption,
    videoUrl: record.videoUrl,
    platformMediaId: record.platformMediaId,
    variantOf: record.variantOf,
    errorMessage: record.errorMessage,
  });
}
