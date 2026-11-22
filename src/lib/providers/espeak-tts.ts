/**
 * espeak-ng TTS adapter — local, free, last-resort voice fallback.
 *
 * Honest placement in the chain: robotic quality, no neural naturalness.
 * It exists so a voiceover can still be produced when both Edge TTS and
 * Hugging Face TTS are unavailable — it NEVER pretends to be a premium
 * voice, and the audioProvider label always says "espeak" so QC and the
 * user can see exactly which voice produced the audio.
 *
 * Requires the `espeak-ng` (or legacy `espeak`) binary on the host/VM.
 * Outputs WAV via --stdout; downstream normalization handles the format.
 */
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { errResult, okResult, type ProviderResult } from "./types";

export const PROVIDER_KEY = "espeak";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 60_000;

let cachedBinary: string | null | undefined;

/** Resolve the espeak binary once; null when neither espeak-ng nor espeak exists. */
function resolveBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const bin of ["espeak-ng", "espeak"]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 5000 });
      cachedBinary = bin;
      return bin;
    } catch {
      // try next
    }
  }
  cachedBinary = null;
  return null;
}

/** True when a usable espeak binary is installed on this machine. */
export function isConfigured(): boolean {
  return resolveBinary() !== null;
}

/** Default voice: Hindi. Falls back to the engine default when "hi" is unavailable. */
export function defaultVoice(): string {
  return "hi";
}

export interface EspeakSynthesizeInput {
  text: string;
  /** espeak voice id, e.g. "hi". Defaults to "hi". */
  voice?: string;
  /** Words per minute. espeak default is 175. */
  rateWpm?: number;
}

/**
 * Synthesize speech to a WAV buffer. Returns a typed error (never silence)
 * when the binary is missing, the voice is unsupported, or synthesis fails.
 */
export async function synthesize(input: EspeakSynthesizeInput): Promise<ProviderResult<Buffer>> {
  const bin = resolveBinary();
  if (!bin) {
    return errResult(PROVIDER_KEY, {
      code: "dependency_missing",
      message:
        "espeak binary not found. Install espeak-ng on the host/VM (e.g. `sudo apt install espeak-ng`) to enable the last-resort TTS fallback.",
      retryable: false,
    });
  }
  const text = (input.text || "").trim();
  if (!text) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Empty narration text — refusing to synthesize silence.",
      retryable: false,
    });
  }
  const voice = (input.voice || defaultVoice()).trim() || defaultVoice();
  const rate = Math.min(400, Math.max(80, Math.round(input.rateWpm ?? 165)));

  const started = Date.now();
  // Try the requested voice first; if the engine reports it missing, retry
  // once with the engine default voice rather than failing the whole chain.
  const attempts: Array<{ voice: string; label: string }> = [
    { voice, label: voice },
    { voice: "", label: "default" },
  ];
  let lastDetail = "";
  for (const a of attempts) {
    const args =
      a.voice.length > 0
        ? ["-v", a.voice, "-s", String(rate), "--stdout", text]
        : ["-s", String(rate), "--stdout", text];
    try {
      const { stdout } = await execFileAsync(bin, args, {
        encoding: "buffer",
        timeout: TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      });
      const wav = stdout as Buffer;
      if (!wav || wav.length < 44 || wav.subarray(0, 4).toString("ascii") !== "RIFF") {
        lastDetail = `invalid wav output (voice=${a.label})`;
        continue;
      }
      return okResult(PROVIDER_KEY, wav, {
        model: `espeak:${bin}:${a.label}`,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errText = (err as { stderr?: unknown })?.stderr;
      const stderr = Buffer.isBuffer(errText) ? errText.toString("utf8", 0, 300) : "";
      lastDetail = `${msg.slice(0, 120)}${stderr ? ` | ${stderr}` : ""}`;
      // Only retry with the default voice when the requested voice is missing.
      const voiceMissing = /voice|variant|language/i.test(stderr) && /not|unknown|failed|error/i.test(stderr);
      if (!(a.voice.length > 0 && voiceMissing)) break;
    }
  }
  return errResult(PROVIDER_KEY, {
    code: "upstream_error",
    message: `espeak synthesis failed. Last: ${lastDetail}`,
    retryable: true,
  });
}
