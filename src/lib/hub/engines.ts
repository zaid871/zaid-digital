/**
 * Hub engine lanes — already-built engines, reused unchanged (spec §3).
 *
 * Text/code lanes live in ensemble.ts / pipeline.ts. This file only
 * dispatches the engine kinds to the existing builders:
 * - image → Pollinations (FLUX) — real PNG bytes, saved under storage/hub.
 * - ebook-pdf → src/lib/digital/ebook.ts (HTML + real A5 PDF).
 * - template-pack → src/lib/digital/templates.ts (SVG + PNG + zip).
 * - docx/pptx/epub/xlsx → src/lib/digital/docs.ts (real files via the
 *   Python bridge; a missing engine is a typed warning, never a fake).
 * - video → creative package (ensemble script + Pollinations keyframe +
 *   video-pool endpoint order + ready-to-POST job payload). Rendering
 *   itself stays in the existing video job pipeline
 *   (POST /api/v1/jobs) — the hub never claims a video it did not render.
 * - pdf-report → not built (typed error, use ebook-pdf or docx).
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { generateImage } from "../providers/pollinations";
import { buildVideoPool } from "../providers/video-pool";
import { generateEbook } from "../digital/ebook";
import { generateTemplatePack } from "../digital/templates";
import { generateDocx, generateEpub, generatePptx, generateSpreadsheet } from "../digital/docs";
import { wantsGif } from "../pipeline/gif";
import { hubDir } from "./quota";
import { HubError, type DeliverFormat } from "./types";

export interface EngineResult {
  kind: DeliverFormat | "video-package";
  text?: string;
  files: string[];
  data: Record<string, unknown>;
}

function reqString(payload: Record<string, unknown> | undefined, key: string): string {
  const v = payload?.[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new HubError("validation_error", `Engine lane needs payload.${key} (non-empty string).`);
  }
  return v.trim();
}

function optString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = payload?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function optInt(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = payload?.[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

export async function runImage(prompt: string, runId: string): Promise<EngineResult> {
  const res = await generateImage({ prompt, width: 1080, height: 1920 });
  if (!res.ok) {
    throw new HubError(res.error.code === "not_configured" ? "not_configured" : "engine_failed", `Image engine failed: ${res.error.message}`);
  }
  const dir = join(hubDir(), runId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "image.png");
  await writeFile(file, res.data);
  return { kind: "image", files: [file], data: { provider: "pollinations", model: res.model ?? "flux", bytes: res.data.length } };
}

export async function runEbook(payload: Record<string, unknown> | undefined): Promise<EngineResult> {
  const topic = reqString(payload, "topic");
  const result = await generateEbook({
    topic,
    title: optString(payload, "title"),
    audience: optString(payload, "audience"),
    language: (optString(payload, "language") as "hinglish" | "english" | undefined) ?? "hinglish",
    chapters: optInt(payload, "chapters"),
    wordsPerChapter: optInt(payload, "wordsPerChapter"),
    authorName: optString(payload, "authorName"),
  });
  const files = [result.files.html, result.files.manifest, result.files.pdf, result.files.zip].filter(
    (f): f is string => typeof f === "string" && f.length > 0
  );
  return {
    kind: "ebook-pdf",
    files,
    data: { title: result.title, slug: result.slug, chapters: result.chapters.length, wordCount: result.wordCount, pdfPages: result.pdfPages, warnings: result.warnings },
  };
}

export async function runTemplatePack(payload: Record<string, unknown> | undefined): Promise<EngineResult> {
  const niche = reqString(payload, "niche");
  const theme = optString(payload, "theme");
  const result = await generateTemplatePack({
    niche,
    count: optInt(payload, "count"),
    size: (optString(payload, "size") as "portrait" | "square" | "story" | undefined) ?? "portrait",
    theme: theme === "light" || theme === "sand" || theme === "forest" || theme === "wine" ? theme : "dark",
    brandColor: optString(payload, "brandColor"),
    packName: optString(payload, "packName"),
    handle: optString(payload, "handle"),
    useAiCopy: false,
  });
  const files = [result.files.manifest, result.files.previewHtml, result.files.zip].filter(
    (f): f is string => typeof f === "string" && f.length > 0
  );
  return {
    kind: "template-pack",
    files,
    data: { packName: result.packName, slug: result.slug, designs: result.designs.length, warnings: result.warnings },
  };
}

export async function runDocument(
  format: "docx" | "pptx" | "epub" | "xlsx",
  payload: Record<string, unknown> | undefined
): Promise<EngineResult> {
  const title = reqString(payload, "title");
  if (format === "docx") {
    const sections = payload?.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new HubError("validation_error", "DOCX needs payload.sections (array, min 1).");
    }
    const result = await generateDocx({
      title,
      subtitle: optString(payload, "subtitle"),
      author: optString(payload, "author"),
      sections: sections as never,
    });
    return { kind: "docx", files: [result.file, result.files.manifest, result.files.zip].filter((f): f is string => typeof f === "string" && f.length > 0), data: { slug: result.slug, count: result.count, warnings: result.warnings } };
  }
  if (format === "pptx") {
    const slides = payload?.slides;
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new HubError("validation_error", "PPTX needs payload.slides (array, min 1).");
    }
    const result = await generatePptx({ title, subtitle: optString(payload, "subtitle"), slides: slides as never });
    return { kind: "pptx", files: [result.file, result.files.manifest, result.files.zip].filter((f): f is string => typeof f === "string" && f.length > 0), data: { slug: result.slug, count: result.count, warnings: result.warnings } };
  }
  if (format === "epub") {
    const chapters = payload?.chapters;
    if (!Array.isArray(chapters) || chapters.length === 0) {
      throw new HubError("validation_error", "EPUB needs payload.chapters (array, min 1).");
    }
    const result = await generateEpub({
      title,
      author: optString(payload, "author"),
      language: optString(payload, "language"),
      chapters: chapters as never,
    });
    return { kind: "epub", files: [result.file, result.files.manifest, result.files.zip].filter((f): f is string => typeof f === "string" && f.length > 0), data: { slug: result.slug, count: result.count, warnings: result.warnings } };
  }
  const sheets = payload?.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new HubError("validation_error", "XLSX needs payload.sheets (array, min 1).");
  }
  const result = await generateSpreadsheet({ title, sheets: sheets as never });
  return { kind: "xlsx", files: [result.file, result.files.manifest, result.files.zip].filter((f): f is string => typeof f === "string" && f.length > 0), data: { slug: result.slug, count: result.count, warnings: result.warnings } };
}

/**
 * Video creative package: ensemble script + Pollinations keyframe +
 * video-pool endpoint order + the exact JSON body for POST /api/v1/jobs.
 * Nothing here claims a rendered video — verification.video is
 * "planned" until the job pipeline renders it.
 */
export async function runVideoPackage(
  prompt: string,
  runId: string,
  scriptText: string,
  payload: Record<string, unknown> | undefined,
  keyframeFiles?: string[]
): Promise<EngineResult> {
  // The caller (runHub) already generated the keyframe in parallel with
  // the script fan-out; only generate one here if none was supplied.
  const keyframeFilesResolved =
    keyframeFiles && keyframeFiles.length > 0
      ? keyframeFiles
      : (await runImage(`Cinematic 9:16 vertical product key frame, dark premium style: ${prompt}`.slice(0, 1000), runId)).files;
  const pool = buildVideoPool().map((e) => ({ kind: e.kind, label: e.label }));
  const productUrl = optString(payload, "productUrl");
  // Opt-in GIF preview: only when the prompt explicitly says so
  // ("gif banao", "make a gif"). Default is OFF — no GIF otherwise.
  const gifRequested = wantsGif(prompt);
  const jobPayload: Record<string, unknown> = {
    productUrl: productUrl ?? null,
    script: scriptText,
    keyframe: keyframeFilesResolved[0] ?? null,
    ...(gifRequested ? { gif: true } : {}),
    note: productUrl ? "POST this body to /api/v1/jobs to render." : "Set productUrl, then POST this body to /api/v1/jobs to render.",
  };
  return {
    kind: "video-package",
    text: scriptText,
    files: keyframeFilesResolved,
    data: { pool, jobPayload, jobPayloadReady: Boolean(productUrl), scriptChars: scriptText.length, gifRequested },
  };
}
