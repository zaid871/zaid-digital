import { timingSafeEqual } from "crypto";
import { success, failure, redactSecrets } from "@/lib/envelope";
import { stageCallbackSchema } from "@/lib/schemas";
import { applyStageCallback, JobApiError } from "@/lib/job-service";
import { db } from "@/lib/db";

/**
 * POST /api/v1/jobs/:id/stage-callback — n8n reports stage progress.
 *
 * Contract (also documented in README):
 *   Header:  x-n8n-secret: <N8N_WEBHOOK_SECRET>  (required when the secret
 *            is set; optional when N8N_WEBHOOK_SECRET is unset — dev-mode
 *            convenience only, always set the secret in production)
 *   Body:    { stageKey, status, progressPct?, message?, warnings?,
 *              errorCode?, errorMessage? }
 *   status ∈ pending | running | succeeded | failed | skipped | waiting_review
 *
 * When the secret is set it is compared in constant time and never logged
 * or echoed. When unset, callbacks are accepted but a warning JobEvent is
 * recorded so the gap is visible in the job history.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  const secret = process.env.N8N_WEBHOOK_SECRET;
  const provided = request.headers.get("x-n8n-secret") ?? "";

  let unauthenticated = false;
  if (secret) {
    // Shared-secret auth is mandatory when the secret is configured.
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return failure("unauthorized", "Invalid webhook secret.", 401);
    }
  } else if (provided) {
    // A secret was sent but none is configured — treat as unauthorized so a
    // misconfigured n8n doesn't silently assume its callbacks are trusted.
    return failure(
      "unauthorized",
      "A webhook secret was provided, but N8N_WEBHOOK_SECRET is not configured on the backend.",
      401
    );
  } else {
    // Dev-mode convenience: secret unset → accept without auth, but say so.
    unauthenticated = true;
    console.warn(
      `[POST /api/v1/jobs/${id}/stage-callback] accepted unauthenticated callback (N8N_WEBHOOK_SECRET is unset — set it in production).`
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }

  const parsed = stageCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid callback payload.", 422, parsed.error.flatten());
  }

  try {
    const job = await applyStageCallback(id, parsed.data);
    if (unauthenticated) {
      await db.jobEvent
        .create({
          data: {
            jobId: id,
            type: "n8n_callback_unauthenticated",
            message:
              "Stage callback accepted WITHOUT the shared secret (N8N_WEBHOOK_SECRET is unset). Set it in production.",
          },
        })
        .catch((e) => console.error("[stage-callback] warning-event write failed:", redactSecrets(e)));
    }
    return success({ id: job.id, status: job.status, stages: job.stages });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    console.error(`[POST /api/v1/jobs/${id}/stage-callback] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to apply stage callback.", 500);
  }
}
