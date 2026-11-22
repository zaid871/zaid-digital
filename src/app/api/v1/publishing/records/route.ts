/**
 * POST /api/v1/publishing/records — record a publish (or update one).
 *
 * Called by the IG/FB publishing workflows after a successful publish so
 * the repost monitor has real records to work with, and by the repost
 * workflow itself to mark variant outcomes. Two modes:
 *  - {id, ...fields}        -> update that record (variant status flow)
 *  - {platform, platformMediaId, ...} -> upsert by the compound unique key
 */
import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { db } from "@/lib/db";

const BodySchema = z.object({
  id: z.string().min(1).optional(),
  platform: z.enum(["instagram_reels", "facebook_reels"]).optional(),
  platformMediaId: z.string().min(1).max(128).optional(),
  videoUrl: z.string().url().max(2048).optional(),
  caption: z.string().max(2200).optional(),
  permalink: z.string().url().max(2048).optional(),
  productId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  publishedAt: z.string().datetime().optional(),
  status: z.string().min(1).max(32).optional(),
});

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid record payload.", 422, parsed.error.flatten());
  }
  const d = parsed.data;
  try {
    if (d.id) {
      const existing = await db.publishRecord.findUnique({ where: { id: d.id } });
      if (!existing) return failure("not_found", "Publish record not found.", 404);
      const record = await db.publishRecord.update({
        where: { id: d.id },
        data: {
          ...(d.platformMediaId !== undefined ? { platformMediaId: d.platformMediaId } : {}),
          ...(d.videoUrl !== undefined ? { videoUrl: d.videoUrl } : {}),
          ...(d.caption !== undefined ? { caption: d.caption } : {}),
          ...(d.permalink !== undefined ? { permalink: d.permalink } : {}),
          ...(d.publishedAt !== undefined ? { publishedAt: new Date(d.publishedAt) } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          errorMessage: null,
        },
      });
      return success({ record });
    }
    if (!d.platform || !d.platformMediaId) {
      return failure("validation_error", "platform and platformMediaId are required for upsert.", 422);
    }
    const record = await db.publishRecord.upsert({
      where: {
        platform_platformMediaId: { platform: d.platform, platformMediaId: d.platformMediaId },
      },
      update: {
        ...(d.videoUrl ? { videoUrl: d.videoUrl } : {}),
        ...(d.caption ? { caption: d.caption } : {}),
        ...(d.permalink ? { permalink: d.permalink } : {}),
        ...(d.publishedAt ? { publishedAt: new Date(d.publishedAt) } : {}),
        status: d.status ?? "published",
        errorMessage: null,
      },
      create: {
        platform: d.platform,
        platformMediaId: d.platformMediaId,
        videoUrl: d.videoUrl,
        caption: d.caption,
        permalink: d.permalink,
        productId: d.productId,
        jobId: d.jobId,
        publishedAt: d.publishedAt ? new Date(d.publishedAt) : new Date(),
        status: d.status ?? "published",
      },
    });
    return success({ record });
  } catch (err) {
    return failure("db_error", `Could not save publish record: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`, 500);
  }
}
