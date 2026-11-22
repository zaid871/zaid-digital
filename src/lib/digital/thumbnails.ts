/**
 * YouTube thumbnail + video intro/outro screen generator.
 *
 * Pollinations FLUX background image + FFmpeg drawtext overlay: bold
 * title (max 2 lines), optional subtitle, accent bar. Text is rendered
 * by FFmpeg, not by the image model, so the title is always legible —
 * AI image models garble text, and a thumbnail with a misspelled title
 * is unsellable.
 *
 * Formats: thumbnail 1280x720, intro/outro 1920x1080 (full-HD screens
 * for the start/end of a video). All three are still images — motion
 * intros / outros / transitions are NOT built here, those need video
 * files, not PNGs.
 *
 * Honest limits:
 *  - Still image only. Motion intros / outros / transitions are NOT
 *    built here — those need video files, not PNGs.
 *  - drawtext needs DejaVu Sans Bold on the system; if the font file is
 *    missing, the title overlay is skipped with a warning (background
 *    image still ships).
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { generateImage } from "@/lib/providers/pollinations";
import { DigitalError } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { wrapWords } from "../pipeline/assets";

const execFileAsync = promisify(execFile);

const FONT_CANDIDATES = [
  // Anton (OFL, bundled in assets/fonts + installed in the Docker image):
  // condensed all-caps display face — the AIpreneur thumbnail look.
  "/usr/share/fonts/truetype/poppins/anton-400.ttf",
  // Poppins (OFL, bundled in assets/fonts + installed in the Docker image)
  "/usr/share/fonts/truetype/poppins/Poppins-Bold.ttf",
  // DejaVu fallbacks (Ubuntu / Alpine paths)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
];

/** First drawtext font that exists on this system, or null (overlay skipped). */
const FONT = FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;

export type ThumbnailStyle = "dark" | "light";
export type ScreenFormat = "thumbnail" | "intro" | "outro";

const FORMAT_DIMS: Record<ScreenFormat, { width: number; height: number; file: string }> = {
  thumbnail: { width: 1280, height: 720, file: "thumbnail.png" },
  intro: { width: 1920, height: 1080, file: "intro.png" },
  outro: { width: 1920, height: 1080, file: "outro.png" },
};

export interface ThumbnailRequest {
  title: string;
  subtitle?: string;
  /** Background image prompt. Defaults to a cinematic backdrop for the title. */
  backgroundPrompt?: string;
  style?: ThumbnailStyle;
  /** thumbnail 1280x720 (default); intro/outro are 1920x1080 screens. */
  format?: ScreenFormat;
}

export interface ThumbnailResult {
  kind: ScreenFormat;
  title: string;
  slug: string;
  dir: string;
  file: string | null;
  files: { manifest: string; zip: string | null; background: string };
  warnings: string[];
}

function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");
}

export async function generateThumbnail(
  req: ThumbnailRequest,
  deps?: { outRoot?: string }
): Promise<ThumbnailResult> {
  const title = cleanText(req.title, 120);
  if (title.length < 3) throw new DigitalError("validation_error", "Thumbnail needs a title (min 3 chars).");
  const subtitle = cleanText(req.subtitle ?? "", 200);
  const style: ThumbnailStyle = req.style === "light" ? "light" : "dark";
  const warnings: string[] = [];
  const price = `${title} ${subtitle}`.match(PRICE_PATTERN);
  if (price) throw new DigitalError("compliance_rejected", `Thumbnail failed the compliance scan: price/offer pattern: "${price[0]}".`);
  const banned = `${title} ${subtitle}`.match(BANNED_CLAIM_PATTERN);
  if (banned) throw new DigitalError("compliance_rejected", `Thumbnail failed the compliance scan: banned claim pattern: "${banned[0]}".`);

  const slug = slugify(title);
  const format: ScreenFormat = req.format === "intro" || req.format === "outro" ? req.format : "thumbnail";
  const dims = FORMAT_DIMS[format];
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(`${format}-${slug}`));
  await mkdir(dir, { recursive: true });

  // 1. Background image (Pollinations FLUX, format size).
  const scene = format === "thumbnail" ? "YouTube thumbnail background" : format === "intro" ? "video intro screen background" : "video outro screen background";
  const bgPrompt =
    cleanText(req.backgroundPrompt ?? "", 500) ||
    `Cinematic ${scene} for the topic "${title}": dramatic lighting, dark premium backdrop, clean negative space on the left for text, no text, no words, no letters, photorealistic`;
  const img = await generateImage({ prompt: bgPrompt, width: dims.width, height: dims.height, model: "flux" });
  if (!img.ok) {
    throw new DigitalError("generation_failed", `Thumbnail background failed: ${img.error.message}`);
  }
  const bgPath = join(dir, "background.png");
  await writeFile(bgPath, img.data);

  // 2. Text overlay via FFmpeg drawtext (legible by construction).
  // Layout scales with the format: thumbnail 1280x720 is the base (s=1),
  // intro/outro 1920x1080 scale by 1.5.
  const outPath = join(dir, dims.file);
  let file: string | null = null;
  const s = dims.width / 1280;
  const px = (v: number) => Math.round(v * s);
  if (!FONT) {
    warnings.push("thumbnail_font_missing: no drawtext font found (Poppins-Bold / DejaVuSans-Bold) — title overlay skipped, background.png ships as-is");
    await writeFile(outPath, img.data);
    file = outPath;
  } else {
    const lines = wrapWords(title, format === "thumbnail" ? 18 : 22).slice(0, 2);
    const titleColor = style === "light" ? "0x1C1C22" : "white";
    const boxColor = style === "light" ? "white@0.75" : "black@0.55";
    const filters: string[] = [
      // Pollinations kabhi chhoti image de sakta hai (1024x576 mila) —
      // pehle hamesha format size par scale karo, phir text overlay.
      `scale=${dims.width}:${dims.height}`,
      // Accent bar, top-left.
      `drawbox=x=${px(64)}:y=${px(56)}:w=${px(120)}:h=${px(10)}:color=0xFF6B35:t=fill`,
      // Title lines, bottom-left, with a semi-transparent box behind.
      ...lines.map(
        (line, i) =>
          `drawtext=fontfile=${FONT}:text='${escapeDrawtext(line)}':fontsize=${px(96)}:fontcolor=${titleColor}:box=1:boxcolor=${boxColor}:boxborderw=${px(24)}:x=${px(64)}:y=${px(380) + i * px(112)}`
      ),
    ];
    if (subtitle) {
      filters.push(
        `drawtext=fontfile=${FONT}:text='${escapeDrawtext(wrapWords(subtitle, 40)[0] ?? subtitle)}':fontsize=${px(40)}:fontcolor=${titleColor}:box=1:boxcolor=${boxColor}:boxborderw=${px(16)}:x=${px(64)}:y=${px(380) + lines.length * px(112) + px(16)}`
      );
    }
    try {
      await execFileAsync(
        "ffmpeg",
        ["-hide_banner", "-y", "-i", bgPath, "-vf", filters.join(","), "-frames:v", "1", outPath],
        { timeout: 120_000 }
      );
      file = outPath;
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 200) : String(err);
      warnings.push(`thumbnail_overlay_failed: text overlay failed (${detail}) — background.png ships as-is`);
      await writeFile(outPath, img.data);
      file = outPath;
    }
  }

  const manifestPath = await writeManifest(dir, {
    type: format,
    title,
    subtitle: subtitle || null,
    style,
    dimensions: `${dims.width}x${dims.height}`,
    files: { [format]: file ? file.split("/").pop() : null, background: "background.png" },
    deliveryNotes: [
      "Title FFmpeg se render hua hai — AI image se nahi, is liye spelling hamesha sahi hai.",
      "Background image AI-generated hai; use karne se pehle ek baar dekh lein.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return { kind: format, title, slug, dir, file, files: { manifest: manifestPath, zip: zipPath, background: bgPath }, warnings };
}
