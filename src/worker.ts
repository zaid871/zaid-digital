/**
 * BullMQ background worker — Phase 3.
 *
 * Consumes the `video-jobs` queue, drives each job through the 15 canonical
 * stages in order, and persists every transition as JobStage + JobEvent rows
 * in Postgres. Crash-safe: already-succeeded stages are skipped on re-entry,
 * and stages stuck in `running` (previous worker died) are recovered.
 *
 * ============================================================================
 * SIMULATION NOTICE (Phases 3–4; creative stages are REAL since Phase 5)
 * ----------------------------------------------------------------------------
 * Research stages (url_validation … compliance_review) still perform a
 * short SIMULATED unit of work (a sleep); every persisted result there is
 * explicitly marked `simulated: true` (see SIMULATED_STAGE_RESULT).
 *
 * The six creative stages (creative_planning → script_generation →
 * voiceover_generation → storyboard_generation → ai_visual_generation →
 * ai_video_generation) run the REAL Phase 5 creative pipeline
 * (runCreativePipeline): free-provider script/TTS/image/video generation
 * with typed errors on failure — never fabricated, never mislabeled.
 * The final three stages run the REAL Phase 6 pipeline:
 * editing_and_rendering → render.ts (ffmpeg assembly, bounded ≤2 retries
 * on transient errors), quality_assurance → qa.ts (technical + content
 * checks; NEEDS_REVIEW parks the job, FAILED stops the pipeline without
 * auto-retry), final_delivery → delivery.ts (persists FinalVideo only
 * after a passing QA verdict and on-disk verification).
 * This worker NEVER claims a provider is configured or that real
 * generation happened when it did not.
 * ============================================================================
 *
 * Run:  npm run worker   (requires DATABASE_URL and REDIS_URL)
 */
import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { QUEUE_NAMES } from "@/lib/queue";
import {
  canTransition,
  type JobStatus,
  type JobStageKey,
} from "@/lib/job-stages";
import {
  STAGE_JOB_STATUS,
  transitionJob,
  updateStage,
  JobApiError,
} from "@/lib/job-service";
import {
  buildInputsFromDb,
  runCreativePipeline,
} from "@/lib/pipeline/creative";
import { runRenderStage } from "@/lib/pipeline/render";
import { runQualityAssuranceStage } from "@/lib/pipeline/qa";
import { runDeliveryStage } from "@/lib/pipeline/delivery";
import { PipelineError } from "@/lib/pipeline/types";

const SIMULATED_STAGE_RESULT = {
  simulated: true,
  note: "SIMULATED stage — Phase 3 placeholder. No provider was called and no real media was produced. Real provider logic lands in Phases 4-6.",
} as const;

const SIMULATED_WARNING =
  "simulated:true — no provider call was made; real provider logic lands in Phases 4-6";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.error("[worker] FATAL: REDIS_URL is not set. Set it in .env and restart.");
    process.exit(1);
  }
  return { url, maxRetriesPerRequest: null as never };
}

/**
 * Drive one job through its stages. Idempotent: re-entry skips stages that
 * already succeeded, so BullMQ redeliveries and retries resume safely.
 */
async function driveJob(dbJobId: string): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: dbJobId },
    include: { stages: true },
  });
  if (!job) {
    // No DB row for this queue message — nothing to drive; fail loudly so
    // the queue job is marked failed instead of silently succeeding.
    throw new Error(`[worker] No Job row found for id ${dbJobId}; refusing to process.`);
  }

  const status = job.status as JobStatus;
  if (status === "COMPLETED" || status === "CANCELLED") return;
  if (status === "CANCEL_REQUESTED") {
    await transitionJob(dbJobId, "CANCELLED", "Cancelled before the worker started.");
    return;
  }

  // Crash recovery: a previous worker may have died mid-stage.
  const stuck = job.stages.filter((s) => s.status === "running");
  for (const s of stuck) {
    await updateStage(dbJobId, s.stageKey, {
      status: "pending",
      progressPct: 0,
      message: "Recovered: previous worker exited while this stage was running.",
      warnings: [],
    });
  }

  // Retry recovery: stages left `failed` by an earlier attempt are reset so
  // this drive resumes from the first unfinished stage (bounded by BullMQ
  // `attempts`, configured on enqueue).
  const failed = await db.jobStage.findMany({
    where: { jobId: dbJobId, status: "failed" },
  });
  for (const s of failed) {
    await db.jobStage.update({
      where: { id: s.id },
      data: { status: "pending", progressPct: 0, startedAt: null, finishedAt: null, message: null, warnings: [], retryCount: { increment: 1 } },
    });
    await db.retryRecord.create({
      data: { jobId: dbJobId, stageKey: s.stageKey, attempt: s.retryCount + 1, reason: "Worker re-drive after failure", retryable: true },
    });
    await db.jobEvent.create({
      data: { jobId: dbJobId, type: "stage_retry", message: `Stage ${s.stageKey} reset to pending for another attempt.` },
    });
  }

  const stages = await db.jobStage.findMany({
    where: { jobId: dbJobId },
    orderBy: { order: "asc" },
  });

  for (const stage of stages) {
    // Cooperative cancellation: check before every stage.
    const fresh = await db.job.findUnique({ where: { id: dbJobId } });
    const freshStatus = fresh!.status as JobStatus;
    if (freshStatus === "CANCEL_REQUESTED" || freshStatus === "CANCELLED") {
      await transitionJob(dbJobId, "CANCELLED", "Cancelled by user during processing.");
      return;
    }

    const current = await db.jobStage.findUnique({ where: { id: stage.id } });
    if (!current || ["succeeded", "skipped"].includes(current.status)) continue;

    const stageKey = stage.stageKey as JobStageKey;

    // Advance the job-level status to the band this stage runs in.
    const target = STAGE_JOB_STATUS[stageKey];
    if (freshStatus !== target && canTransition(freshStatus, target)) {
      await transitionJob(dbJobId, target, `Stage ${stageKey} started.`);
    }

    await updateStage(dbJobId, stageKey, { status: "running", progressPct: 10 });

    try {
      if (stageKey === "creative_planning") {
        // ============ PHASE 5: REAL CREATIVE PIPELINE ============
        // Drives all six creative stages itself (planning → script →
        // voiceover → storyboard → AI visuals → AI video), persisting each
        // stage row and its assets. The loop below skips stages the
        // pipeline already marked succeeded.
        const inputs = await buildInputsFromDb(dbJobId);
        if (!inputs) {
          throw new PipelineError(
            "research_missing",
            "creative_planning",
            "No product research data found for this job (research stages are still simulated). " +
              "The creative pipeline requires real ProductResearch/ProductIdentity rows — refusing to invent product facts.",
            false
          );
        }
        await runCreativePipeline(dbJobId, inputs.facts, inputs.identity);
        // Pipeline marked its six stages itself with real results —
        // nothing more to do for this stage.
        // ==========================================================
      } else if (stageKey === "editing_rendering") {
        // ============ PHASE 6: REAL RENDER ========================
        // render.ts assembles scene MP4s + MP3s into the final video
        // (bounded ≤2 retries on transient ffmpeg errors only).
        await runRenderStage(dbJobId);
        // ==========================================================
      } else if (stageKey === "quality_assurance") {
        // ============ PHASE 6: REAL QA ============================
        // qa.ts runs technical + content checks. NEEDS_REVIEW parks the
        // job for a human; FAILED stops the pipeline. Neither throws —
        // both are handled outcomes, so we return instead of continuing
        // to delivery. QA FAILED never auto-retries the pipeline.
        const verdict = await runQualityAssuranceStage(dbJobId);
        if (verdict === "NEEDS_REVIEW" || verdict === "FAILED") {
          return; // parked/failed by QA — do not proceed to delivery
        }
        // ==========================================================
      } else if (stageKey === "final_delivery") {
        // ============ PHASE 6: REAL DELIVERY ======================
        // delivery.ts persists the FinalVideo row only after a passing
        // QA verdict and on-disk verification, then marks COMPLETED.
        await runDeliveryStage(dbJobId);
        // ==========================================================
      } else {
        // ================= SIMULATION BLOCK (Phases 3–4) =================
        // Remaining stages still simulate; the persisted result is
        // explicitly marked simulated. Real logic lands in Phase 6.
        await sleep(700 + Math.random() * 700);
        // ==============================================================

        await updateStage(dbJobId, stageKey, {
          status: "succeeded",
          progressPct: 100,
          message: SIMULATED_STAGE_RESULT.note,
          warnings: [SIMULATED_WARNING],
        });
      }
    } catch (err) {
      // A PipelineError names the stage that actually failed (the creative
      // pipeline drives six stages internally); other errors belong to the
      // loop's current stage.
      const failedStage = err instanceof PipelineError ? err.stage : stageKey;
      const detail = err instanceof Error ? err.message : String(err);
      await updateStage(dbJobId, failedStage, {
        status: "failed",
        message: `Stage failed: ${detail}`,
      });
      // Compliance NEEDS_REVIEW → park the job for human review instead of
      // hard-failing it.
      if (
        err instanceof PipelineError &&
        err.code === "compliance_blocked" &&
        err.verdict === "NEEDS_REVIEW"
      ) {
        const jobNow = await db.job.findUnique({ where: { id: dbJobId } });
        if (jobNow && canTransition(jobNow.status as JobStatus, "WAITING_FOR_REVIEW")) {
          await transitionJob(
            dbJobId,
            "WAITING_FOR_REVIEW",
            `Compliance needs human review: ${detail}`
          );
        }
        return; // do not rethrow — the job waits for a human decision
      }
      const jobNow = await db.job.findUnique({ where: { id: dbJobId } });
      if (canTransition(jobNow!.status as JobStatus, "FAILED")) {
        await transitionJob(dbJobId, "FAILED", `Stage ${stageKey} failed.`, {
          errorCode: "stage_failed",
          errorMessage: `Stage ${stageKey} failed: ${detail}`,
        });
      }
      // Re-throw so BullMQ applies its retry/backoff policy.
      throw err;
    }
  }

  const done = await db.job.findUnique({ where: { id: dbJobId }, include: { stages: true } });
  if (done!.stages.every((s) => ["succeeded", "skipped"].includes(s.status))) {
    const doneStatus = done!.status as JobStatus;
    if (doneStatus !== "COMPLETED" && canTransition(doneStatus, "COMPLETED")) {
      await transitionJob(dbJobId, "COMPLETED", "All 15 stages finished (Phases 5–6: real pipeline).");
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[worker] FATAL: DATABASE_URL is not set. Set it in .env and restart.");
    process.exit(1);
  }
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("[worker] FATAL: cannot reach Postgres:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const worker = new Worker(
    QUEUE_NAMES.videoJobs,
    async (queueJob) => {
      if (queueJob.name === "build-variant") {
        const variantRecordId = (queueJob.data as { variantRecordId?: string }).variantRecordId;
        if (!variantRecordId) throw new Error("[worker] build-variant job missing variantRecordId.");
        console.log(`[worker] building variant caption for ${variantRecordId} (queue job ${queueJob.id})`);
        const { runVariantBuild } = await import("@/lib/publishing/variant");
        await runVariantBuild(variantRecordId);
        console.log(`[worker] finished variant build ${variantRecordId}`);
        return;
      }
      const dbJobId = (queueJob.data as { jobId?: string }).jobId;
      if (!dbJobId) throw new Error("[worker] Queue message missing jobId.");
      console.log(`[worker] driving job ${dbJobId} (queue job ${queueJob.id})`);
      try {
        await driveJob(dbJobId);
      } catch (err) {
        if (err instanceof JobApiError) {
          console.error(`[worker] job ${dbJobId}: ${err.code} — ${err.message}`);
        }
        throw err;
      }
      console.log(`[worker] finished driving job ${dbJobId}`);
    },
    { connection: redisConnection() as never, concurrency: 1 }
  );

  worker.on("failed", (queueJob, err) => {
    console.error(`[worker] queue job ${queueJob?.id} failed:`, err.message);
  });
  worker.on("error", (err) => console.error("[worker] error:", err.message));

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received; closing...`);
    await worker.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(`[worker] listening on queue "${QUEUE_NAMES.videoJobs}" (concurrency 1).`);
}

void main();
