/**
 * Filesystem + media-probe helpers for the creative pipeline.
 *
 * Per-job assets live under `<ASSETS_DIR>/<jobId>/` (default
 * `<project>/storage/jobs/<jobId>/`). Nothing here touches the network.
 */
import { execFile } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function assetsRoot(): string {
  return process.env.ASSETS_DIR || join(process.cwd(), "storage", "jobs");
}

/** Per-job asset directory (created on demand). */
export function jobAssetsDir(jobId: string): string {
  const dir = join(assetsRoot(), jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Storage key for a SceneAsset row — relative to the assets root. */
export function storageKey(absPath: string): string {
  return relative(assetsRoot(), absPath);
}

export function saveBuffer(absPath: string, buf: Buffer): string {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, buf);
  return absPath;
}

export function saveText(absPath: string, text: string): string {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, text, "utf-8");
  return absPath;
}

export function sha256File(absPath: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
  } catch {
    return null;
  }
}

export interface MediaProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/** ffprobe duration + first video stream resolution. Never throws. */
export async function probeMedia(absPath: string): Promise<MediaProbe> {
  const out: MediaProbe = { durationSec: null, width: null, height: null };
  if (!existsSync(absPath)) return out;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-show_entries", "stream=width,height",
        "-select_streams", "v:0",
        "-of", "json",
        absPath,
      ],
      { timeout: 30_000 }
    );
    const json = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ width?: number; height?: number }>;
    };
    if (json.format?.duration) {
      const d = Number(json.format.duration);
      if (Number.isFinite(d)) out.durationSec = d;
    }
    // Audio-only files have no video stream — fall back to format duration
    // (already captured) and leave width/height null.
    const v = json.streams?.[0];
    if (v?.width) out.width = v.width;
    if (v?.height) out.height = v.height;
    if (out.durationSec === null) {
      // Last resort: audio-stream duration via a second probe.
      const { stdout: s2 } = await execFileAsync(
        "ffprobe",
        ["-v", "error", "-show_entries", "stream=duration", "-select_streams", "a:0", "-of", "json", absPath],
        { timeout: 30_000 }
      );
      const d = Number((JSON.parse(s2) as { streams?: Array<{ duration?: string }> }).streams?.[0]?.duration);
      if (Number.isFinite(d)) out.durationSec = d;
    }
  } catch {
    /* probe failures surface as nulls — callers decide */
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 12.34 → "00:00:12,340" (SRT). */
export function formatSrtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(ss)},${String(ms).padStart(3, "0")}`;
}

/** 12.34 → "00:00:12.340" (VTT). */
export function formatVttTime(sec: number): string {
  return formatSrtTime(sec).replace(",", ".");
}

export interface ParsedCue {
  start: number;
  end: number;
  text: string;
}

/** Parse SRT into cues; null when malformed. Shared by render + QA. */
export function parseSrt(text: string): ParsedCue[] | null {
  const toSec = (t: string): number | null => {
    const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  };
  const cues: ParsedCue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) return null;
    const [a, b] = timeLine.split("-->");
    const start = toSec(a);
    const end = toSec(b);
    if (start === null || end === null || !(end > start)) return null;
    cues.push({ start, end, text: lines.slice(lines.indexOf(timeLine) + 1).join(" ") });
  }
  return cues.length > 0 ? cues : null;
}

/** 12.34 → "0:00:12.34" (ASS centiseconds). */
export function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Escape text for an ASS Dialogue Text field. Only `\`, `{`, `}` are
 * special in ASS text — a comma needs NO escaping (Text is the last
 * field), and `\,` renders as a literal backslash (caught 2026-11-10:
 * "AREY\, YE TOH" on the motion probe frame).
 */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/{/g, "(").replace(/}/g, ")");
}

/**
 * Build an ASS subtitle file with explicit PlayRes matching the 1080x1920
 * canvas. This is REQUIRED: libass defaults to a 384x288 play resolution,
 * which would scale FontSize up ~6.7x and produce giant captions.
 */
export function cuesToAss(
  cues: ParsedCue[],
  opts?: {
    fontName?: string;
    fontSize?: number;
    marginV?: number;
    bold?: boolean;
    /** Extra pre-built Dialogue lines (e.g. motion-graphics overlays). */
    extraEvents?: string[];
  }
): string {
  const fontName = opts?.fontName ?? "DejaVu Sans";
  const fontSize = opts?.fontSize ?? 48;
  const marginV = opts?.marginV ?? 150;
  const bold = opts?.bold ? -1 : 0;
  const events = cues
    .map(
      (c) =>
        `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},Default,,0,0,0,,${escapeAssText(c.text)}`
    )
    .join("\n");
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,2,0,2,90,150,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    [events, ...(opts?.extraEvents ?? [])].filter(Boolean).join("\n"),
    "",
  ].join("\n");
}

/**
 * Kinetic (word-highlight) ASS: each cue is split into chunks of at most 3
 * words; within a chunk, one Dialogue event per word shows the whole chunk
 * with the currently-spoken word in the accent color. Word timings are
 * ESTIMATED — distributed across the cue's real window proportionally to
 * word length (we know the exact narration text and the real scene
 * timings, but not per-word TTS alignment). Same PlayRes rules as
 * cuesToAss: explicit 1080x1920 or libass scales the font ~6.7x.
 *
 * stickerHighlight (AIpreneur style): the current word renders as a
 * black-on-yellow sticker — black text, thick yellow outline — instead of
 * the accent-colored text. The reset after the word restores the style's
 * normal white text / black 2px outline.
 */
export const STICKER_TEXT_ASS = "&H000000&";
export const STICKER_HIGHLIGHT_ASS = "&H00FFFF&";
export const STICKER_BORDER = 8;

export function cuesToKineticAss(
  cues: ParsedCue[],
  opts?: {
    fontName?: string;
    fontSize?: number;
    marginV?: number;
    bold?: boolean;
    /** Accent color in ASS &HAABBGGRR form. Default: vivid orange #ff6b35. */
    accentAss?: string;
    /** Black-on-yellow sticker highlight for the current word (brand_story). */
    stickerHighlight?: boolean;
    /** Extra pre-built Dialogue lines (e.g. motion-graphics overlays). */
    extraEvents?: string[];
  }
): string {
  const fontName = opts?.fontName ?? "DejaVu Sans";
  const fontSize = opts?.fontSize ?? 48;
  const marginV = opts?.marginV ?? 150;
  const bold = opts?.bold ? -1 : 0;
  const accent = opts?.accentAss ?? "&H00356BFF";
  const sticker = opts?.stickerHighlight ?? false;
  const base = "&H00FFFFFF";

  const events: string[] = [];
  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    // Chunks of ≤3 words.
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3));
    const chunkWeight = chunks.map((ch) => ch.join(" ").length + 1);
    const totalWeight = chunkWeight.reduce((a, b) => a + b, 0) || 1;
    let cursor = cue.start;
    chunks.forEach((chunk, ci) => {
      const chunkDur = ((cue.end - cue.start) * chunkWeight[ci]) / totalWeight;
      const chunkEnd = ci === chunks.length - 1 ? cue.end : cursor + chunkDur;
      const wordWeight = chunk.map((w) => w.length + 1);
      const wordTotal = wordWeight.reduce((a, b) => a + b, 0) || 1;
      let wCursor = cursor;
      chunk.forEach((word, wi) => {
        const wDur = ((chunkEnd - cursor) * wordWeight[wi]) / wordTotal;
        const wEnd = wi === chunk.length - 1 ? chunkEnd : wCursor + wDur;
        const text = chunk
          .map((w, j) =>
            j === wi
              ? sticker
                ? `{\\1c${STICKER_TEXT_ASS}\\3c${STICKER_HIGHLIGHT_ASS}\\bord${STICKER_BORDER}}${escapeAssText(w)}{\\1c${base}&\\3c&H00000000&\\bord2}`
                : `{\\1c${accent}}${escapeAssText(w)}{\\1c${base}}`
              : escapeAssText(w)
          )
          .join(" ");
        events.push(
          `Dialogue: 0,${formatAssTime(wCursor)},${formatAssTime(wEnd)},Default,,0,0,0,,${text}`
        );
        wCursor = wEnd;
      });
      cursor = chunkEnd;
    });
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,2,0,2,90,150,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    [...events, ...(opts?.extraEvents ?? [])].filter(Boolean).join("\n"),
    "",
  ].join("\n");
}

/**
 * Split text into word-boundary chunks of at most maxChars.
 * Keeps captions short and mobile-safe.
 */
export function wrapWords(text: string, maxChars = 40): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      chunks.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
