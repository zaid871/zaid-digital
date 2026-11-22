import { success, failure, redactSecrets } from "@/lib/envelope";
import { JobApiError } from "@/lib/job-service";
import { getStorage } from "@/lib/storage";
import { db } from "@/lib/db";

/** GET /api/v1/jobs/:id/assets — list job assets (scene + media assets) from Postgres. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  try {
    const job = await db.job.findUnique({ where: { id } });
    if (!job) throw new JobApiError("job_not_found", `No job found with id ${id}.`, 404);

    const [sceneAssets, mediaAssets] = await Promise.all([
      db.sceneAsset.findMany({ where: { jobId: id }, orderBy: { generatedAt: "asc" } }),
      db.mediaAsset.findMany({ where: { jobId: id }, orderBy: { retrievedAt: "asc" } }),
    ]);

    const storage = getStorage();
    const withUrls = async <T extends { storageKey: string | null }>(rows: T[]) =>
      Promise.all(
        rows.map(async (a) => ({
          ...a,
          downloadUrl:
            a.storageKey != null
              ? await storage.signedUrl(id, a.storageKey).catch(() => null)
              : null,
        }))
      );

    return success({
      jobId: id,
      sceneAssets: (await withUrls(sceneAssets)).map((a) => ({
        id: a.id,
        sceneId: a.sceneId,
        assetType: a.assetType,
        storageKey: a.storageKey,
        downloadUrl: a.downloadUrl,
        provider: a.provider,
        model: a.model,
        generatedAt: a.generatedAt.toISOString(),
      })),
      mediaAssets: (await withUrls(mediaAssets)).map((a) => ({
        id: a.id,
        assetType: a.assetType,
        sourceUrl: a.sourceUrl,
        storageKey: a.storageKey,
        downloadUrl: a.downloadUrl,
        rightsStatus: a.rightsStatus,
        retrievedAt: a.retrievedAt.toISOString(),
      })),
      total: sceneAssets.length + mediaAssets.length,
    });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error(`[GET /api/v1/jobs/${id}/assets] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to list job assets.", 500);
  }
}
