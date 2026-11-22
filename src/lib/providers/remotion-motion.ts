/**
 * Remotion "code motion" tier — deterministic motion graphics rendered on
 * our own VM (no AI, no quota, no per-call cost).
 *
 * Sits between AI diffusion tiers and FFmpeg in the video pool: when AI
 * endpoints are cooling down or the ZeroGPU budget is spent, scenes get a
 * code-rendered Ken Burns + title-card treatment instead of plain FFmpeg
 * motion. Output is deterministic, so it can never hallucinate content —
 * videoExperimental is always false for this tier.
 *
 * HARD RULES (same honesty contract as every provider adapter):
 *  - Gated behind REMOTION_ENABLED=true (default: disabled).
 *  - All heavy deps (@remotion/renderer, @remotion/bundler, Chrome) are
 *    loaded DYNAMICALLY inside the render call. This file has NO top-level
 *    imports beyond zod/types — it is safe to import from anywhere,
 *    including code paths bundled by Turbopack.
 *  - NEVER throws: every failure is a typed error naming "ffmpeg" as the
 *    fallback. A missing dependency is `dependency_missing`, never a crash.
 *  - Deploy needs: `remotion`, `@remotion/renderer`, `@remotion/bundler`
 *    installed AND a Chrome/Chromium binary (see docs/video-pool.md).
 */
import { execFile } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { z } from "zod";
import { errResult, okResult, type ProviderResult } from "./types";

export const PROVIDER_KEY = "remotion";

const RenderInputSchema = z.object({
  imagePath: z.string().min(1),
  /** On-screen title (scene on-screen text). Truncated to 90 chars. */
  title: z.string().max(500).default(""),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff6b35"),
  durationSec: z.number().positive().max(60),
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  fps: z.number().int().default(30),
  outputPath: z.string().min(1),
});

export interface RemotionMotionOutput {
  /** Local mp4 path written by the renderer. */
  path: string;
}

const execFileAsync = promisify(execFile);

export function isConfigured(): boolean {
  return process.env.REMOTION_ENABLED === "true";
}

/** Pure: build the composition props (image → data URI, title truncated). */
export function buildCodeMotionProps(
  imagePath: string,
  title: string,
  accentColor: string
): { imageDataUri: string; title: string; accentColor: string } {
  const buf = readFileSync(imagePath);
  const ext = imagePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return {
    imageDataUri: `data:image/${ext};base64,${buf.toString("base64")}`,
    title: title.trim().slice(0, 90),
    accentColor,
  };
}

/** Locate a Chrome/Chromium binary. Null when none is installed. */
async function findChrome(): Promise<string | null> {
  const explicit = (process.env.REMOTION_CHROME_PATH || "").trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const bin of ["google-chrome", "chromium", "chromium-browser", "chrome-headless-shell"]) {
    try {
      const { stdout } = await execFileAsync("which", [bin], { timeout: 10_000 });
      const p = stdout.trim().split("\n")[0]?.trim();
      if (p && existsSync(p)) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function timeoutMs(): number {
  const raw = Number(process.env.REMOTION_TIMEOUT_SEC || "");
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 600_000;
}

/**
 * Render one scene with the CodeMotion composition. NEVER throws — always
 * returns a typed result; callers fall through to ffmpeg-motion on failure.
 */
export async function renderCodeMotion(
  input: z.input<typeof RenderInputSchema>
): Promise<ProviderResult<RemotionMotionOutput>> {
  const parsed = RenderInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(
      PROVIDER_KEY,
      { code: "invalid_input", message: "Invalid Remotion input.", retryable: false, fallback: "ffmpeg" },
      {}
    );
  }
  const { imagePath, title, accentColor, durationSec, width, height, fps, outputPath } = parsed.data;

  if (!isConfigured()) {
    return errResult(
      PROVIDER_KEY,
      {
        code: "not_configured",
        message: "Remotion tier is disabled. Set REMOTION_ENABLED=true to use code-motion rendering.",
        retryable: false,
        fallback: "ffmpeg",
      },
      {}
    );
  }
  if (!existsSync(imagePath)) {
    return errResult(
      PROVIDER_KEY,
      { code: "invalid_input", message: `Input image not found: ${imagePath}`, retryable: false, fallback: "ffmpeg" },
      {}
    );
  }

  let renderer: typeof import("@remotion/renderer");
  try {
    renderer = await import("@remotion/renderer");
  } catch {
    return errResult(
      PROVIDER_KEY,
      {
        code: "dependency_missing",
        message: "@remotion/renderer is not installed. Run `npm i -S remotion @remotion/renderer @remotion/bundler`.",
        retryable: false,
        fallback: "ffmpeg",
      },
      {}
    );
  }

  const chromePath = await findChrome();
  if (!chromePath) {
    return errResult(
      PROVIDER_KEY,
      {
        code: "dependency_missing",
        message:
          "No Chrome/Chromium binary found. Install one (e.g. `npx remotion browser ensure`) or set REMOTION_CHROME_PATH.",
        retryable: false,
        fallback: "ffmpeg",
      },
      {}
    );
  }

  let bundler: typeof import("@remotion/bundler");
  try {
    bundler = await import("@remotion/bundler");
  } catch {
    return errResult(
      PROVIDER_KEY,
      {
        code: "dependency_missing",
        message: "@remotion/bundler is not installed. Run `npm i -S @remotion/bundler`.",
        retryable: false,
        fallback: "ffmpeg",
      },
      {}
    );
  }

  try {
    const props = buildCodeMotionProps(imagePath, title, accentColor);
    const entryPoint = join(process.cwd(), "src", "lib", "remotion", "index.ts");
    if (!existsSync(entryPoint)) {
      return errResult(
        PROVIDER_KEY,
        { code: "dependency_missing", message: `Remotion entry not found: ${entryPoint}`, retryable: false, fallback: "ffmpeg" },
        {}
      );
    }
    const serveUrl = await bundler.bundle({ entryPoint });
    const composition = await renderer.selectComposition({
      serveUrl,
      id: "CodeMotion",
      inputProps: props,
      browserExecutable: chromePath,
    });
    composition.durationInFrames = Math.max(1, Math.round(durationSec * fps));
    composition.width = width;
    composition.height = height;
    composition.fps = fps;

    const renderPromise = renderer.renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: props,
      browserExecutable: chromePath,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Remotion render timed out after ${timeoutMs() / 1000}s`)), timeoutMs())
    );
    await Promise.race([renderPromise, timeoutPromise]);

    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      return errResult(
        PROVIDER_KEY,
        { code: "upstream_error", message: "Remotion rendered nothing (empty output).", retryable: false, fallback: "ffmpeg" },
        {}
      );
    }
    return okResult(PROVIDER_KEY, { path: outputPath }, {});
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errResult(
      PROVIDER_KEY,
      { code: "upstream_error", message: `Remotion render failed: ${message.slice(0, 300)}`, retryable: false, fallback: "ffmpeg" },
      {}
    );
  }
}
