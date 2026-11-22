/**
 * Two-pass loudnorm support (EBU R128 via ffmpeg loudnorm).
 *
 * Pass 1 measures the source; pass 2 applies loudnorm with the measured
 * values and linear=true, which lands speech (pauses, varying energy) on
 * the -14 LUFS / -1.5 dBTP delivery target far more accurately than a
 * single dynamic pass. When measurement is unavailable — or linear mode
 * proves impossible for an extreme source — callers fall back to the
 * plain single-pass filter string from loudnormFilter(null).
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const LOUDNORM_TARGET = "loudnorm=I=-14:TP=-1.5:LRA=11";

export interface LoudnormMeasurement {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

/** Parse the JSON block loudnorm prints to stderr; null when absent. */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement | null {
  const get = (key: string): number | null => {
    const m = stderr.match(new RegExp(`"${key}"\\s*:\\s*"(-?[\\d.]+)"`));
    return m ? Number(m[1]) : null;
  };
  const inputI = get("input_i");
  const inputTp = get("input_tp");
  const inputLra = get("input_lra");
  const inputThresh = get("input_thresh");
  const targetOffset = get("target_offset");
  if (
    inputI === null ||
    inputTp === null ||
    inputLra === null ||
    inputThresh === null ||
    targetOffset === null
  ) {
    return null;
  }
  return { inputI, inputTp, inputLra, inputThresh, targetOffset };
}

/** Measure a file's loudness against the delivery target. Null on failure. */
export async function measureLoudnorm(absPath: string): Promise<LoudnormMeasurement | null> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", absPath, "-af", `${LOUDNORM_TARGET}:print_format=json`, "-f", "null", "-"],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }
    );
    return parseLoudnormMeasurement(stderr);
  } catch {
    return null;
  }
}

/** Filter string: two-pass (measured, linear) or single-pass fallback. */
export function loudnormFilter(measurement: LoudnormMeasurement | null): string {
  if (!measurement) return LOUDNORM_TARGET;
  const f = (n: number) => n.toFixed(2);
  return (
    `${LOUDNORM_TARGET}:measured_I=${f(measurement.inputI)}:measured_TP=${f(measurement.inputTp)}` +
    `:measured_LRA=${f(measurement.inputLra)}:measured_thresh=${f(measurement.inputThresh)}` +
    `:offset=${f(measurement.targetOffset)}:linear=true`
  );
}
