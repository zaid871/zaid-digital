/**
 * Tier B video adapter — pure-FFmpeg cinematic motion from a still image.
 *
 * This is the DEFAULT, always-available video path: no API keys, no network,
 * no GPU, fully deterministic. It turns a product still into a 9:16 MP4 with:
 *  - zoom_in  (slow dolly-in)
 *  - zoom_out (slow pull-back)
 *  - pan_left / pan_right (lateral camera drift)
 *  - optional light-sweep overlay (a soft translucent band drifting across,
 *    faked with a moving color source — no shader needed)
 *
 * Output: H.264 / yuv420p MP4, no audio track (audio is muxed later in the
 * render pipeline). Every output is verified with ffprobe (resolution +
 * duration) before being returned as success.
 */
import { execFile } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, parse } from "path";
import { promisify } from "util";
import { z } from "zod";
import { errResult, okResult, type ProviderResult } from "./types";

export const PROVIDER_KEY = "ffmpeg";

const MotionSchema = z.enum([
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "pan_down",
  "zoom_in_fast",
  "macro_zoom",
  "static",
]);
export type Motion = z.infer<typeof MotionSchema>;

const AnimateOptionsSchema = z.object({
  motion: MotionSchema.default("zoom_in"),
  durationSec: z.number().min(1).max(120).default(5),
  width: z.number().int().min(64).max(2160).default(1080),
  height: z.number().int().min(64).max(3840).default(1920),
  fps: z.number().int().min(15).max(60).default(30),
  /** Soft light band drifting across the frame. */
  lightSweep: z.boolean().default(true),
  /** x264 preset; "veryfast" keeps render times sane on modest VMs. */
  preset: z.string().default("veryfast"),
  outputPath: z.string().min(1).optional(),
});
export type AnimateOptions = z.input<typeof AnimateOptionsSchema>;

const FFMPEG_TIMEOUT_MS = 180_000;

const execFileAsync = promisify(execFile);

export function isConfigured(): boolean {
  // Local binary — availability is checked per-call via `ffmpeg -version`.
  return true;
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the -vf filtergraph for the requested motion.
 * All expressions use `on` (output frame number) and `t` (seconds) so they
 * are resolution-independent.
 */
function motionFilter(m: Motion, o: Required<Omit<AnimateOptions, "outputPath" | "preset">> & { preset: string }): string {
  const { width: W, height: H, durationSec: D, fps, lightSweep } = o;
  const frames = Math.round(D * fps);
  // Upscale 2x so zoompan/crop have headroom without softness.
  const base = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2}`;
  let motion: string;
  switch (m) {
    case "zoom_in":
      // ~12% push-in over the clip.
      motion =
        `zoompan=z='min(1.0+0.0012*on,1.35)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=${frames}:s=${W}x${H}:fps=${fps}`;
      break;
    case "zoom_out":
      motion =
        `zoompan=z='max(1.3-0.0012*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=${frames}:s=${W}x${H}:fps=${fps}`;
      break;
    case "pan_left":
      // crop's expression vars: n (frame), t (seconds). `on` is zoompan-only.
      motion =
        `crop=${W}:${H}:x='(in_w-${W})*(1-t/${D})':y='(in_h-${H})/2',fps=${fps}`;
      break;
    case "pan_right":
      motion =
        `crop=${W}:${H}:x='(in_w-${W})*t/${D}':y='(in_h-${H})/2',fps=${fps}`;
      break;
    case "pan_up":
      // Vertical drift upward (aerial swoop feel): crop window rises.
      motion =
        `crop=${W}:${H}:x='(in_w-${W})/2':y='(in_h-${H})*(1-t/${D})',fps=${fps}`;
      break;
    case "pan_down":
      // Vertical drift downward (top-down reveal settling onto the product).
      motion =
        `crop=${W}:${H}:x='(in_w-${W})/2':y='(in_h-${H})*t/${D}',fps=${fps}`;
      break;
    case "zoom_in_fast":
      // Aggressive push-in (~55% over the clip) — the high-energy "rush"
      // move for hooks. Still a 2D zoompan move: no fake physics claims.
      motion =
        `zoompan=z='min(1.0+0.0035*on,1.55)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=${frames}:s=${W}x${H}:fps=${fps}`;
      break;
    case "macro_zoom":
      // Extreme close-up drift: starts deep in the texture (1.5x) and
      // pushes slightly further — macro product-detail feel.
      motion =
        `zoompan=z='min(1.5+0.0008*on,1.7)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
        `:d=${frames}:s=${W}x${H}:fps=${fps}`;
      break;
    case "static":
    default:
      motion = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps}`;
      return lightSweep ? `${motion},format=yuv420p` : motion; // static has no 2x base
  }
  const video = `${base},${motion}`;
  if (!lightSweep) return `${video},format=yuv420p`;
  // Light sweep: translucent white band drifting left→right, composited on top.
  // Implemented as a filter on the second (lavfi) input; see animateImage().
  return `${video},format=yuv420p`;
}

export interface ComparisonOptions {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  preset?: string;
  leftLabel?: string;
  rightLabel?: string;
  /** Seconds the wipe takes to travel left -> right (default 1.5). */
  wipeSec?: number;
  outputPath?: string;
}

function escapeDrawtextValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

function comparisonFont(): string | null {
  const candidates = [
    process.env.COMPARISON_FONT,
    process.env.CAPTION_FONT,
    // Alpine (font-dejavu package): /usr/share/fonts/dejavu/
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    // Debian/Ubuntu layout
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(c)) ?? null;
}

export interface AnimateOutput {
  path: string;
  durationSec: number;
  width: number;
  height: number;
  motion: Motion;
}

/**
 * Split-screen comparison clip (AdGen item 3): the left image holds the
 * full frame while the right image wipes in left -> right over wipeSec,
 * with a white divider tracking the wipe edge and optional corner labels.
 * Requires TWO distinct images — a comparison is never faked from one.
 */
export async function animateComparison(
  leftPath: string,
  rightPath: string,
  options: ComparisonOptions
): Promise<ProviderResult<AnimateOutput>> {
  const W = options.width ?? 1080;
  const H = options.height ?? 1920;
  const fps = options.fps ?? 30;
  const D = options.durationSec;
  const wipe = Math.min(Math.max(options.wipeSec ?? 1.5, 0.5), D);
  if (!existsSync(leftPath) || !existsSync(rightPath)) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Comparison needs two existing images (left + right).",
      retryable: false,
    });
  }
  if (!(await checkFfmpeg())) {
    return errResult(PROVIDER_KEY, {
      code: "dependency_missing",
      message: "ffmpeg binary not found on PATH.",
      retryable: false,
    });
  }
  const outPath =
    options.outputPath || join(dirname(leftPath), `${parse(leftPath).name}.comparison.mp4`);
  mkdirSync(dirname(outPath), { recursive: true });

  const wipeExpr = `${W}-min(540,540*t/${wipe})`;
  let chain = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},format=yuv420p[left];`;
  chain += `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},format=yuv420p[right];`;
  // Right half of the right image (540px) slides in from the right edge;
  // the divider sweeps with it and stops at the centre for a 50/50 hold.
  // (crop w/h cannot animate per-frame in ffmpeg, so the sweep is an
  // overlay-x animation — the only per-frame-safe way to move a boundary.)
  chain += `[right]crop=w=540:h=${H}:x=540:y=0[righthalf];`;
  chain += `[left][righthalf]overlay=x='${wipeExpr}':y=0[wiped];`;
  chain += `[wiped]drawbox=x='min(${W - 6},${wipeExpr})':y=0:w=6:h=${H}:color=white@0.9:t=fill[divided]`;
  const font = comparisonFont();
  let last = "divided";
  if (font) {
    if (options.leftLabel) {
      chain += `;[${last}]drawtext=fontfile=${font}:fontsize=42:fontcolor=white:borderw=2:bordercolor=black@0.6:text='${escapeDrawtextValue(options.leftLabel)}':x=36:y=${H - 120}[labeled]`;
      last = "labeled";
    }
    if (options.rightLabel) {
      chain += `;[${last}]drawtext=fontfile=${font}:fontsize=42:fontcolor=white:borderw=2:bordercolor=black@0.6:text='${escapeDrawtextValue(options.rightLabel)}':x=w-tw-36:y=${H - 120}[out]`;
      last = "out";
    }
  }
  if (last !== "out") chain += `;[${last}]null[out]`;

  const frames = Math.round(D * fps);
  const args = [
    "-y",
    "-loop", "1", "-t", String(D), "-i", leftPath,
    "-loop", "1", "-t", String(D), "-i", rightPath,
    "-filter_complex", chain,
    "-map", "[out]",
    "-frames:v", String(frames),
    "-c:v", "libx264",
    "-preset", options.preset ?? "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-an",
    "-movflags", "+faststart",
    outPath,
  ];
  try {
    await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResult(PROVIDER_KEY, {
      code: msg.includes("timed out") ? "timeout" : "upstream_error",
      message: `Comparison render failed: ${msg.slice(0, 300)}`,
      retryable: true,
    });
  }
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration",
      "-of", "default=noprint_wrappers=1",
      outPath,
    ]);
    const w = Number(/width=(\d+)/.exec(stdout)?.[1]);
    const h = Number(/height=(\d+)/.exec(stdout)?.[1]);
    const d = Number(/duration=([\d.]+)/.exec(stdout)?.[1]);
    if (w !== W || h !== H) {
      return errResult(PROVIDER_KEY, {
        code: "upstream_error",
        message: `Comparison resolution mismatch: got ${w}x${h}, expected ${W}x${H}.`,
        retryable: true,
      });
    }
    return okResult(PROVIDER_KEY, { path: outPath, durationSec: d || D, width: w, height: h, motion: "static" });
  } catch (err) {
    return errResult(PROVIDER_KEY, {
      code: "upstream_error",
      message: `ffprobe verification failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      retryable: true,
    });
  }
}

export interface BannerUnrollOptions {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  preset?: string;
  /** Seconds the unroll takes to travel top -> bottom (default 2). */
  wipeSec?: number;
  outputPath?: string;
}

/**
 * CGI banner-unroll clip (Raj Photo Editing, 2026-11-10): the
 * closed-banner still holds while the open-banner still wipes in
 * top -> bottom over wipeSec (xfade "wipedown"), then the open banner
 * holds for the rest of the scene. Requires TWO distinct images —
 * an unroll is never faked from one image. No 3D software, no AI
 * video: the whole effect is one FFmpeg transition between two stills.
 */
export async function animateBannerUnroll(
  closedPath: string,
  openPath: string,
  options: BannerUnrollOptions
): Promise<ProviderResult<AnimateOutput>> {
  const W = options.width ?? 1080;
  const H = options.height ?? 1920;
  const fps = options.fps ?? 30;
  const D = options.durationSec;
  const wipe = Math.min(Math.max(options.wipeSec ?? 2, 0.5), D);
  if (!existsSync(closedPath) || !existsSync(openPath)) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Banner unroll needs two existing images (closed + open banner).",
      retryable: false,
    });
  }
  if (!(await checkFfmpeg())) {
    return errResult(PROVIDER_KEY, {
      code: "dependency_missing",
      message: "ffmpeg binary not found on PATH.",
      retryable: false,
    });
  }
  const outPath =
    options.outputPath || join(dirname(closedPath), `${parse(closedPath).name}.unroll.mp4`);
  mkdirSync(dirname(outPath), { recursive: true });

  // xfade output length = d0 + d1 - wipe = wipe + D - wipe = D: the
  // closed still plays exactly through the wipe, the open still holds
  // for the remaining D - wipe seconds.
  const chain =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},format=yuv420p[closed];` +
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},format=yuv420p[open];` +
    `[closed][open]xfade=transition=wipedown:duration=${wipe}:offset=0,format=yuv420p[out]`;

  const frames = Math.round(D * fps);
  const args = [
    "-y",
    "-loop", "1", "-t", String(wipe), "-i", closedPath,
    "-loop", "1", "-t", String(D), "-i", openPath,
    "-filter_complex", chain,
    "-map", "[out]",
    "-frames:v", String(frames),
    "-c:v", "libx264",
    "-preset", options.preset ?? "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-an",
    "-movflags", "+faststart",
    outPath,
  ];
  try {
    await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResult(PROVIDER_KEY, {
      code: msg.includes("timed out") ? "timeout" : "upstream_error",
      message: `Banner unroll render failed: ${msg.slice(0, 300)}`,
      retryable: true,
    });
  }
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration",
      "-of", "default=noprint_wrappers=1",
      outPath,
    ]);
    const w = Number(/width=(\d+)/.exec(stdout)?.[1]);
    const h = Number(/height=(\d+)/.exec(stdout)?.[1]);
    const d = Number(/duration=([\d.]+)/.exec(stdout)?.[1]);
    if (w !== W || h !== H) {
      return errResult(PROVIDER_KEY, {
        code: "upstream_error",
        message: `Banner unroll resolution mismatch: got ${w}x${h}, expected ${W}x${H}.`,
        retryable: true,
      });
    }
    if (Number.isFinite(d) && Math.abs(d - D) > 1.5) {
      return errResult(PROVIDER_KEY, {
        code: "upstream_error",
        message: `Banner unroll duration mismatch: got ${d.toFixed(2)}s, expected ${D}s.`,
        retryable: true,
      });
    }
    return okResult(PROVIDER_KEY, { path: outPath, durationSec: d || D, width: w, height: h, motion: "static" });
  } catch (err) {
    return errResult(PROVIDER_KEY, {
      code: "upstream_error",
      message: `ffprobe verification failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      retryable: true,
    });
  }
}

/**
 * Animate a still image into a cinematic vertical MP4.
 */
export async function animateImage(
  inputPath: string,
  options: AnimateOptions = {}
): Promise<ProviderResult<AnimateOutput>> {
  const parsed = AnimateOptionsSchema.safeParse(options);
  if (!parsed.success) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Invalid animation options.",
      retryable: false,
    });
  }
  if (!existsSync(inputPath)) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: `Input image not found: ${inputPath}`,
      retryable: false,
    });
  }
  if (!(await checkFfmpeg())) {
    return errResult(PROVIDER_KEY, {
      code: "dependency_missing",
      message: "ffmpeg binary not found on PATH.",
      retryable: false,
    });
  }

  const o = parsed.data;
  const full = {
    motion: o.motion,
    durationSec: o.durationSec,
    width: o.width,
    height: o.height,
    fps: o.fps,
    lightSweep: o.lightSweep,
    preset: o.preset,
  };
  const frames = Math.round(full.durationSec * full.fps);
  const outPath =
    o.outputPath || join(dirname(inputPath), `${parse(inputPath).name}.anim.mp4`);
  mkdirSync(dirname(outPath), { recursive: true });

  const vf = motionFilter(full.motion, full);
  const args: string[] = ["-y", "-loop", "1", "-i", inputPath];

  let filterComplex: string;
  if (full.lightSweep && full.motion !== "static") {
    // Second input: a soft white band; overlay drifts it across the frame.
    const bandW = Math.round(full.width * 0.3);
    args.push(
      "-f", "lavfi",
      "-i", `color=white:size=${bandW}x${full.height}:duration=${full.durationSec}:rate=${full.fps},format=rgba`
    );
    filterComplex =
      `[0:v]${vf}[v];` +
      `[1:v]colorchannelmixer=aa=0.16[glow];` +
      `[v][glow]overlay=x='-${bandW}+t*(${full.width}+${bandW * 2})/${full.durationSec}':y=0:shortest=1,format=yuv420p`;
  } else {
    filterComplex = `[0:v]${vf}`;
  }

  args.push(
    "-filter_complex", filterComplex,
    "-frames:v", String(frames),
    "-c:v", "libx264",
    "-preset", full.preset,
    "-pix_fmt", "yuv420p",
    "-r", String(full.fps),
    "-an",
    "-movflags", "+faststart",
    outPath
  );

  const started = Date.now();
  try {
    await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResult(PROVIDER_KEY, {
      code: msg.includes("timed out") ? "timeout" : "upstream_error",
      message: `FFmpeg render failed: ${msg.slice(0, 300)}`,
      retryable: true,
    });
  }

  // Verify with ffprobe: resolution + duration must match the request.
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration",
      "-of", "default=noprint_wrappers=1",
      outPath,
    ]);
    const w = Number(/width=(\d+)/.exec(stdout)?.[1]);
    const h = Number(/height=(\d+)/.exec(stdout)?.[1]);
    const d = Number(/duration=([\d.]+)/.exec(stdout)?.[1]);
    if (w !== full.width || h !== full.height) {
      return errResult(PROVIDER_KEY, {
        code: "upstream_error",
        message: `Output resolution mismatch: got ${w}x${h}, expected ${full.width}x${full.height}.`,
        retryable: true,
      });
    }
    if (Number.isFinite(d) && Math.abs(d - full.durationSec) > 1.5) {
      return errResult(PROVIDER_KEY, {
        code: "upstream_error",
        message: `Output duration mismatch: got ${d.toFixed(2)}s, expected ${full.durationSec}s.`,
        retryable: true,
      });
    }
    return okResult(
      PROVIDER_KEY,
      { path: outPath, durationSec: d || full.durationSec, width: w, height: h, motion: full.motion },
      { durationMs: Date.now() - started }
    );
  } catch (err) {
    return errResult(PROVIDER_KEY, {
      code: "upstream_error",
      message: `ffprobe verification failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      retryable: true,
    });
  }
}
