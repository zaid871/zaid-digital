/**
 * Tier A (EXPERIMENTAL) video adapter — Hugging Face Spaces image-to-video.
 *
 * Uses public Gradio Spaces hosting open video-diffusion models (e.g.
 * CogVideoX / LTX-Video demos) via a small Python bridge (`hf_spaces_bridge.py`,
 * `gradio_client`). 100% free, no credit card — but unofficial, queue-bound,
 * and a Space can change its API or vanish at any time.
 *
 * HARD RULES:
 *  - Gated behind HF_SPACES_VIDEO_ENABLED=true (default: disabled).
 *  - Strict timeout (default 120s, HF_SPACES_TIMEOUT_SEC).
 *  - On ANY failure the result is a typed error naming "ffmpeg" as the
 *    fallback — callers must fall through to the Tier B ffmpeg-motion adapter.
 *  - Every success is labeled `experimental: true` and must be verified
 *    (ffprobe) before use.
 *
 * Per-Space tuning (Spaces differ!): HF_SPACE_ID, HF_SPACE_API_NAME,
 * HF_SPACE_EXTRA_ARGS_JSON.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { z } from "zod";
import { errResult, okResult, type ProviderResult } from "./types";

export const PROVIDER_KEY = "hf-spaces-video";

const GenerateInputSchema = z.object({
  imagePath: z.string().min(1),
  prompt: z.string().min(1).max(1000),
  /** Override the Space id for this call. */
  spaceId: z.string().min(1).optional(),
  /** Override the Gradio api_name for this call. */
  apiName: z.string().min(1).optional(),
});

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_SEC = 120;

export interface SpacesVideoOutput {
  /** Local mp4 path produced by the bridge (temp dir — caller must persist). */
  path: string;
  spaceId: string;
}

function bridgePath(): string | null {
  if (process.env.HF_SPACES_BRIDGE_PATH && existsSync(process.env.HF_SPACES_BRIDGE_PATH)) {
    return process.env.HF_SPACES_BRIDGE_PATH;
  }
  const candidates: string[] = [join(process.cwd(), "src/lib/providers/hf_spaces_bridge.py")];
  try {
    const here = typeof __dirname !== "undefined" ? __dirname : null;
    if (here) candidates.push(join(here, "hf_spaces_bridge.py"));
  } catch {
    /* ignore */
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function isConfigured(): boolean {
  return process.env.HF_SPACES_VIDEO_ENABLED === "true";
}

async function gradioClientAvailable(): Promise<boolean> {
  try {
    await execFileAsync("python3", ["-c", "import gradio_client"], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

interface BridgeJson {
  ok: boolean;
  video?: string;
  error?: string;
}

/**
 * Try one experimental Space generation. NEVER throws — always returns a
 * typed result, falling back to ffmpeg-motion on any failure.
 */
export async function generateVideo(
  input: z.input<typeof GenerateInputSchema>
): Promise<ProviderResult<SpacesVideoOutput>> {
  const parsed = GenerateInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(
      PROVIDER_KEY,
      { code: "invalid_input", message: "Invalid Spaces video input.", retryable: false, fallback: "ffmpeg" },
      { experimental: true }
    );
  }
  if (!isConfigured()) {
    return errResult(
      PROVIDER_KEY,
      {
        code: "not_configured",
        message: "HF Spaces video is disabled. Set HF_SPACES_VIDEO_ENABLED=true to try the experimental Tier A path.",
        retryable: false,
        fallback: "ffmpeg",
      },
      { experimental: true }
    );
  }
  if (!existsSync(parsed.data.imagePath)) {
    return errResult(
      PROVIDER_KEY,
      { code: "invalid_input", message: `Input image not found: ${parsed.data.imagePath}`, retryable: false, fallback: "ffmpeg" },
      { experimental: true }
    );
  }
  const bridge = bridgePath();
  if (!bridge) {
    return errResult(
      PROVIDER_KEY,
      { code: "dependency_missing", message: "hf_spaces_bridge.py not found.", retryable: false, fallback: "ffmpeg" },
      { experimental: true }
    );
  }
  if (!(await gradioClientAvailable())) {
    return errResult(
      PROVIDER_KEY,
      {
        code: "dependency_missing",
        message: "gradio_client is not installed for python3 (pip install gradio-client).",
        retryable: false,
        fallback: "ffmpeg",
      },
      { experimental: true }
    );
  }

  const spaceId = parsed.data.spaceId || process.env.HF_SPACE_ID || "Lightricks/LTX-Video";
  const apiName = parsed.data.apiName || process.env.HF_SPACE_API_NAME || "/predict";
  const timeoutSec = Number(process.env.HF_SPACES_TIMEOUT_SEC || DEFAULT_TIMEOUT_SEC);
  const args = [
    bridge,
    "--space", spaceId,
    "--image", parsed.data.imagePath,
    "--prompt", parsed.data.prompt,
    "--api-name", apiName,
  ];
  if (process.env.HF_SPACE_EXTRA_ARGS_JSON) {
    args.push("--extra-args-json", process.env.HF_SPACE_EXTRA_ARGS_JSON);
  }

  const started = Date.now();
  try {
    const { stdout } = await execFileAsync("python3", args, {
      timeout: timeoutSec * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const lastLine = stdout.trim().split("\n").pop() || "";
    let parsed2: BridgeJson;
    try {
      parsed2 = JSON.parse(lastLine) as BridgeJson;
    } catch {
      return errResult(
        PROVIDER_KEY,
        { code: "upstream_error", message: `Bridge returned unparseable output: ${lastLine.slice(0, 200)}`, retryable: true, fallback: "ffmpeg" },
        { experimental: true, model: spaceId }
      );
    }
    if (!parsed2.ok || !parsed2.video || !existsSync(parsed2.video)) {
      return errResult(
        PROVIDER_KEY,
        { code: "upstream_error", message: `Space generation failed: ${(parsed2.error || "no video produced").slice(0, 300)}`, retryable: true, fallback: "ffmpeg" },
        { experimental: true, model: spaceId }
      );
    }
    return okResult(
      PROVIDER_KEY,
      { path: parsed2.video, spaceId },
      { experimental: true, model: spaceId, durationMs: Date.now() - started }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResult(
      PROVIDER_KEY,
      {
        code: msg.includes("timed out") ? "timeout" : "upstream_error",
        message: `Spaces bridge failed (${msg.slice(0, 160)}). Falling back to Tier B.`,
        retryable: true,
        fallback: "ffmpeg",
      },
      { experimental: true, model: spaceId }
    );
  }
}
