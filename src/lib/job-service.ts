/**
 * Job service — the single place where Job / JobStage / JobEvent /
 * RetryRecord rows are created and mutated.
 *
 * This module has NO dependency on next/server so the BullMQ worker
 * (src/worker.ts) and API routes can share it. API routes translate
 * JobApiError into the versioned JSON envelope.
 */
import { db } from "./db";
import {
  JOB_STAGES,
  canTransition,
  type JobStatus,
  type JobStageKey,
} from "./job-stages";
import type { createJobSchema } from "./schemas";
import type { z } from "zod";

export type CreateJobInput = z.input<typeof createJobSchema>;

export class JobApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Which job-level status a stage runs under. The worker advances the job
 * status through these as stages complete; every edge exists in
 * JOB_TRANSITIONS (job-stages.ts).
 */
export const STAGE_JOB_STATUS: Record<JobStageKey, JobStatus> = {
  url_validation: "RESEARCHING",
  product_extraction: "RESEARCHING",
  product_research: "RESEARCHING",
  fact_verification: "RESEARCHING",
  media_analysis: "RESEARCHING",
  compliance_review: "RESEARCHING",
  creative_planning: "PLANNING",
  script_generation: "PLANNING",
  voiceover_generation: "GENERATING_ASSETS",
  storyboard_generation: "GENERATING_ASSETS",
  ai_visual_generation: "GENERATING_ASSETS",
  ai_video_generation: "GENERATING_ASSETS",
  editing_rendering: "RENDERING",
  quality_assurance: "QA",
  final_delivery: "QA", // QA -> COMPLETED happens after the last stage succeeds
};

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|mc_|igshid$|ref$|ref_|affiliate_id$)/i;

/** Strip marketing/tracking query params; keep the canonical product URL. */
export function normalizeProductUrl(raw: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

type DbJob = {
  id: string;
  productUrl: string;
  normalizedUrl: string | null;
  status: string;
  durationSeconds: number;
  language: string;
  voice: string | null;
  visualStyle: string | null;
  scriptStyle: string | null;
  platform: string | null;
  gifRequested: boolean;
  storyboardChain: boolean;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DbStage = {
  id: string;
  jobId: string;
  stageKey: string;
  order: number;
  status: string;
  progressPct: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  message: string | null;
  warnings: string[];
  retryCount: number;
};

export interface SerializedStage extends DbStage {
  /** Human-readable label from the canonical JOB_STAGES list. */
  label: string;
}

export interface SerializedJob {
  id: string;
  productUrl: string;
  normalizedUrl: string | null;
  status: string;
  durationSeconds: number;
  language: string;
  voice: string | null;
  visualStyle: string | null;
  scriptStyle: string | null;
  platform: string | null;
  gifRequested: boolean;
  storyboardChain: boolean;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  stages: SerializedStage[];
  createdAt: string;
  updatedAt: string;
}

const STAGE_LABELS: Map<string, string> = new Map(JOB_STAGES.map((s) => [s.key, s.label]));

function serialize(job: DbJob, stages: DbStage[]): SerializedJob {
  return {
    id: job.id,
    productUrl: job.productUrl,
    normalizedUrl: job.normalizedUrl,
    status: job.status,
    durationSeconds: job.durationSeconds,
    language: job.language,
    voice: job.voice,
    visualStyle: job.visualStyle,
    scriptStyle: job.scriptStyle,
    platform: job.platform,
    gifRequested: job.gifRequested ?? false,
    storyboardChain: job.storyboardChain ?? false,
    idempotencyKey: job.idempotencyKey,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    stages: [...stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s, label: STAGE_LABELS.get(s.stageKey) ?? s.stageKey })),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

async function recordEvent(
  tx: { jobEvent: { create: (a: never) => Promise<unknown> } },
  jobId: string,
  type: string,
  message: string,
  payload?: Record<string, unknown>
) {
  await tx.jobEvent.create({
    data: { jobId, type, message, payload: payload ?? undefined },
  } as never);
}

/**
 * Create a Job row + 15 JobStage rows + a JobEvent, atomically.
 * Idempotent when `idempotencyKey` is supplied and already exists.
 */
export async function createJob(input: CreateJobInput): Promise<{
  job: SerializedJob;
  deduped: boolean;
}> {
  const normalizedUrl = normalizeProductUrl(input.productUrl);

  if (input.idempotencyKey) {
    const existing = await db.job.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { stages: true },
    });
    if (existing) {
      return {
        job: serialize(existing as unknown as DbJob, existing.stages as unknown as DbStage[]),
        deduped: true,
      };
    }
  }

  const created = await db.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        productUrl: input.productUrl,
        normalizedUrl,
        status: "QUEUED",
        durationSeconds: input.durationSeconds ?? 45,
        language: input.language ?? "hinglish",
        voice: input.voice ?? null,
        visualStyle: input.visualStyle ?? null,
        scriptStyle: input.scriptStyle ?? null,
        platform: input.platform ?? null,
        gifRequested: input.gif ?? false,
        storyboardChain: input.storyboardChain ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    await tx.jobStage.createMany({
      data: JOB_STAGES.map((s) => ({
        jobId: job.id,
        stageKey: s.key,
        order: s.order,
        status: "pending",
        progressPct: 0,
      })),
    });
    await recordEvent(tx, job.id, "job_created", "Job created and queued.", {
      normalizedUrl,
    });
    const stages = await tx.jobStage.findMany({ where: { jobId: job.id } });
    return { job, stages };
  });

  return {
    job: serialize(created.job as unknown as DbJob, created.stages as unknown as DbStage[]),
    deduped: false,
  };
}

export async function getJob(id: string): Promise<SerializedJob> {
  const job = await db.job.findUnique({
    where: { id },
    include: { stages: true },
  });
  if (!job) throw new JobApiError("job_not_found", `No job found with id ${id}.`, 404);
  return serialize(job as unknown as DbJob, job.stages as unknown as DbStage[]);
}

export async function listJobs(page: number, pageSize: number) {
  const [total, jobs] = await Promise.all([
    db.job.count(),
    db.job.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { stages: { select: { status: true } } },
    }),
  ]);
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      productUrl: j.productUrl,
      status: j.status,
      durationSeconds: j.durationSeconds,
      language: j.language,
      platform: j.platform,
      stageSummary: (j.stages as { status: string }[]).reduce<Record<string, number>>(
        (acc, s) => {
          acc[s.status] = (acc[s.status] ?? 0) + 1;
          return acc;
        },
        {}
      ),
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    })),
    page,
    pageSize,
    total,
  };
}

/** Transition job status; throws JobApiError(409) on illegal transitions. */
export async function transitionJob(
  jobId: string,
  to: JobStatus,
  reason?: string,
  errorFields?: { errorCode?: string; errorMessage?: string }
) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobApiError("job_not_found", `No job found with id ${jobId}.`, 404);
  const from = job.status as JobStatus;
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new JobApiError(
      "illegal_transition",
      `Cannot transition job ${jobId} from ${from} to ${to}.`,
      409,
      { from, to }
    );
  }
  await db.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: {
        status: to,
        errorCode: errorFields?.errorCode ?? undefined,
        errorMessage: errorFields?.errorMessage ?? undefined,
      },
    });
    await recordEvent(tx, jobId, "job_status_changed", `Status ${from} → ${to}.${reason ? ` ${reason}` : ""}`, {
      from,
      to,
      reason: reason ?? null,
    });
  });
}

export type StagePatch = {
  status?: string;
  progressPct?: number;
  message?: string | null;
  warnings?: string[];
};

/** Update a stage row; sets startedAt/finishedAt from status transitions. */
export async function updateStage(jobId: string, stageKey: string, patch: StagePatch) {
  const stage = await db.jobStage.findUnique({
    where: { jobId_stageKey: { jobId, stageKey } },
  });
  if (!stage)
    throw new JobApiError("stage_not_found", `Stage ${stageKey} not found for job ${jobId}.`, 404);

  const now = new Date();
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    data.status = patch.status;
    if (patch.status === "running" && !stage.startedAt) data.startedAt = now;
    if (["succeeded", "failed", "skipped"].includes(patch.status) && !stage.finishedAt)
      data.finishedAt = now;
    if (patch.status === "pending") {
      data.startedAt = null;
      data.finishedAt = null;
    }
  }
  if (patch.progressPct !== undefined) data.progressPct = patch.progressPct;
  if (patch.message !== undefined) data.message = patch.message;
  if (patch.warnings !== undefined) data.warnings = patch.warnings;

  await db.$transaction(async (tx) => {
    await tx.jobStage.update({ where: { id: stage.id }, data: data as never });
    await recordEvent(
      tx,
      jobId,
      patch.status ? `stage_${patch.status}` : "stage_progress",
      `Stage ${stageKey}: ${patch.status ?? "progress"}${patch.message ? ` — ${patch.message}` : ""}`,
      { stageKey, ...patch }
    );
  });
}

/** Request cancellation. QUEUED jobs cancel immediately; running jobs go to CANCEL_REQUESTED. */
export async function requestCancel(jobId: string): Promise<SerializedJob> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { stages: true } });
  if (!job) throw new JobApiError("job_not_found", `No job found with id ${jobId}.`, 404);
  const status = job.status as JobStatus;
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(status)) {
    throw new JobApiError(
      "not_cancellable",
      `Job ${jobId} is already ${status} and cannot be cancelled.`,
      409
    );
  }
  if (status === "QUEUED") {
    await transitionJob(jobId, "CANCELLED", "Cancelled while queued.");
  } else {
    await transitionJob(jobId, "CANCEL_REQUESTED", "Cancellation requested by user.");
  }
  await db.jobEvent.create({
    data: { jobId, type: "cancel_requested", message: "User requested cancellation." },
  });
  return getJob(jobId);
}

const TERMINAL_FAILURE_STATES: JobStatus[] = ["FAILED", "WAITING_FOR_REVIEW"];

/**
 * Retry a failed job: reset failed/stale-running stages to pending,
 * record a RetryRecord per stage, move FAILED → RETRYING. The caller
 * re-enqueues the job so the worker resumes from the first pending stage.
 */
export async function retryJob(jobId: string, reason?: string): Promise<SerializedJob> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { stages: true } });
  if (!job) throw new JobApiError("job_not_found", `No job found with id ${jobId}.`, 404);
  const status = job.status as JobStatus;
  if (!TERMINAL_FAILURE_STATES.includes(status)) {
    throw new JobApiError(
      "not_retryable",
      `Job ${jobId} is ${status}; only FAILED or WAITING_FOR_REVIEW jobs can be retried.`,
      409
    );
  }

  const failedStages = (job.stages as unknown as DbStage[]).filter((s) =>
    ["failed", "running"].includes(s.status)
  );
  if (failedStages.length === 0) {
    throw new JobApiError("nothing_to_retry", `Job ${jobId} has no failed stages to retry.`, 409);
  }

  await db.$transaction(async (tx) => {
    for (const stage of failedStages) {
      await tx.jobStage.update({
        where: { id: stage.id },
        data: {
          status: "pending",
          progressPct: 0,
          startedAt: null,
          finishedAt: null,
          message: null,
          warnings: [],
          retryCount: { increment: 1 },
        },
      });
      await tx.retryRecord.create({
        data: {
          jobId,
          stageKey: stage.stageKey,
          attempt: stage.retryCount + 1,
          reason: reason ?? "User-requested retry",
          retryable: true,
        },
      });
    }
    await recordEvent(tx, jobId, "retry_requested", `Retry requested; ${failedStages.length} stage(s) reset to pending.`, {
      stages: failedStages.map((s) => s.stageKey),
      reason: reason ?? null,
    });
  });

  await transitionJob(jobId, "RETRYING", "User requested retry; worker will resume from the first pending stage.");
  return getJob(jobId);
}

/** Payload accepted from the n8n stage-callback webhook. */
export interface StageCallbackPayload {
  stageKey: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting_review";
  progressPct?: number;
  message?: string;
  warnings?: string[];
  errorCode?: string;
  errorMessage?: string;
}

/** Apply an n8n stage callback: update the stage, derive job status, record events. */
export async function applyStageCallback(
  jobId: string,
  payload: StageCallbackPayload
): Promise<SerializedJob> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { stages: true } });
  if (!job) throw new JobApiError("job_not_found", `No job found with id ${jobId}.`, 404);

  const validKeys = new Set(JOB_STAGES.map((s) => s.key));
  if (!validKeys.has(payload.stageKey as JobStageKey)) {
    throw new JobApiError("unknown_stage", `Unknown stage key: ${payload.stageKey}.`, 422);
  }

  const patch: StagePatch = {
    status: payload.status,
    message: payload.message ?? null,
    warnings: payload.warnings ?? [],
  };
  if (payload.progressPct !== undefined) {
    patch.progressPct = Math.max(0, Math.min(100, payload.progressPct));
  } else if (payload.status === "succeeded") {
    patch.progressPct = 100;
  } else if (payload.status === "running") {
    patch.progressPct = 10;
  }
  await updateStage(jobId, payload.stageKey, patch);
  await db.jobEvent.create({
    data: { jobId, type: "n8n_callback", message: `n8n reported ${payload.stageKey} → ${payload.status}.`, payload: { ...payload } },
  });

  const refreshed = await db.job.findUnique({ where: { id: jobId }, include: { stages: true } });
  const stages = refreshed!.stages as unknown as DbStage[];
  const currentStatus = refreshed!.status as JobStatus;

  if (payload.status === "failed") {
    if (canTransition(currentStatus, "FAILED")) {
      await transitionJob(jobId, "FAILED", `Stage ${payload.stageKey} failed via n8n.`, {
        errorCode: payload.errorCode ?? "stage_failed",
        errorMessage: payload.errorMessage ?? payload.message ?? `Stage ${payload.stageKey} failed.`,
      });
    }
    return getJob(jobId);
  }

  if (stages.every((s) => s.status === "succeeded")) {
    if (canTransition(currentStatus, "COMPLETED")) {
      await transitionJob(jobId, "COMPLETED", "All 15 stages succeeded (reported by n8n).");
    }
    return getJob(jobId);
  }

  if (payload.status === "running") {
    const target = STAGE_JOB_STATUS[payload.stageKey as JobStageKey];
    if (currentStatus !== target && canTransition(currentStatus, target)) {
      await transitionJob(jobId, target, `Stage ${payload.stageKey} running (reported by n8n).`);
    }
  }
  return getJob(jobId);
}

/** Recent events for a job (newest last), capped for the API. */
export async function getJobEvents(jobId: string, limit = 100) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobApiError("job_not_found", `No job found with id ${jobId}.`, 404);
  const events = await db.jobEvent.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return events.map((e) => ({
    id: e.id,
    type: e.type,
    message: e.message,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  }));
}
