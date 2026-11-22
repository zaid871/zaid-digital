import { success, failure, redactSecrets } from "@/lib/envelope";
import { getJob, getJobEvents, JobApiError } from "@/lib/job-service";

/** GET /api/v1/jobs/:id — retrieve job status with persisted stage states. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  try {
    const job = await getJob(id);
    const events = await getJobEvents(id, 50);
    return success({ ...job, events });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error(`[GET /api/v1/jobs/${id}] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to retrieve job.", 500);
  }
}
