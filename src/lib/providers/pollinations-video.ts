/**
 * Pollinations.ai video adapter — EXPERIMENTAL free text-to-video.
 *
 * Endpoint: GET https://gen.pollinations.ai/video/{prompt}
 * No API key. Community-run and best-effort: queues, slow renders, and
 * rate limits are normal. Output is a short MP4 clip (not a full scene).
 *
 * Marked experimental: the caller must verify the clip (ffprobe) and never
 * trust it blindly. Any failure falls through to the next video provider
 * (ffmpeg-motion), which is the reliable default.
 *
 * Commercial-use status: NOT verified by us — check Pollinations' current
 * terms at deploy time before using for affiliate content.
 */
import { z } from "zod";
import {
  backoffDelayMs,
  errResult,
  okResult,
  sleep,
  type ProviderResult,
} from "./types";

export const PROVIDER_KEY = "pollinations-video";

const GenerateVideoInputSchema = z.object({
  prompt: z.string().min(1).max(1500),
  /** Pollinations video model id. Overridable via POLLINATIONS_VIDEO_MODEL. */
  model: z.string().min(1).optional(),
  width: z.number().int().min(64).max(1280).default(720),
  height: z.number().int().min(64).max(1280).default(1280),
});

const MAX_RETRIES = 2;
const TIMEOUT_MS = 300_000; // video renders take minutes

export function isConfigured(): boolean {
  // No credentials required — always "available" as a best-effort provider.
  return true;
}

export async function generateVideo(
  input: z.input<typeof GenerateVideoInputSchema>
): Promise<ProviderResult<Buffer>> {
  const parsed = GenerateVideoInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(
      PROVIDER_KEY,
      { code: "invalid_input", message: "Invalid video-generation input.", retryable: false },
      { experimental: true }
    );
  }
  const { prompt, width, height } = parsed.data;
  const model = parsed.data.model || process.env.POLLINATIONS_VIDEO_MODEL || "ltx-2";
  const url =
    `https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&nologo=true&model=${encodeURIComponent(model)}`;

  const started = Date.now();
  let lastDetail = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const ct = res.headers.get("content-type") || "";
      if (res.status === 429) {
        lastDetail = "http=429 rate limited";
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 5000, 60000));
        continue;
      }
      if (!res.ok || !ct.startsWith("video/")) {
        lastDetail = `http=${res.status} content-type=${ct.slice(0, 60)}`;
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 5000, 60000));
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) {
        lastDetail = "empty body";
        continue;
      }
      return okResult(PROVIDER_KEY, buf, {
        model,
        durationMs: Date.now() - started,
        experimental: true,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg.includes("abort") ? "timeout" : msg.slice(0, 120);
      if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 5000, 60000));
    }
  }
  return errResult(
    PROVIDER_KEY,
    {
      code: "unavailable",
      message: `Pollinations video did not return a clip after ${MAX_RETRIES + 1} attempts. Last: ${lastDetail}`,
      retryable: true,
    },
    { experimental: true }
  );
}
