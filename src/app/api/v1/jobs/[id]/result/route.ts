import { success, failure, redactSecrets } from "@/lib/envelope";
import { getJob, JobApiError } from "@/lib/job-service";
import { getStorage } from "@/lib/storage";
import { db } from "@/lib/db";

/**
 * GET /api/v1/jobs/:id/result — final output metadata.
 *
 * Reads the persisted FinalVideo row plus compliance / quality reports,
 * script, storyboard and research summary. In Phase 3 these relations are
 * empty (artifacts land in Phases 5–7); the shape of the response is final.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  try {
    const job = await getJob(id);
    const [finalVideo, complianceReports, qualityReports, script, storyboard, research] =
      await Promise.all([
        db.finalVideo.findUnique({ where: { jobId: id } }),
        db.complianceReport.findMany({ where: { jobId: id }, orderBy: { assessedAt: "desc" }, take: 1 }),
        db.qualityReport.findMany({ where: { jobId: id }, orderBy: { assessedAt: "desc" }, take: 1 }),
        db.script.findUnique({ where: { jobId: id } }),
        db.storyboard.findUnique({ where: { jobId: id } }),
        db.productResearch.findUnique({ where: { jobId: id } }),
      ]);

    const succeededStages = job.stages.filter((s) => s.status === "succeeded").length;

    const storage = getStorage();
    const videoDownloadUrl = finalVideo
      ? await storage.signedUrl(id, finalVideo.storageKey).catch(() => null)
      : null;
    const srtDownloadUrl =
      finalVideo?.captionSrtKey != null
        ? await storage.signedUrl(id, finalVideo.captionSrtKey).catch(() => null)
        : null;
    const vttDownloadUrl =
      finalVideo?.captionVttKey != null
        ? await storage.signedUrl(id, finalVideo.captionVttKey).catch(() => null)
        : null;

    return success({
      jobId: id,
      status: job.status,
      ready: job.status === "COMPLETED" && !!finalVideo,
      video: finalVideo
        ? {
            storageKey: finalVideo.storageKey,
            downloadUrl: videoDownloadUrl,
            durationSeconds: finalVideo.durationSeconds,
            width: finalVideo.width,
            height: finalVideo.height,
            fps: finalVideo.fps,
            renderedAt: finalVideo.renderedAt.toISOString(),
          }
        : null,
      captions: {
        srtKey: finalVideo?.captionSrtKey ?? null,
        vttKey: finalVideo?.captionVttKey ?? null,
        srtDownloadUrl,
        vttDownloadUrl,
      },
      script: script
        ? { id: script.id, schemaVersion: script.schemaVersion, createdAt: script.createdAt }
        : null,
      storyboard: storyboard ? { id: storyboard.id } : null,
      researchSummary: research
        ? {
            productName: research.productName,
            brand: research.brand,
            category: research.category,
            sourceUrls: research.sourceUrls,
          }
        : null,
      complianceReport: complianceReports[0] ?? null,
      qualityReport: qualityReports[0] ?? null,
      progress: { succeededStages, totalStages: job.stages.length },
      note:
        job.status === "COMPLETED" && !finalVideo
          ? "Job completed but no FinalVideo row exists yet (Phase 3 runs simulated stages only; real rendering lands in Phase 6)."
          : null,
    });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error(`[GET /api/v1/jobs/${id}/result] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to retrieve job result.", 500);
  }
}
