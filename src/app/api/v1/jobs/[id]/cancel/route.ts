import { success, failure, redactSecrets } from "@/lib/envelope";
import { requestCancel, JobApiError } from "@/lib/job-service";

/**
 * POST /api/v1/jobs/:id/cancel — request cancellation of a running job.
 *
 * QUEUED jobs flip straight to CANCELLED; jobs already picked up by the
 * worker (or n8n) move to CANCEL_REQUESTED and the worker finalizes the
 * transition to CANCELLED before starting the next stage.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  try {
    const job = await requestCancel(id);
    return success({
      id: job.id,
      status: job.status,
      message:
        job.status === "CANCELLED"
          ? "Job cancelled."
          : "Cancellation requested. The worker will stop before the next stage.",
    });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error(`[POST /api/v1/jobs/${id}/cancel] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to cancel job.", 500);
  }
}
