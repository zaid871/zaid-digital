/**
 * Microsoft Edge TTS adapter (free, no API key).
 *
 * Uses the `edge-tts` npm package (a TypeScript port of the Python edge-tts
 * library) against Edge's online TTS endpoint. Hindi voices:
 *  - hi-IN-SwaraNeural  (female, default)
 *  - hi-IN-MadhurNeural (male)
 *
 * This is an unofficial endpoint: it can throttle or change without notice,
 * so failures are typed (never silent) and callers should fall back to
 * hf-inference TTS. Voice/rate/pitch are overridable via env:
 *  EDGE_TTS_VOICE, EDGE_TTS_RATE (e.g. "+0%"), EDGE_TTS_PITCH, EDGE_TTS_VOLUME
 */
import { z } from "zod";
import { existsSync } from "fs";
import { join } from "path";
import { errResult, okResult, type ProviderResult } from "./types";

export const PROVIDER_KEY = "edge-tts";

const SynthesizeInputSchema = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().min(1).optional(),
  rate: z.string().optional(),
  pitch: z.string().optional(),
  volume: z.string().optional(),
});

const TIMEOUT_MS = 90_000;

interface EdgeTtsModule {
  tts: (text: string, opts?: Record<string, string>) => Promise<Buffer>;
  getVoices?: () => Promise<Array<{ Name?: string; ShortName?: string; Locale?: string }>>;
}

async function loadModule(): Promise<EdgeTtsModule> {
  try {
    const mod = (await import("edge-tts")) as unknown as {
      tts?: EdgeTtsModule["tts"];
      getVoices?: EdgeTtsModule["getVoices"];
      default?: EdgeTtsModule;
    };
    const tts = mod.tts ?? mod.default?.tts;
    if (typeof tts !== "function") {
      throw new Error("package has no usable tts export");
    }
    return { tts, getVoices: mod.getVoices ?? mod.default?.getVoices };
  } catch (err) {
    throw new Error(
      `The 'edge-tts' npm package could not be loaded: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}. Run \`npm install edge-tts\`.`
    );
  }
}

export function isConfigured(): boolean {
  // No credentials required; availability = package present on disk.
  return existsSync(join(process.cwd(), "node_modules", "edge-tts"));
}

export function defaultVoice(): string {
  return process.env.EDGE_TTS_VOICE || "hi-IN-SwaraNeural";
}

/**
 * Synthesize speech → MP3 buffer. Returns typed errors on failure;
 * never returns empty/silent audio as success.
 */
export async function synthesize(
  input: z.input<typeof SynthesizeInputSchema>
): Promise<ProviderResult<Buffer>> {
  const parsed = SynthesizeInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Invalid TTS input.",
      retryable: false,
    });
  }
  let mod: EdgeTtsModule;
  try {
    mod = await loadModule();
  } catch (err) {
    return errResult(PROVIDER_KEY, {
      code: "dependency_missing",
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    });
  }

  const { text } = parsed.data;
  const voice = parsed.data.voice || defaultVoice();
  const opts: Record<string, string> = { voice };
  if (parsed.data.rate || process.env.EDGE_TTS_RATE) opts.rate = parsed.data.rate || process.env.EDGE_TTS_RATE!;
  if (parsed.data.pitch || process.env.EDGE_TTS_PITCH) opts.pitch = parsed.data.pitch || process.env.EDGE_TTS_PITCH!;
  if (parsed.data.volume || process.env.EDGE_TTS_VOLUME) opts.volume = parsed.data.volume || process.env.EDGE_TTS_VOLUME!;

  const started = Date.now();
  try {
    const audio = await Promise.race([
      mod.tts(text, opts),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("edge-tts timed out")), TIMEOUT_MS)
      ),
    ]);
    if (!audio || audio.length === 0) {
      return errResult(
        PROVIDER_KEY,
        { code: "upstream_error", message: "Edge TTS returned empty audio.", retryable: true, fallback: "hf" },
        { model: voice }
      );
    }
    return okResult(PROVIDER_KEY, audio, { model: voice, durationMs: Date.now() - started });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResult(
      PROVIDER_KEY,
      {
        code: msg.includes("timed out") ? "timeout" : "upstream_error",
        message: `Edge TTS synthesis failed: ${msg.slice(0, 200)}`,
        retryable: true,
        fallback: "hf",
      },
      { model: voice }
    );
  }
}

/** List available voices (best-effort; used by the providers UI). */
export async function listVoices(): Promise<ProviderResult<string[]>> {
  let mod: EdgeTtsModule;
  try {
    mod = await loadModule();
  } catch (err) {
    return errResult(PROVIDER_KEY, {
      code: "dependency_missing",
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    });
  }
  if (!mod.getVoices) {
    return errResult(PROVIDER_KEY, {
      code: "unavailable",
      message: "Voice listing is not supported by the installed edge-tts version.",
      retryable: false,
    });
  }
  try {
    const voices = await mod.getVoices();
    const names = voices
      .map((v) => v.ShortName || v.Name || "")
      .filter((n) => n.length > 0)
      .filter((n) => n.toLowerCase().startsWith("hi-in"));
    return okResult(PROVIDER_KEY, names, {});
  } catch (err) {
    return errResult(PROVIDER_KEY, {
      code: "upstream_error",
      message: `Voice listing failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      retryable: true,
    });
  }
}
