/**
 * Voiceover synthesis (Phase 5) with provider failover.
 *
 * One audio file per storyboard scene via attemptWithFallback():
 * edge-tts hi-IN-SwaraNeural first, hf-inference Hindi TTS next,
 * espeak-ng local TTS as the last resort (robotic, but honest and free).
 * A provider that keeps failing is skipped via the router's circuit
 * breaker instead of being retried for every scene.
 *
 * Each file's real duration is measured with ffprobe; when it differs from
 * the planned scene duration by more than 15%, the timeline is adjusted and
 * `durationAdjusted` is recorded. TTS failures are typed PipelineErrors —
 * silent or fabricated audio is never produced.
 */
import { execFile } from "child_process";
import { extname, join } from "path";
import { rename, rm, writeFile } from "fs/promises";
import { promisify } from "util";
import * as edgeTts from "@/lib/providers/edge-tts";
import * as espeakTts from "@/lib/providers/espeak-tts";
import * as hfInference from "@/lib/providers/hf-inference";
import * as pollinations from "@/lib/providers/pollinations";
import { attemptWithFallback } from "@/lib/providers/fallback";
import { errResult, okResult, type ProviderResult } from "@/lib/providers/types";
import { jobAssetsDir, probeMedia } from "./assets";
import type { StoryboardObjectT } from "./schemas";
import { PipelineError, type SceneVoiceTiming } from "./types";
import {
  buildSsmlNarration,
  plainNarration,
  roleForScene,
  VOICE_PRESETS,
} from "./voice-presets";

const ADJUST_THRESHOLD = 0.15;

const execFileAsync = promisify(execFile);

/**
 * Trim leading silence from a freshly synthesized scene file. TTS engines
 * often pad 0.1–0.5s of silence before the first word — left in, the hook
 * lands late and the whole caption timeline drifts. Conservative settings
 * (-50 dB threshold, 0.05s of the silence kept) protect soft opening
 * consonants. Non-fatal: on any ffmpeg error the original file is kept.
 */
export async function trimLeadingSilence(audioPath: string): Promise<boolean> {
  const tmp = `${audioPath}.trim${extname(audioPath)}`;
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-y", "-i", audioPath,
        "-af",
        "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB:start_silence=0.05",
        tmp,
      ],
      { timeout: 60_000 }
    );
    await rename(tmp, audioPath);
    return true;
  } catch {
    await rm(tmp, { force: true }).catch(() => undefined);
    return false;
  }
}

/** Join-fade length (seconds) applied to each scene's head and tail. */
export const JOIN_FADE_SEC = 0.015;

/**
 * Fade a freshly synthesized scene file's head and tail so the joins in
 * the render-stage audio concat are click-free — the Nafay 3D editor's
 * technique (their cut.py ramps 6ms at every join; 15ms here is still
 * far below any audible gap, and the voice starts/ends in silence
 * anyway after the lead-in trim). Runs after trimLeadingSilence; the
 * fade does not change the file's duration. Non-fatal: on any ffmpeg
 * error the original file is kept (a fade is polish, never a reason to
 * fail a scene).
 */
export async function applyJoinFades(audioPath: string): Promise<boolean> {
  const probe = await probeMedia(audioPath).catch(() => null);
  const dur = probe?.durationSec;
  if (!dur || dur < JOIN_FADE_SEC * 2) return false;
  const tmp = `${audioPath}.fade${extname(audioPath)}`;
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-y", "-i", audioPath,
        "-af",
        `afade=t=in:st=0:d=${JOIN_FADE_SEC},afade=t=out:st=${dur - JOIN_FADE_SEC}:d=${JOIN_FADE_SEC}`,
        tmp,
      ],
      { timeout: 60_000 }
    );
    await rename(tmp, audioPath);
    return true;
  } catch {
    await rm(tmp, { force: true }).catch(() => undefined);
    return false;
  }
}

/**
 * Lexis-style clarity polish (from the Cartesia + Lexis video): a gentle
 * highpass at 80 Hz removes rumble and a +2 dB presence lift at 3 kHz
 * adds brightness/clarity to the voice. Conservative on purpose — the
 * video never speaks exact EQ numbers, so this stays subtle. Runs after
 * trimLeadingSilence, before the join fades. Non-fatal: on any ffmpeg
 * error the original file is kept (polish is never a reason to fail a
 * scene). The existing two-pass loudnorm at render time is the
 * "Normalize" step the videos teach — this EQ is its companion, not a
 * replacement. Synthetic TTS audio has no mic noise or reverb, so no
 * denoise step is needed (the Adobe Podcast fix applies to recorded
 * clone audio, not to this pipeline).
 */
export async function applyVoicePolish(audioPath: string): Promise<boolean> {
  const tmp = `${audioPath}.polish${extname(audioPath)}`;
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-y", "-i", audioPath,
        "-af",
        "highpass=f=80,equalizer=f=3000:width_type=o:width=1:g=2",
        tmp,
      ],
      { timeout: 60_000 }
    );
    await rename(tmp, audioPath);
    return true;
  } catch {
    await rm(tmp, { force: true }).catch(() => undefined);
    return false;
  }
}

export interface VoiceOptions {
  jobId: string;
  /** Voice override; defaults to edge-tts hi-IN-SwaraNeural. */
  voice?: string | null;
}

interface SceneAudio {
  audio: Buffer;
  /** File extension for the synthesized audio ("mp3" | "wav"). */
  ext: string;
  /** Honest provider label recorded in timings (e.g. "edge-tts:hi-IN-SwaraNeural"). */
  label: string;
}

/**
 * Synthesize every scene's narration. Returns per-scene timings on the
 * real (possibly adjusted) timeline. Throws PipelineError on any failure.
 */
export async function synthesizeScenes(
  storyboard: StoryboardObjectT,
  opts: VoiceOptions
): Promise<SceneVoiceTiming[]> {
  const audioDir = join(jobAssetsDir(opts.jobId), "audio");
  const timings: SceneVoiceTiming[] = [];
  let cursor = 0;

  for (const [i, scene] of storyboard.scenes.entries()) {
    // One mood per scene (Fish Audio / ElevenLabs rule): the scene's
    // purpose picks a voice role, and the role picks the prosody preset.
    // SSML (breaks + emphasis) goes ONLY to edge-tts — the fallback
    // providers do not understand SSML and would read the tags aloud.
    const role = roleForScene(scene.purpose, i, storyboard.scenes.length);
    const preset = VOICE_PRESETS[role];
    const plain = plainNarration(scene.narrationSegment);
    const ssml = buildSsmlNarration(scene.narrationSegment, preset);
    const res = await attemptWithFallback(
      "tts",
      async (provider): Promise<ProviderResult<SceneAudio>> => {
        if (provider.key === "edge-tts") {
          const r = await edgeTts.synthesize({
            text: ssml,
            voice: opts.voice || edgeTts.defaultVoice(),
            rate: preset.rate,
            pitch: preset.pitch,
            volume: preset.volume,
          });
          if (!r.ok) return errResult<SceneAudio>(provider.key, r.error);
          return okResult(provider.key, {
            audio: r.data,
            ext: "mp3",
            label: `edge-tts:${r.model ?? edgeTts.defaultVoice()}:${role}`,
          });
        }
        if (provider.key === "hf") {
          const r = await hfInference.textToSpeech({ text: plain, lang: "hi" });
          if (!r.ok) return errResult<SceneAudio>(provider.key, r.error);
          return okResult(provider.key, {
            audio: r.data,
            ext: "wav",
            label: `hf:${r.model ?? "mms-tts"}:${role}`,
          });
        }
        if (provider.key === "pollinations-tts") {
          const r = await pollinations.generateSpeech({ text: plain });
          if (!r.ok) return errResult<SceneAudio>(provider.key, r.error);
          return okResult(provider.key, {
            audio: r.data,
            ext: "mp3",
            label: `pollinations-tts:${r.model ?? "openai"}:${role}`,
          });
        }
        // Last resort: local espeak-ng. Robotic quality, always labeled honestly.
        const r = await espeakTts.synthesize({ text: plain });
        if (!r.ok) return errResult<SceneAudio>(provider.key, r.error);
        return okResult(provider.key, {
          audio: r.data,
          ext: "wav",
          label: `espeak:${r.model ?? "espeak-ng"}:${role}`,
        });
      }
    );
    if (!res.ok || !res.data) {
      throw new PipelineError(
        "provider_unavailable",
        "voiceover_generation",
        `TTS failed for scene ${scene.sceneId} after trying: ${res.attempted.join(", ") || "no usable provider"}. ${res.error?.message ?? ""}`,
        res.error?.retryable ?? false
      );
    }
    const { audio, ext, label: audioProvider } = res.data;

    if (!audio || audio.length === 0) {
      throw new PipelineError(
        "media_failed",
        "voiceover_generation",
        `TTS returned empty audio for scene ${scene.sceneId} — refusing to continue with silence.`,
        true
      );
    }

    const audioPath = join(audioDir, `${scene.sceneId}.${ext}`);
    await writeFile(audioPath, audio);
    // Remove TTS lead-in silence BEFORE probing, so scene timings (and
    // therefore captions) are measured from the first spoken word.
    await trimLeadingSilence(audioPath);
    // Clarity polish (Lexis-style EQ): non-fatal, original kept on error.
    await applyVoicePolish(audioPath);
    // Click-free joins: fade each scene's head/tail (non-fatal).
    await applyJoinFades(audioPath);

    const probe = await probeMedia(audioPath);
    const plannedSec = scene.durationSeconds;
    const actualSec = probe.durationSec ?? plannedSec;
    const durationAdjusted =
      plannedSec > 0 && Math.abs(actualSec - plannedSec) / plannedSec > ADJUST_THRESHOLD;

    const startSec = Math.round(cursor * 100) / 100;
    const endSec = Math.round((cursor + actualSec) * 100) / 100;
    cursor = endSec;

    timings.push({
      sceneId: scene.sceneId,
      audioPath,
      audioProvider,
      plannedSec: Math.round(plannedSec * 100) / 100,
      actualSec: Math.round(actualSec * 100) / 100,
      durationAdjusted,
      startSec,
      endSec,
    });
  }

  return timings;
}
