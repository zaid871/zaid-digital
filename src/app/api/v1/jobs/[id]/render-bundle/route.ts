/**
 * GET /api/v1/jobs/:id/render-bundle — a self-contained render job for a
 * remote runner (GitHub Actions render-batch workflow).
 *
 * Returns scene asset URLs (signed, 2 h), caption file contents, and the
 * same render options the local path uses — so the runner needs no DB
 * access and no backend credentials. Header `x-n8n-secret` (same as the
 * tools routes); the URLs are signed and expire, so the bundle itself is
 * safe to hand to a runner.
 */
import { z } from "zod";
import { checkN8nSecret } from "@/lib/api-auth";
import { failure, success, redactSecrets } from "@/lib/envelope";
import {
  buildRenderBundle,
  RenderError,
  type RenderBundle,
} from "@/lib/pipeline/render";

export const RenderBundleSchema = z.object({
  jobId: z.string().min(1),
  scenes: z
    .array(
      z.object({
        sceneId: z.string().min(1),
        videoUrl: z.string().url(),
        audioUrl: z.string().url(),
        durationSec: z.number().positive(),
      })
    )
    .min(1),
  captions: z.object({
    srt: z.string().min(1),
    vtt: z.string(),
  }),
  opts: z.object({
    jobId: z.string().min(1),
    productName: z.string().min(1),
    callToAction: z.string().min(1),
    dmCtaLine: z.string().nullable().optional(),
    targetDurationSec: z.number().positive(),
    visualStyle: z.string().nullable().optional(),
    captionMode: z.enum(["standard", "kinetic"]).optional(),
    hookCardText: z.string().nullable().optional(),
    checklistFeatures: z.array(z.string()).nullable().optional(),
    stickerHighlight: z.boolean().optional(),
    serifTitle: z
      .object({ title: z.string(), tagline: z.string().nullable() })
      .nullable()
      .optional(),
  }),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  const { id } = await params;
  if (!id) return failure("missing_id", "Job id is required.", 400);
  let bundle: RenderBundle;
  try {
    bundle = await buildRenderBundle(id);
  } catch (err) {
    if (err instanceof RenderError) {
      const status = err.message.includes("not found") ? 404 : 422;
      return failure("render_bundle_error", err.message, status);
    }
    console.error(`[GET /api/v1/jobs/${id}/render-bundle] unexpected error:`, redactSecrets(err));
    return failure("internal_error", "Failed to build render bundle.", 500);
  }
  const parsed = RenderBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    console.error(`[GET /api/v1/jobs/${id}/render-bundle] bundle failed schema check.`);
    return failure("internal_error", "Render bundle failed validation.", 500);
  }
  return success(parsed.data);
}
