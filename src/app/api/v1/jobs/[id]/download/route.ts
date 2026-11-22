import { NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { extname, resolve, sep } from "path";
import { failure, redactSecrets } from "@/lib/envelope";
import { getStorage, assertSafeKey } from "@/lib/storage";
import { assetsRoot } from "@/lib/pipeline/assets";
import { db } from "@/lib/db";
import { JobApiError } from "@/lib/job-service";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
};

/**
 * GET /api/v1/jobs/:id/download?key=<storageKey> — stream a job asset.
 *
 * Path-traversal protection: the key must resolve inside
 * `<ASSETS_DIR>/<jobId>/`. Anything else → 400. The job must exist.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);

  try {
    const job = await db.job.findUnique({ where: { id } });
    if (!job) throw new JobApiError("job_not_found", `No job found with id ${id}.`, 404);

    const key = new URL(request.url).searchParams.get("key");
    if (!key) return failure("missing_key", "Query param 'key' (storage key) is required.", 400);

    const safe = assertSafeKey(key);
    const storage = getStorage();
    if (storage.kind !== "local" || !storage.resolveLocalPath) {
      return failure("not_supported", "Downloads are only served for the local storage backend.", 501);
    }
    const abs = resolve(storage.resolveLocalPath(safe));
    const jobDir = resolve(assetsRoot(), id);
    if (abs !== jobDir && !abs.startsWith(jobDir + sep)) {
      return failure("forbidden", "Storage key does not belong to this job.", 403);
    }
    if (!(await storage.exists(safe))) {
      return failure("not_found", "Asset not found.", 404);
    }

    const stat = statSync(abs);
    const ext = extname(abs).toLowerCase();
    const stream = createReadStream(abs);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (e) => controller.error(e));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(abs.split(sep).pop() ?? "download")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    if (err instanceof JobApiError) return failure(err.code, err.message, err.status, err.details);
    if (err instanceof Error && /unsafe|escapes|forbidden/i.test(err.message)) {
      return failure("forbidden", "Invalid storage key.", 403);
    }
    console.error(`[GET /api/v1/jobs/${id}/download] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to serve download.", 500);
  }
}
