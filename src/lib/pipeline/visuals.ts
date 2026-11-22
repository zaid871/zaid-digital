/**
 * Scene visuals (Phase 5): still images, then motion video — per scene.
 *
 * Images: router "image" provider — hf-inference FLUX.1-schnell first,
 * Pollinations.ai as the no-key fallback.
 *
 * Video, three tiers:
 *  - Tier A (experimental): hf-spaces-video image-to-video diffusion, ONLY
 *    when HF_SPACES_VIDEO_ENABLED=true. Any failure falls through.
 *  - Tier A2 (experimental): pollinations-video free text-to-video clip.
 *    Any failure falls through to Tier B.
 *  - Tier B (default, reliable): ffmpeg-motion animateImage with the scene's
 *    camera movement. Output is always ffprobe-verified at 1080x1920.
 *
 * Failures are typed PipelineErrors — placeholder media is never produced.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import * as ffmpegMotion from "@/lib/providers/ffmpeg-motion";
import * as hfInference from "@/lib/providers/hf-inference";
import * as hfSpacesVideo from "@/lib/providers/hf-spaces-video";
import * as pollinations from "@/lib/providers/pollinations";
import * as pollinationsVideo from "@/lib/providers/pollinations-video";
import * as remotionMotion from "@/lib/providers/remotion-motion";
import { buildVideoPool, getVideoPoolState } from "@/lib/providers/video-pool";
import { attemptWithFallback } from "@/lib/providers/fallback";
import { errResult, okResult } from "@/lib/providers/types";
import { jobAssetsDir, probeMedia } from "./assets";
import type { StoryboardObjectT } from "./schemas";
import { PipelineError } from "./types";

const execFileAsync = promisify(execFile);
const OUT_W = 1080;
const OUT_H = 1920;
const OUT_FPS = 30;

export interface VisualsOptions {
  jobId: string;
}

export interface SceneImage {
  sceneId: string;
  imagePath: string;
  imageProvider: string;
  imageModel?: string;
  visualPrompt: string;
  /** Second still for comparison scenes (right side of the wipe). */
  comparisonRightPath?: string;
  /** True when the right still failed — scene falls back to single-image. */
  comparisonRightFailed?: boolean;
  /** Second still for banner-unroll scenes (banner fully open). */
  bannerOpenPath?: string;
  /** True when the open-banner still failed — scene falls back to single-image. */
  bannerOpenFailed?: boolean;
}

export interface SceneVideo {
  sceneId: string;
  videoPath: string;
  videoProvider: string;
  /** True when the video came from the experimental Tier A path. */
  videoExperimental: boolean;
  /** Honest downgrade note, e.g. a comparison rendered single-image. */
  note?: string;
}

/**
 * Generate one FLUX.1/Pollinations still per storyboard scene.
 * Throws PipelineError when no image provider can serve the task.
 */
/**
 * One image attempt over the router "image" providers (hf FLUX.1-schnell
 * first, then Pollinations variants). Shared by the main still and the
 * comparison right-side still so both use identical failover.
 */
async function generateOneImage(prompt: string) {
  return attemptWithFallback("image", async (provider) => {
    let inner;
    let label: string;
    switch (provider.key) {
      case "hf":
        inner = await hfInference.generateImage({ prompt });
        label = "hf";
        break;
      case "hf-sdxl":
        inner = await hfInference.generateImage({
          prompt,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
        });
        label = "hf-sdxl";
        break;
      case "pollinations-turbo":
        inner = await pollinations.generateImage({
          prompt,
          width: 768,
          height: 1360,
          model: "turbo",
        });
        label = "pollinations-turbo";
        break;
      default:
        inner = await pollinations.generateImage({
          prompt,
          width: 768,
          height: 1360,
        });
        label = "pollinations";
        break;
    }
    if (!inner.ok) {
      return errResult<{ buf: Buffer; label: string; model?: string }>(
        provider.key,
        inner.error
      );
    }
    return okResult(provider.key, {
      buf: inner.data,
      label,
      model: inner.model,
    });
  });
}

export async function generateSceneImages(
  storyboard: StoryboardObjectT,
  opts: VisualsOptions
): Promise<SceneImage[]> {
  const imgDir = join(jobAssetsDir(opts.jobId), "images");
  const images: SceneImage[] = [];

  for (const scene of storyboard.scenes) {
    // Fail over across image providers in router preference order:
    // hf (FLUX.1-schnell) → pollinations (flux) → pollinations-turbo →
    // hf-sdxl. A dead provider is skipped (circuit breaker), not retried
    // for every scene.
    const res = await generateOneImage(scene.visualPrompt);
    if (!res.ok || !res.data) {
      throw new PipelineError(
        "provider_unavailable",
        "ai_visual_generation",
        `Image generation failed for scene ${scene.sceneId} after trying: ${res.attempted.join(", ") || "no usable provider"}. ${res.error?.message ?? ""}`,
        res.error?.retryable ?? false
      );
    }
    const buf = res.data.buf;
    const label = res.data.label;
    const model = res.data.model;

    if (!buf || buf.length === 0) {
      throw new PipelineError(
        "media_failed",
        "ai_visual_generation",
        `Image provider returned empty bytes for scene ${scene.sceneId}.`,
        true
      );
    }
    const imagePath = join(imgDir, `${scene.sceneId}.png`);
    await writeFile(imagePath, buf);
    const entry: SceneImage = { sceneId: scene.sceneId, imagePath, imageProvider: label, imageModel: model, visualPrompt: scene.visualPrompt };
    images.push(entry);
    // Comparison scenes get a second still for the right side of the wipe.
    // A failed right image falls back to a single-image scene (flagged on
    // the entry) — a comparison is never faked from one image.
    if (scene.comparison) {
      const rightRes = await generateOneImage(
        `${scene.visualPrompt} Alternate version showing: ${scene.comparison.rightLabel}.`
      );
      if (rightRes.ok && rightRes.data && rightRes.data.buf.length > 0) {
        const rightPath = join(imgDir, `${scene.sceneId}-right.png`);
        await writeFile(rightPath, rightRes.data.buf);
        entry.comparisonRightPath = rightPath;
      } else {
        entry.comparisonRightFailed = true;
      }
    }
    // Banner-unroll scenes get a second still: the SAME building with the
    // banner fully unrolled down the facade. A failed open still falls
    // back to a single-image scene (flagged) — an unroll is never faked
    // from one image.
    if (scene.bannerUnroll) {
      const openRes = await generateOneImage(
        `${scene.visualPrompt} Alternate version: the same building with the banner fully unrolled down the whole facade, ` +
          `the poster clearly visible showing: ${scene.bannerUnroll.bannerText}.`
      );
      if (openRes.ok && openRes.data && openRes.data.buf.length > 0) {
        const openPath = join(imgDir, `${scene.sceneId}-open.png`);
        await writeFile(openPath, openRes.data.buf);
        entry.bannerOpenPath = openPath;
      } else {
        entry.bannerOpenFailed = true;
      }
    }
  }

  return images;
}

/**
 * Normalize an experimental Tier A clip to the pipeline spec:
 * 1080x1920, 30fps, exactly durationSec. Throws PipelineError when the
 * result cannot be brought into spec.
 */
async function normalizeTierAClip(
  srcPath: string,
  durationSec: number,
  outPath: string,
  sceneId: string
): Promise<void> {
  const probe = await probeMedia(srcPath);
  const needsFix =
    probe.width !== OUT_W ||
    probe.height !== OUT_H ||
    probe.durationSec === null ||
    Math.abs(probe.durationSec - durationSec) > 1.5;
  if (!needsFix) {
    await execFileAsync("ffmpeg", ["-y", "-i", srcPath, "-c", "copy", outPath], { timeout: 60_000 });
    return;
  }
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y", "-i", srcPath,
        "-vf", `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},setsar=1`,
        "-t", String(durationSec),
        "-r", String(OUT_FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-an", "-movflags", "+faststart",
        outPath,
      ],
      { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }
    );
  } catch (err) {
    throw new PipelineError(
      "media_failed",
      "ai_video_generation",
      `Tier A clip for scene ${sceneId} could not be normalized to 1080x1920: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      true
    );
  }
  const check = await probeMedia(outPath);
  if (check.width !== OUT_W || check.height !== OUT_H) {
    throw new PipelineError(
      "media_failed",
      "ai_video_generation",
      `Tier A clip for scene ${sceneId} failed verification after normalization (got ${check.width}x${check.height}).`,
      true
    );
  }
}

/**
 * Animate every scene still into a motion video. Tier A (experimental
 * diffusion) is attempted only when explicitly enabled; any Tier A failure
 * falls through to Tier B (ffmpeg-motion), which is ffprobe-verified.
 */
export async function animateSceneVideos(
  storyboard: StoryboardObjectT,
  images: SceneImage[],
  opts: VisualsOptions
): Promise<SceneVideo[]> {
  const vidDir = join(jobAssetsDir(opts.jobId), "videos");
  const byId = new Map(images.map((i) => [i.sceneId, i]));
  const videos: SceneVideo[] = [];

  for (const scene of storyboard.scenes) {
    const img = byId.get(scene.sceneId);
    if (!img || !existsSync(img.imagePath)) {
      throw new PipelineError(
        "media_failed",
        "ai_video_generation",
        `Still image missing for scene ${scene.sceneId} — cannot animate.`,
        false
      );
    }

    const videoPath = join(vidDir, `${scene.sceneId}.mp4`);
    let videoProvider = "ffmpeg";
    let videoExperimental = false;
    let tierADone = false;
    const comparisonNote =
      scene.comparison && img.comparisonRightFailed
        ? "comparison right image unavailable — rendered as a single-image scene"
        : scene.bannerUnroll && img.bannerOpenFailed
          ? "banner open image unavailable — rendered as a single-image scene"
          : undefined;

    // Comparison scenes skip AI-video tiers: a split-screen wipe is an
    // ffmpeg composition of two stills, not a diffusion clip.
    if (scene.comparison && img.comparisonRightPath && existsSync(img.comparisonRightPath)) {
      const r = await ffmpegMotion.animateComparison(img.imagePath, img.comparisonRightPath, {
        durationSec: scene.durationSeconds,
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        leftLabel: scene.comparison.leftLabel,
        rightLabel: scene.comparison.rightLabel,
        outputPath: videoPath,
      });
      if (!r.ok) {
        throw new PipelineError(
          "media_failed",
          "ai_video_generation",
          `Comparison render failed (scene ${scene.sceneId}): ${r.error.message}`,
          r.error.retryable
        );
      }
      const cprobe = await probeMedia(videoPath);
      if (cprobe.width !== OUT_W || cprobe.height !== OUT_H) {
        throw new PipelineError(
          "media_failed",
          "ai_video_generation",
          `Comparison scene ${scene.sceneId} failed verification: got ${cprobe.width}x${cprobe.height}, expected ${OUT_W}x${OUT_H}.`,
          true
        );
      }
      videos.push({ sceneId: scene.sceneId, videoPath, videoProvider: "ffmpeg", videoExperimental: false });
      continue;
    }

    // Banner-unroll scenes skip AI-video tiers too: the unroll is an
    // ffmpeg wipe between the closed- and open-banner stills.
    if (scene.bannerUnroll && img.bannerOpenPath && existsSync(img.bannerOpenPath)) {
      const r = await ffmpegMotion.animateBannerUnroll(img.imagePath, img.bannerOpenPath, {
        durationSec: scene.durationSeconds,
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        outputPath: videoPath,
      });
      if (!r.ok) {
        throw new PipelineError(
          "media_failed",
          "ai_video_generation",
          `Banner unroll render failed (scene ${scene.sceneId}): ${r.error.message}`,
          r.error.retryable
        );
      }
      const bprobe = await probeMedia(videoPath);
      if (bprobe.width !== OUT_W || bprobe.height !== OUT_H) {
        throw new PipelineError(
          "media_failed",
          "ai_video_generation",
          `Banner unroll scene ${scene.sceneId} failed verification: got ${bprobe.width}x${bprobe.height}, expected ${OUT_W}x${OUT_H}.`,
          true
        );
      }
      videos.push({ sceneId: scene.sceneId, videoPath, videoProvider: "ffmpeg", videoExperimental: false });
      continue;
    }

    // Video pool: rotate across AI endpoints (Spaces / Pollinations) with
    // per-endpoint cooldown + failure backoff + ZeroGPU quota ledger, then
    // Remotion code-motion, then FFmpeg. First success wins; the recorded
    // provider always names what ACTUALLY produced the clip — never faked.
    // Comparison scenes already continued above; they never enter the pool.
    const poolState = getVideoPoolState();
    const pool = buildVideoPool();
    for (const ep of poolState.orderedEndpoints(pool)) {
      if (ep.kind === "ffmpeg") break; // final fallback handled below
      poolState.recordUse(ep.key);
      if (ep.kind === "spaces") {
        const t0 = Date.now();
        const r = await hfSpacesVideo.generateVideo({
          imagePath: img.imagePath,
          prompt: scene.videoPrompt,
          spaceId: ep.ref,
        });
        // Wall-clock estimate of GPU minutes (includes queue wait — the
        // ledger is conservative by design; HF is the source of truth).
        poolState.recordSpacesUsage((Date.now() - t0) / 60000);
        if (r.ok && r.data.path && existsSync(r.data.path)) {
          await normalizeTierAClip(r.data.path, scene.durationSeconds, videoPath, scene.sceneId);
          videoProvider = ep.key;
          videoExperimental = true;
          tierADone = true;
          poolState.recordSuccess(ep.key);
          break;
        }
        poolState.recordFailure(ep.key);
      } else if (ep.kind === "pollinations") {
        const r = await pollinationsVideo.generateVideo({
          prompt: scene.videoPrompt || scene.visualPrompt,
          model: ep.ref,
        });
        if (r.ok && r.data.length > 0) {
          const tmpClip = join(vidDir, `${scene.sceneId}.pool.mp4`);
          await writeFile(tmpClip, r.data);
          await normalizeTierAClip(tmpClip, scene.durationSeconds, videoPath, scene.sceneId);
          videoProvider = ep.key;
          videoExperimental = true;
          tierADone = true;
          poolState.recordSuccess(ep.key);
          break;
        }
        poolState.recordFailure(ep.key);
      } else if (ep.kind === "remotion") {
        const r = await remotionMotion.renderCodeMotion({
          imagePath: img.imagePath,
          title: scene.onScreenText[0] || scene.narrationSegment,
          durationSec: scene.durationSeconds,
          outputPath: videoPath,
        });
        if (r.ok && existsSync(r.data.path)) {
          videoProvider = ep.key;
          videoExperimental = false; // deterministic code, not AI
          tierADone = true;
          poolState.recordSuccess(ep.key);
          break;
        }
        poolState.recordFailure(ep.key);
      }
    }

    if (!tierADone) {
      const r = await ffmpegMotion.animateImage(img.imagePath, {
        motion: scene.cameraMovement,
        durationSec: scene.durationSeconds,
        width: OUT_W,
        height: OUT_H,
        fps: OUT_FPS,
        lightSweep: true,
        outputPath: videoPath,
      });
      if (!r.ok) {
        throw new PipelineError(
          "media_failed",
          "ai_video_generation",
          `Tier B video render failed (scene ${scene.sceneId}): ${r.error.message}`,
          r.error.retryable
        );
      }
    }

    const vprobe = await probeMedia(videoPath);
    if (vprobe.width !== OUT_W || vprobe.height !== OUT_H) {
      throw new PipelineError(
        "media_failed",
        "ai_video_generation",
        `Scene ${scene.sceneId} video failed verification: got ${vprobe.width}x${vprobe.height}, expected ${OUT_W}x${OUT_H}.`,
        true
      );
    }

    videos.push({ sceneId: scene.sceneId, videoPath, videoProvider, videoExperimental, note: comparisonNote });
  }

  return videos;
}
