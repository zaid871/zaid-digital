import { z } from "zod";
import { JOB_STATUSES } from "./job-stages";

/** Shared zod schemas for v1 API input validation (server-side). */

/** Product URL: http(s) only, no localhost/private metadata endpoints. */
export const productUrlSchema = z
  .string()
  .trim()
  .min(1, "Product URL is required")
  .max(2048, "URL too long")
  .url("Must be a valid URL")
  .refine((u) => {
    try {
      const parsed = new URL(u);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase();
      // SSRF guard: block loopback / internal hosts / cloud metadata.
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "169.254.169.254" ||
        host === "metadata.google.internal" ||
        host.endsWith(".internal") ||
        host.endsWith(".local") ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      )
        return false;
      return true;
    } catch {
      return false;
    }
  }, "URL points to a blocked host (private/internal addresses are not allowed)");

export const createJobSchema = z.object({
  productUrl: productUrlSchema,
  durationSeconds: z.number().int().min(15).max(180).default(45),
  language: z.enum(["hinglish", "hindi", "english"]).default("hinglish"),
  voice: z.string().max(120).optional(),
  visualStyle: z.string().max(120).optional(),
  scriptStyle: z.enum(["standard", "numbered", "brand_story", "macro_hero", "banner_unroll", "attar_luxury"]).optional(),
  platform: z.enum(["instagram_reels", "facebook_reels", "youtube_shorts"]).optional(),
  /**
   * Opt-in GIF preview. Default OFF — a GIF is made only when this is
   * true (or the hub prompt explicitly says "gif banao"). The GIF is a
   * short silent loop (first 3s, 480px, 8fps) made from the final MP4
   * in the delivery stage; a GIF failure never fails the video.
   */
  gif: z.boolean().optional(),
  /**
   * Opt-in storyboard chain (Raj, 2026-11-10). Default OFF — when true,
   * the pipeline first generates 5 ad concepts, picks the best, and
   * builds the script + 9-scene storyboard on the winner.
   */
  storyboardChain: z.boolean().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export const jobStatusSchema = z.enum(JOB_STATUSES as unknown as [string, ...string[]]);

export const testProviderSchema = z.object({
  provider: z.string().min(1).max(80),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** n8n → backend stage callback payload (POST /api/v1/jobs/:id/stage-callback). */
export const stageCallbackSchema = z.object({
  stageKey: z.string().min(1).max(80),
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped", "waiting_review"]),
  progressPct: z.number().int().min(0).max(100).optional(),
  message: z.string().max(2000).optional(),
  warnings: z.array(z.string().max(500)).max(20).optional(),
  errorCode: z.string().max(120).optional(),
  errorMessage: z.string().max(2000).optional(),
});
