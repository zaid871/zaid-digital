import { success, failure, redactSecrets } from "@/lib/envelope";
import { retryJob, JobApiError } from "@/lib/job-service";
import { enqueueVideoJob } from "@/lib/queue";
import { db } from "@/lib/db";

/**
 * POST /api/v1/jobs/:id/retry — retry eligible failures.
 *
 * Only FAILED / WAITING_FOR_REVIEW jobs with at least one failed stage can
 * be retried. Failed stages are reset to pending, a RetryRecord row is
 * written per stage, the job moves to RETRYING, and it is re-enqueued so the
 * worker resumes from the first pending stage (bounded by BullMQ attempts).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  let reason: string | undefined;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body.reason === "string") reason = body.reason.slice(0, 500);
  } catch {
    /* optional body */
  }

  try {
    const job = await retryJob(id, reason);

    let enqueueWarning: string | null = null;
    try {
      await enqueueVideoJob(job.id, { productUrl: job.productUrl, retried: true }, {
        dedupeKey: `${job.id}-retry-${Date.now()}`,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await db.jobEvent.create({
        data: {
          jobId: job.id,
          type: "enqueue_failed",
          message: `BullMQ re-enqueue after retry failed: ${detail}. Job is RETRYING; start the worker to resume it.`,
        },
      });
      enqueueWarning =
        "Retry recorded, but the background queue is unreachable (is Redis running?).";
    }

    return success({
      id: job.id,
      status: job.status,
      message: "Retry accepted. The worker resumes from the first pending stage.",
      enqueueWarning,
    });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error(`[POST /api/v1/jobs/${id}/retry] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to retry job.", 500);
  }
}
