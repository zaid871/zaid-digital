/**
 * Phase 6 — final delivery.
 *
 * Runs AFTER quality_assurance and ONLY when QA returned PASS or
 * PASS_WITH_WARNINGS. Persists the FinalVideo row, registers the file
 * with the storage backend, and marks the job COMPLETED — but only after
 * the rendered file is verified present on disk.
 *
 * Never marks COMPLETED without: a passing QA verdict on record, and a
 * verified final.mp4.
 */
import { existsSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db";
import { canTransition } from "@/lib/job-stages";
import { transitionJob, updateStage } from "@/lib/job-service";
import { getStorage } from "@/lib/storage";
import { jobAssetsDir, sha256File } from "./assets";
import { renderGif } from "./gif";
import { probeFull } from "./render";

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

async function emitEvent(jobId: string, type: string, message: string) {
  await db.jobEvent.create({ data: { jobId, type, message } });
}

/**
 * Run the final_delivery stage. Throws DeliveryError when preconditions
 * are not met (missing QA pass, missing file) — the worker maps this to
 * stage FAILED; the job is NOT marked complete.
 */
export async function runDeliveryStage(jobId: string): Promise<void> {
  await updateStage(jobId, "final_delivery", {
    status: "running",
    progressPct: 30,
    message: "Verifying render output and publishing the final video.",
  });

  // Precondition 1: a passing QA verdict must be on record.
  const qa = await db.qualityReport.findFirst({
    where: { jobId },
    orderBy: { assessedAt: "desc" },
  });
  if (!qa || (qa.verdict !== "PASS" && qa.verdict !== "PASS_WITH_WARNINGS")) {
    throw new DeliveryError(
      `Refusing delivery: no passing QA verdict on record (found: ${qa?.verdict ?? "none"}).`
    );
  }

  // Precondition 2: the file must exist on disk and probe cleanly.
  const dir = jobAssetsDir(jobId);
  const finalPath = join(dir, "final.mp4");
  if (!existsSync(finalPath)) {
    throw new DeliveryError(`Refusing delivery: final.mp4 missing at ${finalPath}.`);
  }
  const probe = await probeFull(finalPath);
  if (!probe.hasVideo || !probe.hasAudio || probe.width !== 1080 || probe.height !== 1920) {
    throw new DeliveryError(
      `Refusing delivery: final.mp4 failed verification (${probe.width}x${probe.height}, video=${probe.hasVideo}, audio=${probe.hasAudio}).`
    );
  }

  await updateStage(jobId, "final_delivery", { status: "running", progressPct: 60, message: "Registering final video with storage." });

  // Register with the storage backend (local: key under the job dir).
  const storage = getStorage();
  const videoKey = await storage.put(finalPath, `${jobId}/final.mp4`);
  const srtKey = `${jobId}/captions.srt`;
  const vttKey = `${jobId}/captions.vtt`;
  const downloadUrl = await storage.signedUrl(jobId, videoKey);

  const durationSeconds = probe.durationSec ?? 0;

  // ---- Opt-in GIF preview (job.gifRequested only; default OFF) --------
  // The MP4 above is already verified and registered, so a GIF failure
  // is a warning, never a delivery failure — the video is the
  // deliverable and it ships regardless.
  let gifKey: string | null = null;
  const gifWarnings: string[] = [];
  const jobRow = await db.job.findUnique({ where: { id: jobId } });
  if (jobRow?.gifRequested) {
    try {
      const gifPath = join(dir, "preview.gif");
      const gif = await renderGif({ input: finalPath, output: gifPath });
      gifKey = await storage.put(gifPath, `${jobId}/preview.gif`);
      await db.mediaAsset.create({
        data: {
          jobId,
          assetType: "gif_preview",
          sourceUrl: null,
          storageKey: gifKey,
          rightsStatus: "ai_generated",
          attribution: null,
          permittedUses: ["download"],
          contentHash: sha256File(gifPath),
        },
      });
      await emitEvent(
        jobId,
        "gif_ready",
        `GIF preview ready: ${gifKey} (${gif.width}x${gif.height}@${gif.fps}fps, ${gif.durationSec.toFixed(1)}s, ${(gif.bytes / 1024).toFixed(0)} KB).`
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      gifWarnings.push(`GIF preview failed (video unaffected): ${detail.slice(0, 200)}`);
      await emitEvent(
        jobId,
        "gif_failed",
        `GIF preview failed, video delivery unaffected: ${detail.slice(0, 300)}`
      );
    }
  }

  await db.finalVideo.upsert({
    where: { jobId },
    create: {
      jobId,
      schemaVersion: "1.0.0",
      storageKey: videoKey,
      captionSrtKey: srtKey,
      captionVttKey: vttKey,
      gifKey,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      durationSeconds,
    },
    update: {
      schemaVersion: "1.0.0",
      storageKey: videoKey,
      captionSrtKey: srtKey,
      captionVttKey: vttKey,
      gifKey,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      durationSeconds,
    },
  });

  // Surface the deliverable in the asset list.
  await db.mediaAsset.create({
    data: {
      jobId,
      assetType: "final_video",
      sourceUrl: null,
      storageKey: videoKey,
      rightsStatus: "ai_generated",
      attribution: null,
      permittedUses: ["download", "publish"],
      contentHash: sha256File(finalPath),
    },
  });

  await emitEvent(
    jobId,
    "delivery_complete",
    `Final video published: ${videoKey} (${durationSeconds.toFixed(1)}s, 1080x1920@${probe.fps}fps). Download: ${downloadUrl}`
  );
  await updateStage(jobId, "final_delivery", {
    status: "succeeded",
    progressPct: 100,
    message: gifKey ? "Final video published and verified (GIF preview ready)." : "Final video published and verified.",
    warnings: gifWarnings,
  });

  const job = await db.job.findUnique({ where: { id: jobId } });
  const status = job!.status as Parameters<typeof canTransition>[0];
  if (status !== "COMPLETED" && canTransition(status, "COMPLETED")) {
    await transitionJob(jobId, "COMPLETED", "Final video delivered and verified.");
  }
}
