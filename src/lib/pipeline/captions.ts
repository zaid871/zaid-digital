/**
 * Caption generation (Phase 5) — deterministic, no network.
 *
 * Builds SRT and VTT files from narration segments using the REAL timeline
 * (voice-over timings, which may have been adjusted when TTS audio differed
 * from the planned scene durations). Lines are wrapped at word boundaries
 * to stay short and mobile-safe.
 */
import { join } from "path";
import { formatSrtTime, formatVttTime, jobAssetsDir, saveText, wrapWords } from "./assets";
import type { CaptionCue, SceneVoiceTiming } from "./types";

export interface CaptionFiles {
  srtPath: string;
  vttPath: string;
  cues: CaptionCue[];
}

export interface CaptionInput {
  sceneId: string;
  narration: string;
  startSec: number;
  endSec: number;
}

/**
 * Split each scene's narration into short cues distributed across the
 * scene's real time window, proportionally to chunk length.
 */
export function buildCaptionCues(inputs: CaptionInput[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const input of inputs) {
    const chunks = wrapWords(input.narration, 40);
    if (chunks.length === 0) continue;
    const totalChars = chunks.reduce((a, c) => a + c.length, 0) || 1;
    const window = Math.max(0.5, input.endSec - input.startSec);
    let cursor = input.startSec;
    chunks.forEach((chunk, i) => {
      const share = chunk.length / totalChars;
      // Last chunk absorbs rounding so the scene window is fully covered.
      const dur = i === chunks.length - 1 ? input.endSec - cursor : Math.max(0.8, window * share);
      cues.push({
        startSec: Math.round(cursor * 100) / 100,
        endSec: Math.round(Math.min(input.endSec, cursor + dur) * 100) / 100,
        text: chunk,
      });
      cursor += dur;
    });
  }
  return cues;
}

function toSrt(cues: CaptionCue[]): string {
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${formatSrtTime(c.startSec)} --> ${formatSrtTime(c.endSec)}\n${c.text}\n`
      )
      .join("\n") + "\n"
  );
}

function toVtt(cues: CaptionCue[]): string {
  return (
    "WEBVTT\n\n" +
    cues
      .map((c) => `${formatVttTime(c.startSec)} --> ${formatVttTime(c.endSec)}\n${c.text}\n`)
      .join("\n") +
    "\n"
  );
}

/**
 * Build SRT + VTT caption files for a job from the real voice timeline.
 * Timings come from synthesizeScenes (already adjusted); narration from the
 * storyboard. Throws only on filesystem failure.
 */
export async function buildCaptions(
  jobId: string,
  timings: SceneVoiceTiming[],
  narrations: Map<string, string>
): Promise<CaptionFiles> {
  const inputs: CaptionInput[] = timings.map((t) => ({
    sceneId: t.sceneId,
    narration: narrations.get(t.sceneId) ?? "",
    startSec: t.startSec,
    endSec: t.endSec,
  }));
  const cues = buildCaptionCues(inputs.filter((i) => i.narration.trim().length > 0));

  const dir = jobAssetsDir(jobId);
  const srtPath = saveText(join(dir, "captions.srt"), toSrt(cues));
  const vttPath = saveText(join(dir, "captions.vtt"), toVtt(cues));
  return { srtPath, vttPath, cues };
}
