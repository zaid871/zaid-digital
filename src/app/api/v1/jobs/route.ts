import { success, failure, redactSecrets } from "@/lib/envelope";
import { createJobSchema } from "@/lib/schemas";
import { createJob, listJobs, JobApiError, getJobEvents } from "@/lib/job-service";
import { enqueueVideoJob } from "@/lib/queue";
import { db } from "@/lib/db";

/**
 * POST /api/v1/jobs — create a generation job.
 *
 * Validates input (incl. SSRF guard), persists a Job row + 15 JobStage rows
 * + a JobEvent, then enqueues the job on BullMQ for the background worker.
 * Enqueue is best-effort: if Redis is down the job stays QUEUED in the DB
 * and the failure is recorded as a JobEvent (never silently dropped).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid job payload.", 422, parsed.error.flatten());
  }

  try {
    const { job, deduped } = await createJob(parsed.data);

    let enqueueWarning: string | null = null;
    if (!deduped) {
      try {
        await enqueueVideoJob(job.id, {
          productUrl: job.productUrl,
          normalizedUrl: job.normalizedUrl,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await db.jobEvent.create({
          data: {
            jobId: job.id,
            type: "enqueue_failed",
            message: `BullMQ enqueue failed: ${detail}. Job remains QUEUED; start the worker or retry to process it.`,
          },
        });
        enqueueWarning =
          "Job persisted, but the background queue is unreachable (is Redis running?). " +
          "The job stays QUEUED until a worker picks it up.";
      }
    }

    const events = await getJobEvents(job.id, 5);
    return success({ ...job, events, enqueueWarning, deduped }, deduped ? 200 : 201);
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error("[POST /api/v1/jobs] unexpected error:", redactSecrets(err));
    return failure("internal_error", "Failed to create job.", 500);
  }
}

/**
 * GET /api/v1/jobs — list generation jobs (paginated) from Postgres.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));

  try {
    return success(await listJobs(page, pageSize));
  } catch (err) {
    console.error("[GET /api/v1/jobs] unexpected error:", redactSecrets(err));
    return failure("internal_error", "Failed to list jobs.", 500);
  }
}
