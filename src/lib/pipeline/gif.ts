/**
 * Opt-in GIF export for the video pipeline.
 *
 * Default: OFF. A GIF is made only when the request explicitly asks for
 * one — either the job was created with `gif: true`, or the prompt
 * explicitly says so (see wantsGif). Every video does NOT get a GIF.
 *
 * Why a GIF is a small preview, not a second video:
 * - GIF holds 256 colors only — the Premium Dark cinematic look
 *   (gradients, rim light) banding dikhega; MP4 jaisa smooth nahi.
 * - GIF is silent — no voiceover.
 * - A full-length 1080x1920 GIF would be tens of MB, so the default is
 *   a short loop: first 3 seconds, 480px wide, 8 fps. Measured on the
 *   grainy Premium Dark demo: ~6.6 MB (film grain is the worst case
 *   for GIF); clean product footage runs ~1–3 MB. Env vars tune it
 *   (GIF_WIDTH / GIF_FPS / GIF_SECONDS) if a longer loop is wanted.
 * - Reels/Shorts never take a GIF; this is for website embeds,
 *   WhatsApp/Telegram, and email.
 *
 * Conversion is FFmpeg two-pass (palettegen → paletteuse), the same
 * ffmpeg the render stage already uses. No new dependency, no new
 * provider, no new server.
 */
import { execFile } from "child_process";
import { existsSync, statSync, unlinkSync } from "fs";
import { promisify } from "util";
import { probeFull } from "./render";

const execFileAsync = promisify(execFile);

export class GifError extends Error {
  transient: boolean;
  constructor(message: string, transient = false) {
    super(message);
    this.name = "GifError";
    this.transient = transient;
  }
}

export const GIF_DEFAULTS = {
  /** Preview width in px (height follows the 9:16 aspect → 853). */
  width: 480,
  /** Frames per second — 8 keeps the file small and smooth enough. */
  fps: 8,
  /** Seconds taken from the start of the video (the hook). */
  seconds: 3,
} as const;

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function gifDefaults(): { width: number; fps: number; seconds: number } {
  return {
    width: envInt("GIF_WIDTH", GIF_DEFAULTS.width),
    fps: envInt("GIF_FPS", GIF_DEFAULTS.fps),
    seconds: envInt("GIF_SECONDS", GIF_DEFAULTS.seconds),
  };
}

/**
 * Explicit opt-in detection. Returns true ONLY when the prompt plainly
 * asks for a GIF ("gif banao", "make a gif", "gif version chahiye",
 * "gif me convert karo"). A bare mention ("gif jaisa effect") or an
 * explicit refusal ("bina gif ke", "gif nahi chahiye") returns false.
 */
export function wantsGif(prompt: string | null | undefined): boolean {
  if (!prompt || !prompt.trim()) return false;
  const text = prompt.trim();
  // Explicit refusals win over anything else in the same prompt.
  const NEGATION =
    /\b(bina\s+gif|without\s+(a\s+)?gif|no\s+gif|gif\s+(nahi|nahin|mat|na\s+banao)|gif\s+nahi\s+chahiye)\b/i;
  if (NEGATION.test(text)) return false;
  const ACTION =
    /\bgif\b[^.!?]{0,40}\b(banao|banana|bana\s*do|bana\s*den|chahiye|version|convert|karo|kar\s*do)\b/i;
  if (ACTION.test(text)) return true;
  const ENGLISH = /\b(make|create|generate)\s+(a\s+|an\s+|the\s+)?gif\b/i;
  if (ENGLISH.test(text)) return true;
  return false;
}

export interface RenderGifInput {
  input: string;
  output: string;
  width?: number;
  fps?: number;
  seconds?: number;
  startSec?: number;
}

export interface RenderGifResult {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  bytes: number;
}

function runFfmpeg(args: string[], label: string, timeoutMs = 120_000): Promise<void> {
  return execFileAsync("ffmpeg", args, { timeout: timeoutMs })
    .then(() => undefined)
    .catch((err: unknown) => {
      const e = err as { message?: string; killed?: boolean };
      const timedOut = e.killed === true || String(e.message ?? "").includes("ETIMEDOUT");
      throw new GifError(`GIF ${label} failed: ${String(e.message ?? err).slice(0, 300)}`, timedOut);
    });
}

/**
 * Convert the first `seconds` of an MP4 into a looping GIF (two-pass
 * palette for the best 256-color result). Throws GifError on failure;
 * the caller decides whether a GIF failure fails the job (it must not —
 * delivery treats it as a warning, the MP4 is the deliverable).
 */
export async function renderGif(input: RenderGifInput): Promise<RenderGifResult> {
  if (!existsSync(input.input)) {
    throw new GifError(`GIF input not found: ${input.input}`, false);
  }
  const defaults = gifDefaults();
  const width = input.width ?? defaults.width;
  const fps = input.fps ?? defaults.fps;
  const seconds = input.seconds ?? defaults.seconds;
  const startSec = input.startSec ?? 0;
  const palettePath = `${input.output}.palette.png`;
  const ss = String(startSec);
  const dur = String(seconds);
  try {
    // Pass 1: build the 256-color palette from the clip itself.
    await runFfmpeg(
      [
        "-ss", ss, "-t", dur, "-i", input.input,
        "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
        "-y", palettePath,
      ],
      "palette"
    );
    // Pass 2: render the GIF against that palette.
    await runFfmpeg(
      [
        "-ss", ss, "-t", dur, "-i", input.input, "-i", palettePath,
        "-lavfi", `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
        "-y", input.output,
      ],
      "render"
    );
  } finally {
    // The palette is a temp file — never part of the deliverable.
    try {
      if (existsSync(palettePath)) unlinkSync(palettePath);
    } catch {
      // A leftover palette is harmless; ignore cleanup failures.
    }
  }
  if (!existsSync(input.output)) {
    throw new GifError(`GIF output missing after render: ${input.output}`, true);
  }
  const probe = await probeFull(input.output);
  if (probe.videoCodec !== "gif" && probe.width !== width) {
    throw new GifError(
      `GIF verification failed: expected gif ${width}px wide, got ${probe.videoCodec ?? "unknown"} ${probe.width ?? "?"}px.`,
      false
    );
  }
  return {
    outputPath: input.output,
    width: probe.width ?? width,
    height: probe.height ?? Math.round((width * 16) / 9),
    fps,
    durationSec: probe.durationSec ?? seconds,
    bytes: statSync(input.output).size,
  };
}
