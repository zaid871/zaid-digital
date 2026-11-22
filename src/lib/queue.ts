/**
 * BullMQ queue helpers. Queues are created lazily so that importing this
 * module never requires Redis to be up; callers must handle connection
 * errors (returned as structured failures, never thrown to users).
 */

export const QUEUE_NAMES = {
  videoJobs: "video-jobs",
  rendering: "rendering",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not configured");
  return { url, maxRetriesPerRequest: 3 };
}

/**
 * Enqueue a video-generation job. Phase 3 wires this to the n8n workflow.
 *
 * BullMQ deduplicates by its own job id, so callers that re-enqueue the same
 * DB job (e.g. after POST /:id/retry) must pass a distinct `dedupeKey`;
 * otherwise the re-enqueue is silently ignored and the worker never runs.
 */
export async function enqueueVideoJob(
  jobId: string,
  payload: Record<string, unknown>,
  opts?: { dedupeKey?: string }
) {
  const { Queue } = await import("bullmq");
  const queue = new Queue(QUEUE_NAMES.videoJobs, {
    connection: redisConnection() as never,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  const job = await queue.add(
    "generate-video",
    { jobId, ...payload },
    { jobId: opts?.dedupeKey ?? jobId }
  );
  await queue.close();
  return { queueJobId: job.id, jobId };
}

/** Enqueue a render task for a completed storyboard. */
export async function enqueueRenderJob(jobId: string, payload: Record<string, unknown>) {
  const { Queue } = await import("bullmq");
  const queue = new Queue(QUEUE_NAMES.rendering, {
    connection: redisConnection() as never,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
    },
  });
  const job = await queue.add("render", { jobId, ...payload }, { jobId: `render-${jobId}` });
  await queue.close();
  return { queueJobId: job.id, jobId };
}

/**
 * Enqueue a repost-variant caption build. The worker generates a fresh
 * caption pack for the variant record; the n8n repost workflow publishes
 * it once the record is "ready".
 */
export async function enqueueVariantJob(variantRecordId: string) {
  const { Queue } = await import("bullmq");
  const queue = new Queue(QUEUE_NAMES.videoJobs, {
    connection: redisConnection() as never,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  const job = await queue.add(
    "build-variant",
    { variantRecordId },
    { jobId: `variant-${variantRecordId}` }
  );
  await queue.close();
  return { queueJobId: job.id, variantRecordId };
}
