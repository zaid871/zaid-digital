/**
 * Phase 6 — final video rendering.
 *
 * Assembles per-scene assets (1080x1920 scene MP4s + MP3 voiceovers) into
 * the finished vertical video:
 *
 *   scene segments (normalized 1080x1920@30fps, h264)
 *     → concat → + 2.5s end-card
 *   scene MP3s → concat → loudnorm → + 2.5s silence pad
 *     → mux with burned-in captions → faststart MP4 → ffprobe verify
 *
 * Rules enforced here, always:
 * - NO price is ever rendered (drawtext/subtitles inputs are price-scanned).
 * - NO music: the only audio is the normalized voiceover (+ silence).
 * - Captions stay inside the mobile-safe area (bottom margin).
 *
 * Nothing is fabricated: every ffmpeg failure throws a typed RenderError
 * (transient vs permanent), and the output is ffprobe-verified before
 * the function resolves.
 */
import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { db } from "@/lib/db";
import { updateStage } from "@/lib/job-service";
import { getStorage } from "@/lib/storage";
import {
  assetsRoot,
  cuesToAss,
  cuesToKineticAss,
  jobAssetsDir,
  parseSrt,
  probeMedia,
  saveText,
  storageKey,
} from "./assets";
import { loudnormFilter, measureLoudnorm } from "./loudnorm";
import { checklistAssEvents, hookCardAssEvents, serifTitleAssEvents } from "./motion";
import { isPremiumDark } from "./types";

const execFileAsync = promisify(execFile);

export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;
export const RENDER_FPS = 30;
export const END_CARD_SEC = 2.5;
/** Brand-dark end-card background (dark navy — never pure black). */
const END_CARD_BG = "0x14141f";

// The hook card is now a motion-graphics ASS overlay (rise + fade),
// built by src/lib/pipeline/motion.ts and burned in with the captions
// in step 5 — the static drawtext version was replaced 2026-11-10
// (docs/motion-graphics.md). Nothing here draws hook text anymore.

function captionFont(): string {
  const override = process.env.CAPTION_FONT;
  const candidates = [
    override,
    // Alpine (font-dejavu package): /usr/share/fonts/dejavu/
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    // Debian/Ubuntu layout
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new RenderError(
    `No caption font found (tried ${candidates.join(", ")}). Set CAPTION_FONT to a .ttf path.`,
    false
  );
}

/** Typed ffmpeg failure: transient (safe to retry) vs permanent. */
export class RenderError extends Error {
  transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = "RenderError";
    this.transient = transient;
  }
}

/** Permanent (do-not-retry) ffmpeg failure signatures. */
const PERMANENT_SIG = /no such file|invalid data|unknown encoder|invalid argument|not found|no such option/i;

async function runFfmpeg(args: string[], label: string, timeoutMs = 600_000): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-y", ...args], { timeout: timeoutMs });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const short = detail.slice(0, 600);
    const transient = !PERMANENT_SIG.test(short);
    throw new RenderError(`ffmpeg failed during ${label}: ${short}`, transient);
  }
}

interface StreamProbe {
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSec: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
}

/** Full ffprobe: streams, codecs, fps, durations. Throws RenderError when unreadable. */
export async function probeFull(absPath: string): Promise<StreamProbe> {
  if (!existsSync(absPath)) {
    throw new RenderError(`Cannot probe missing file: ${absPath}`, false);
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration",
        "-show_entries", "format=duration",
        "-of", "json",
        absPath,
      ],
      { timeout: 30_000 }
    ));
  } catch (err) {
    throw new RenderError(
      `ffprobe failed on ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
  const json = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
  };
  const v = json.streams?.find((s) => s.codec_type === "video");
  const a = json.streams?.find((s) => s.codec_type === "audio");
  let fps: number | null = null;
  if (v?.avg_frame_rate) {
    const [n, d] = v.avg_frame_rate.split("/").map(Number);
    if (n > 0 && d > 0) fps = Math.round((n / d) * 100) / 100;
  }
  const num = (s?: string): number | null => {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps,
    durationSec: num(json.format?.duration) ?? num(v?.duration) ?? num(a?.duration),
    hasVideo: !!v,
    hasAudio: !!a,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
  };
}

/** Escape text for drawtext=text='…'. */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\n/g, " ")
    .trim();
}

/** Escape a filesystem path for the subtitles / concat filters. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

/** Word-wrap a single line of text to at most maxChars per line. */
function wrapLine(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface RenderSceneInput {
  sceneId: string;
  /** Absolute path to the 1080x1920 scene MP4. */
  videoPath: string;
  /** Absolute path to the scene MP3 voiceover. */
  audioPath: string;
  /** Scene duration in seconds (audio timeline wins). */
  durationSec: number;
}

export interface RenderOptions {
  jobId: string;
  productName: string;
  /** Neutral CTA, e.g. "Check the link in the description". */
  callToAction: string;
  /**
   * Auto-DM CTA line (e.g. "Comment me LINK likho — link seedha tumhare
   * DM me bhej dunga."). When present it takes priority over callToAction
   * on the end-card — it is the video's primary call to action.
   */
  dmCtaLine?: string | null;
  /** Absolute path to the job's captions.srt (burned in). */
  srtPath: string;
  /** Absolute path to the job's captions.vtt (sidecar). */
  vttPath: string;
  targetDurationSec: number;
  /**
   * Visual style preset. "premium_dark" adds a subtle film-grain overlay
   * and switches captions to a larger bold display style.
   */
  visualStyle?: string | null;
  /**
   * Caption rendering mode. "kinetic" = word-by-word highlight captions
   * (current word in an accent color); "standard" = plain cue blocks.
   */
  captionMode?: "standard" | "kinetic";
  /**
   * Hook-card text (The Brand Saga style): oversized hook question burned
   * onto the first scene for the first 2.5s — now as a motion-graphics
   * ASS overlay (rise + fade), not drawtext. Set only for brand_story
   * jobs — sourced from the storyboard's scene-1 onScreenText. Null/empty
   * (or a price mention) disables the card; rendering never fails on it.
   */
  hookCardText?: string | null;
  /**
   * Feature checklist (motion-graphics reveal, "ONE editor" promo style):
   * verified feature lines shown one by one on the last product scene.
   * Set only for brand_story jobs — sourced from the creative plan's
   * sellingPoints. Empty/null disables the checklist.
   */
  checklistFeatures?: string[] | null;
  /**
   * Sticker-highlight kinetic captions (AIpreneur style): the current
   * word renders as a black-on-yellow sticker instead of orange text.
   * Only applies in kinetic mode; set only for brand_story jobs.
   */
  stickerHighlight?: boolean;
  /**
   * Serif title card (ATTAR attar-luxury style): the end card's brand
   * title in wide-tracked Fraunces serif caps + one short italic
   * tagline, burned onto the last scene. Set only for attar_luxury
   * jobs — title from research brand/product name, tagline from the
   * last storyboard scene's onScreenText[0] (script-written, verified
   * facts only). Null disables the card; a price in the tagline drops
   * the tagline only.
   */
  serifTitle?: { title: string; tagline: string | null } | null;
}

export interface RenderSpecs {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface RenderResult {
  outputPath: string;
  srtPath: string;
  vttPath: string;
  specs: RenderSpecs;
}

function assertFile(path: string, what: string): void {
  if (!existsSync(path)) {
    throw new RenderError(`${what} not found: ${path}`, false);
  }
}

/**
 * Render the final MP4 for a job. Throws RenderError on any failure —
 * callers decide retry policy from `err.transient`.
 */
export async function renderFinalVideo(
  scenes: RenderSceneInput[],
  opts: RenderOptions
): Promise<RenderResult> {
  if (scenes.length === 0) {
    throw new RenderError("renderFinalVideo called with zero scenes.", false);
  }
  const dir = jobAssetsDir(opts.jobId);
  const workDir = join(dir, "render");
  mkdirSync(workDir, { recursive: true });
  const font = captionFont();

  // ---- validate inputs -------------------------------------------------
  for (const s of scenes) {
    assertFile(s.videoPath, `Scene ${s.sceneId} video`);
    assertFile(s.audioPath, `Scene ${s.sceneId} audio`);
    if (!(s.durationSec > 0)) {
      throw new RenderError(`Scene ${s.sceneId} has non-positive duration.`, false);
    }
  }
  assertFile(opts.srtPath, "Captions SRT");

  // ---- 1. normalize each scene to a video-only 1080x1920@30 segment ----
  const segPaths: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const vProbe = await probeMedia(s.videoPath);
    const dur = Math.round(s.durationSec * 100) / 100;
    const videoDur = vProbe.durationSec ?? dur;
    const pad = Math.max(0, Math.round((dur - videoDur) * 100) / 100);
    const seg = join(workDir, `seg_${String(i).padStart(2, "0")}.mp4`);
    // Pad short videos by cloning the last frame; trim long ones.
    await runFfmpeg(
      [
        "-i", s.videoPath,
        "-filter_complex",
        `[0:v]scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=increase,` +
          `crop=${RENDER_WIDTH}:${RENDER_HEIGHT},fps=${RENDER_FPS},format=yuv420p,` +
          `tpad=stop_mode=clone:stop_duration=${pad},trim=0:${dur},setpts=PTS-STARTPTS[v]`,
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", String(RENDER_FPS),
        "-an",
        seg,
      ],
      `scene ${s.sceneId} normalization`
    );
    segPaths.push(seg);
  }

  // ---- 2. end-card (product name + CTA, brand-dark, no price) ------------
  // The auto-DM CTA line takes priority: it is the video's primary call
  // to action ("Comment me LINK likho …"). Falls back to callToAction.
  const endCard = join(workDir, "endcard.mp4");
  const safeName = escapeDrawtext(opts.productName.slice(0, 48) || "Product");
  const cardCta = (opts.dmCtaLine?.trim() || opts.callToAction || "").slice(0, 120);
  // drawtext cannot wrap: split the CTA into at most 2 centered lines.
  const ctaLines = wrapLine(cardCta, 42).slice(0, 2);
  const ctaDraws = ctaLines
    .map(
      (line, i) =>
        `drawtext=fontfile=${font}:fontsize=36:fontcolor=0xBBBBBB:text='${escapeDrawtext(line)}':` +
        `x=(w-text_w)/2:y=(h-text_h)/2+${30 + i * 52}`
    )
    .join(",");
  await runFfmpeg(
    [
      "-f", "lavfi",
      "-i", `color=c=${END_CARD_BG}:s=${RENDER_WIDTH}x${RENDER_HEIGHT}:r=${RENDER_FPS}:d=${END_CARD_SEC}`,
      "-vf",
      `drawtext=fontfile=${font}:fontsize=58:fontcolor=white:text='${safeName}':x=(w-text_w)/2:y=(h-text_h)/2-90` +
        (ctaDraws ? `,${ctaDraws}` : ""),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", String(RENDER_FPS),
      "-an",
      endCard,
    ],
    "end-card generation"
  );

  // ---- 3. concat video segments + end-card ------------------------------
  const listPath = join(workDir, "video_list.txt");
  saveText(
    listPath,
    [...segPaths, endCard].map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n"
  );
  const videoFull = join(workDir, "video_full.mp4");
  await runFfmpeg(
    [
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", String(RENDER_FPS),
      "-an",
      videoFull,
    ],
    "video concat"
  );

  // ---- 4. concat voiceover MP3s → loudnorm → pad for end-card -----------
  const audioList = join(workDir, "audio_list.txt");
  saveText(
    audioList,
    scenes.map((s) => `file '${s.audioPath.replace(/'/g, "'\\''")}'`).join("\n") + "\n"
  );
  const voiceRaw = join(workDir, "voice_raw.m4a");
  await runFfmpeg(
    ["-f", "concat", "-safe", "0", "-i", audioList, "-c:a", "aac", "-b:a", "128k", voiceRaw],
    "voiceover concat"
  );
  const voiceNorm = join(workDir, "voice_norm.m4a");
  // Two-pass EBU R128 normalization — narration only, never music.
  // Loudness target: -14 LUFS integrated / -1.5 dBTP true peak — the
  // social/Reels delivery standard (bare `loudnorm` defaults to -24 LUFS,
  // far too quiet for Reels). Pass 1 measures, pass 2 applies in linear
  // mode; if measurement or linear mode is impossible for this source,
  // fall back to the single-pass filter. QA re-measures against this target.
  const voiceMeasured = await measureLoudnorm(voiceRaw);
  if (voiceMeasured) {
    try {
      await runFfmpeg(
        ["-i", voiceRaw, "-af", loudnormFilter(voiceMeasured), "-c:a", "aac", "-b:a", "128k", voiceNorm],
        "voiceover loudness normalization (two-pass)"
      );
    } catch {
      await runFfmpeg(
        ["-i", voiceRaw, "-af", loudnormFilter(null), "-c:a", "aac", "-b:a", "128k", voiceNorm],
        "voiceover loudness normalization (single-pass fallback)"
      );
    }
  } else {
    await runFfmpeg(
      ["-i", voiceRaw, "-af", loudnormFilter(null), "-c:a", "aac", "-b:a", "128k", voiceNorm],
      "voiceover loudness normalization"
    );
  }
  const audioFull = join(workDir, "audio_full.m4a");
  await runFfmpeg(
    [
      "-i", voiceNorm,
      "-af", `aresample=48000,apad=whole_dur=${END_CARD_SEC}:pad_dur=${END_CARD_SEC}`,
      "-c:a", "aac", "-b:a", "128k",
      audioFull,
    ],
    "voiceover end-card pad"
  );

  // ---- 5. mux + burn captions ------------------------------------------
  // Convert SRT → ASS with explicit 1080x1920 PlayRes FIRST: libass
  // defaults to a 384x288 play resolution, which would scale the caption
  // font ~6.7x and produce giant text. The ASS carries the style itself.
  const cues = parseSrt(readFileSync(opts.srtPath, "utf-8"));
  if (!cues) {
    throw new RenderError(`Captions SRT failed to parse: ${opts.srtPath}`, false);
  }
  const assPath = join(workDir, "captions.ass");
  const premiumDark = isPremiumDark(opts.visualStyle);
  // Premium-dark: larger bold display captions, pushed slightly higher so
  // they read as designed typography rather than default subtitles.
  // Kinetic mode: word-by-word accent highlight on the same styles.
  const captionStyle = premiumDark
    ? { fontSize: 62, marginV: 400, bold: true }
    : { fontSize: 48, marginV: 380 };
  // Motion-graphics overlays: the hook card rides on scene 1 (first
  // 2.5s, brand_story only); the feature checklist rides on the last
  // product scene (brand_story only); the serif title card rides on
  // the last scene (attar_luxury only). Same ASS file, same subtitles pass.
  const motionEvents: string[] = [];
  if (opts.hookCardText) motionEvents.push(...hookCardAssEvents(opts.hookCardText));
  if (opts.checklistFeatures?.length && scenes.length > 0) {
    const lastStart = scenes
      .slice(0, -1)
      .reduce((a, s) => a + s.durationSec, 0);
    const lastEnd = lastStart + scenes[scenes.length - 1].durationSec;
    motionEvents.push(...checklistAssEvents(opts.checklistFeatures, lastStart, lastEnd));
  }
  // Serif title card (attar_luxury only): brand title + tagline on the
  // last scene (the end-card hero close-up). Same ASS file, same pass.
  if (opts.serifTitle && scenes.length > 0) {
    const lastStart = scenes.slice(0, -1).reduce((a, s) => a + s.durationSec, 0);
    const lastEnd = lastStart + scenes[scenes.length - 1].durationSec;
    motionEvents.push(
      ...serifTitleAssEvents(opts.serifTitle.title, opts.serifTitle.tagline, lastStart, lastEnd)
    );
  }
  saveText(
    assPath,
    opts.captionMode === "kinetic"
      ? cuesToKineticAss(cues, {
          ...captionStyle,
          extraEvents: motionEvents,
          stickerHighlight: opts.stickerHighlight,
        })
      : cuesToAss(cues, { ...captionStyle, extraEvents: motionEvents })
  );
  const finalPath = join(dir, "final.mp4");
  // Premium-dark: subtle temporal film grain over the finished video. This
  // kills the "flat digital" feel of AI stills — the classic premium-ad cue.
  const grainFilter = premiumDark ? ",noise=alls=7:allf=t" : "";
  await runFfmpeg(
    [
      "-i", videoFull,
      "-i", audioFull,
      "-filter_complex",
      `[0:v]subtitles='${escapeFilterPath(assPath)}'${grainFilter}[v]`,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", String(RENDER_FPS),
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-shortest",
      finalPath,
    ],
    "final mux + caption burn-in",
    900_000
  );

  // ---- 6. ffprobe verification ------------------------------------------
  const probe = await probeFull(finalPath);
  const specs: RenderSpecs = {
    width: probe.width ?? 0,
    height: probe.height ?? 0,
    fps: probe.fps ?? 0,
    durationSec: probe.durationSec ?? 0,
    hasVideo: probe.hasVideo,
    hasAudio: probe.hasAudio,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
  };
  const problems: string[] = [];
  if (!probe.hasVideo) problems.push("no video stream");
  if (!probe.hasAudio) problems.push("no audio stream");
  if (probe.width !== RENDER_WIDTH || probe.height !== RENDER_HEIGHT) {
    problems.push(`resolution ${probe.width}x${probe.height}, expected ${RENDER_WIDTH}x${RENDER_HEIGHT}`);
  }
  if (probe.videoCodec !== "h264") problems.push(`video codec ${probe.videoCodec}, expected h264`);
  if (probe.audioCodec !== "aac") problems.push(`audio codec ${probe.audioCodec}, expected aac`);
  const expectedMin = opts.targetDurationSec - 2;
  const expectedMax = opts.targetDurationSec + 2 + END_CARD_SEC + 1;
  if (specs.durationSec < expectedMin || specs.durationSec > expectedMax) {
    problems.push(
      `duration ${specs.durationSec.toFixed(2)}s outside expected ${expectedMin}–${expectedMax.toFixed(1)}s window`
    );
  }
  if (problems.length > 0) {
    throw new RenderError(`Rendered file failed verification: ${problems.join("; ")}`, true);
  }

  return { outputPath: finalPath, srtPath: opts.srtPath, vttPath: opts.vttPath, specs };
}

// ---------------------------------------------------------------------------
// Stage runner: reads scene assets from the DB, renders, retries ≤2 on
// transient ffmpeg errors. Throws RenderError (worker maps to stage FAILED).
// ---------------------------------------------------------------------------

async function emitEvent(jobId: string, type: string, message: string) {
  await db.jobEvent.create({ data: { jobId, type, message } });
}

/**
 * Build render inputs from persisted Phase 5 rows. Fails closed when any
 * scene is missing its video or audio asset.
 */
export async function buildRenderInputs(jobId: string): Promise<{
  scenes: RenderSceneInput[];
  opts: RenderOptions;
}> {
  const [job, storyboard, script, research, sceneAssets, plan] = await Promise.all([
    db.job.findUnique({ where: { id: jobId } }),
    db.storyboard.findUnique({ where: { jobId } }),
    db.script.findUnique({ where: { jobId } }),
    db.productResearch.findUnique({ where: { jobId } }),
    db.sceneAsset.findMany({ where: { jobId } }),
    db.creativePlan.findUnique({ where: { jobId } }),
  ]);
  if (!job) throw new RenderError(`Job ${jobId} not found.`, false);
  if (!storyboard) throw new RenderError(`No storyboard for job ${jobId} — cannot render.`, false);

  const root = assetsRoot();
  const byScene = new Map<string, { video?: string; audio?: string }>();
  for (const a of sceneAssets) {
    if (a.assetType !== "video" && a.assetType !== "audio") continue;
    const entry = byScene.get(a.sceneId) ?? {};
    // Latest asset wins (regeneration safe).
    entry[a.assetType as "video" | "audio"] = join(root, a.storageKey);
    byScene.set(a.sceneId, entry);
  }

  const scenes: RenderSceneInput[] = [];
  const sb = storyboard.scenes as Array<{
    sceneId: string;
    durationSeconds: number;
    onScreenText?: string[];
  }>;
  for (const sc of sb) {
    const entry = byScene.get(sc.sceneId);
    if (!entry?.video || !entry?.audio) {
      throw new RenderError(
        `Scene ${sc.sceneId} is missing ${!entry?.video ? "video" : ""}${!entry?.video && !entry?.audio ? " and " : ""}${!entry?.audio ? "audio" : ""} asset — refusing to render an incomplete video.`,
        false
      );
    }
    // The narration timeline wins: scene length = actual voiceover duration.
    const audioProbe = await probeMedia(entry.audio);
    const durationSec = audioProbe.durationSec ?? sc.durationSeconds;
    scenes.push({ sceneId: sc.sceneId, videoPath: entry.video, audioPath: entry.audio, durationSec });
  }

  const dir = jobAssetsDir(jobId);
  const srtPath = join(dir, "captions.srt");
  const vttPath = join(dir, "captions.vtt");
  if (!existsSync(srtPath)) {
    throw new RenderError(`Captions SRT missing for job ${jobId} — cannot render.`, false);
  }

  return {
    scenes,
    opts: {
      ...renderOptsBase({
        jobId,
        productName: research?.productName,
        callToAction: script?.callToAction as string | undefined,
        dmCtaLine:
          (
            (script as unknown as { dmCta?: unknown }).dmCta as
              | { ctaLine?: string }
              | undefined
          )?.ctaLine || null,
        targetDurationSec: job.durationSeconds ?? 45,
        visualStyle: job.visualStyle ?? null,
        scriptStyle: job.scriptStyle ?? null,
        storyboardScenes: sb,
        sellingPoints: plan?.sellingPoints ?? [],
        brand: research?.brand ?? null,
      }),
      srtPath,
      vttPath,
    },
  };
}

/**
 * The render options that do not depend on local file paths — shared by
 * buildRenderInputs (local render) and buildRenderBundle (remote render
 * on a GitHub Actions runner). One place, so the two paths can never
 * drift apart.
 */
function renderOptsBase(args: {
  jobId: string;
  productName: string | null | undefined;
  callToAction: string | undefined;
  dmCtaLine: string | null;
  targetDurationSec: number;
  visualStyle: string | null;
  scriptStyle: string | null;
  storyboardScenes: Array<{ onScreenText?: string[] }>;
  sellingPoints: string[];
  brand: string | null;
}): Omit<RenderOptions, "srtPath" | "vttPath"> {
  const sb = args.storyboardScenes;
  return {
    jobId: args.jobId,
    productName: args.productName ?? "Product",
    callToAction:
      args.callToAction ??
      "Check product details through the link in the description or profile.",
    dmCtaLine: args.dmCtaLine,
    targetDurationSec: args.targetDurationSec,
    visualStyle: args.visualStyle,
    // Premium-dark's display captions go kinetic (word highlight);
    // other styles keep standard cue blocks.
    captionMode: isPremiumDark(args.visualStyle) ? "kinetic" : "standard",
    // Hook card (brand_story only): scene-1 on-screen hook text, as
    // written by the script model (price-screened at script time; the
    // motion builder re-checks). Other styles get no hook card.
    hookCardText:
      args.scriptStyle === "brand_story" ? (sb[0]?.onScreenText?.[0] ?? null) : null,
    // Feature checklist (brand_story only): verified selling points
    // from the creative plan. Other styles get no checklist.
    checklistFeatures:
      args.scriptStyle === "brand_story" ? args.sellingPoints.slice(0, 4) : null,
    // Sticker-highlight captions (brand_story only): the current word
    // as a black-on-yellow sticker (AIpreneur style).
    stickerHighlight: args.scriptStyle === "brand_story",
    // Serif title card (attar_luxury only): brand title from research
    // (brand first, else product name); tagline from the last scene's
    // on-screen line (the script-written end-card tagline, [0] — the
    // DM badge, if any, is appended after it). Other styles: none.
    serifTitle:
      args.scriptStyle === "attar_luxury"
        ? {
            title: (args.brand ?? args.productName ?? "Product").slice(0, 30),
            tagline: sb[sb.length - 1]?.onScreenText?.[0] ?? null,
          }
        : null,
  };
}

/** One scene of a remote render bundle: asset URLs, not local paths. */
export interface RenderBundleScene {
  sceneId: string;
  videoUrl: string;
  audioUrl: string;
  durationSec: number;
}

/**
 * A self-contained render job for a remote runner (GitHub Actions):
 * scene asset URLs (signed, 2 h), caption file contents, and the same
 * render options the local path uses. The runner downloads the assets,
 * writes the captions, and calls renderFinalVideo() — no DB access,
 * no backend credentials on the runner.
 */
export interface RenderBundle {
  jobId: string;
  scenes: RenderBundleScene[];
  captions: { srt: string; vtt: string };
  opts: Omit<RenderOptions, "srtPath" | "vttPath">;
}

/**
 * Build a remote render bundle from persisted Phase 5 rows. Fails
 * closed exactly like buildRenderInputs when a scene is missing an
 * asset or the captions file is missing.
 */
export async function buildRenderBundle(jobId: string): Promise<RenderBundle> {
  const [job, storyboard, script, research, sceneAssets, plan] = await Promise.all([
    db.job.findUnique({ where: { id: jobId } }),
    db.storyboard.findUnique({ where: { jobId } }),
    db.script.findUnique({ where: { jobId } }),
    db.productResearch.findUnique({ where: { jobId } }),
    db.sceneAsset.findMany({ where: { jobId } }),
    db.creativePlan.findUnique({ where: { jobId } }),
  ]);
  if (!job) throw new RenderError(`Job ${jobId} not found.`, false);
  if (!storyboard) throw new RenderError(`No storyboard for job ${jobId} — cannot render.`, false);

  const root = assetsRoot();
  const byScene = new Map<string, { video?: string; audio?: string }>();
  for (const a of sceneAssets) {
    if (a.assetType !== "video" && a.assetType !== "audio") continue;
    const entry = byScene.get(a.sceneId) ?? {};
    entry[a.assetType as "video" | "audio"] = join(root, a.storageKey);
    byScene.set(a.sceneId, entry);
  }

  const sb = storyboard.scenes as Array<{
    sceneId: string;
    durationSeconds: number;
    onScreenText?: string[];
  }>;
  const storage = getStorage();
  const scenes: RenderBundleScene[] = [];
  for (const sc of sb) {
    const entry = byScene.get(sc.sceneId);
    if (!entry?.video || !entry?.audio) {
      throw new RenderError(
        `Scene ${sc.sceneId} is missing ${!entry?.video ? "video" : ""}${!entry?.video && !entry?.audio ? " and " : ""}${!entry?.audio ? "audio" : ""} asset — refusing to render an incomplete video.`,
        false
      );
    }
    const audioProbe = await probeMedia(entry.audio);
    const durationSec = audioProbe.durationSec ?? sc.durationSeconds;
    const videoKey = sceneAssets.find(
      (a) => a.sceneId === sc.sceneId && a.assetType === "video"
    )?.storageKey;
    const audioKey = sceneAssets.find(
      (a) => a.sceneId === sc.sceneId && a.assetType === "audio"
    )?.storageKey;
    if (!videoKey || !audioKey) {
      throw new RenderError(`Scene ${sc.sceneId} is missing a storage key.`, false);
    }
    scenes.push({
      sceneId: sc.sceneId,
      videoUrl: await storage.signedUrl(jobId, videoKey, 7200),
      audioUrl: await storage.signedUrl(jobId, audioKey, 7200),
      durationSec,
    });
  }

  const dir = jobAssetsDir(jobId);
  const srtPath = join(dir, "captions.srt");
  const vttPath = join(dir, "captions.vtt");
  if (!existsSync(srtPath)) {
    throw new RenderError(`Captions SRT missing for job ${jobId} — cannot render.`, false);
  }
  const srt = readFileSync(srtPath, "utf-8");
  const vtt = existsSync(vttPath) ? readFileSync(vttPath, "utf-8") : "";

  return {
    jobId,
    scenes,
    captions: { srt, vtt },
    opts: renderOptsBase({
      jobId,
      productName: research?.productName,
      callToAction: script?.callToAction as string | undefined,
      dmCtaLine:
        (
          (script as unknown as { dmCta?: unknown }).dmCta as
            | { ctaLine?: string }
            | undefined
        )?.ctaLine || null,
      targetDurationSec: job.durationSeconds ?? 45,
      visualStyle: job.visualStyle ?? null,
      scriptStyle: job.scriptStyle ?? null,
      storyboardScenes: sb,
      sellingPoints: plan?.sellingPoints ?? [],
      brand: research?.brand ?? null,
    }),
  };
}

/**
 * Run the editing_rendering stage: render with bounded retry (≤2 retries)
 * on TRANSIENT ffmpeg errors only. Permanent errors fail immediately.
 */
export async function runRenderStage(jobId: string): Promise<RenderResult> {
  await updateStage(jobId, "editing_rendering", {
    status: "running",
    progressPct: 15,
    message: "Rendering final video (scene concat → voiceover → captions → end-card).",
  });

  const { scenes, opts } = await buildRenderInputs(jobId);
  await emitEvent(
    jobId,
    "render_started",
    `Rendering ${scenes.length} scene(s) to 1080x1920@${RENDER_FPS}fps with burned-in captions.`
  );

  const MAX_RETRIES = 2;
  let attempt = 0;
  for (;;) {
    try {
      const result = await renderFinalVideo(scenes, opts);
      await updateStage(jobId, "editing_rendering", {
        status: "succeeded",
        progressPct: 100,
        message: `Rendered final.mp4 (${result.specs.durationSec.toFixed(1)}s, ${result.specs.width}x${result.specs.height}@${result.specs.fps}fps).`,
        warnings: [],
      });
      await emitEvent(
        jobId,
        "render_complete",
        `Final video rendered and ffprobe-verified: ${result.outputPath}`
      );
      return result;
    } catch (err) {
      const transient = err instanceof RenderError ? err.transient : true;
      const detail = err instanceof Error ? err.message : String(err);
      if (!transient || attempt >= MAX_RETRIES) {
        await db.retryRecord.create({
          data: {
            jobId,
            stageKey: "editing_rendering",
            attempt: attempt + 1,
            reason: `Render failed (${transient ? "transient, retries exhausted" : "permanent"}): ${detail.slice(0, 500)}`,
            retryable: false,
          },
        });
        await updateStage(jobId, "editing_rendering", {
          status: "failed",
          message: `Rendering failed: ${detail.slice(0, 500)}`,
        });
        throw err instanceof RenderError ? err : new RenderError(detail, false);
      }
      attempt++;
      await db.retryRecord.create({
        data: {
          jobId,
          stageKey: "editing_rendering",
          attempt,
          reason: `Transient render error, retrying (${attempt}/${MAX_RETRIES}): ${detail.slice(0, 300)}`,
          retryable: true,
        },
      });
      await emitEvent(jobId, "render_retry", `Render attempt ${attempt + 1}/${MAX_RETRIES + 1} after transient error.`);
      await updateStage(jobId, "editing_rendering", {
        status: "running",
        progressPct: 15 + attempt * 10,
        message: `Render retry ${attempt}/${MAX_RETRIES} after transient error.`,
      });
    }
  }
}

/** Storage key helper for delivery. */
export function finalVideoStorageKey(absPath: string): string {
  return storageKey(absPath);
}
