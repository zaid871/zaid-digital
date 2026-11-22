/**
 * Ebook generator — topic in, sellable ebook out.
 *
 * Flow: outline (one LLM call, JSON) -> chapter bodies (one LLM call per
 * chapter, over the same free text providers as video scripts) ->
 * compliance scan per chapter (price/banned-claim patterns; one
 * regeneration attempt, then a typed failure — never silent) -> styled
 * HTML (always) + real PDF via scripts/pdf_bridge.py (fpdf2) when the
 * engine is present -> manifest + zip via ./package.
 *
 * Text generation is injectable for tests; the default rides
 * attemptWithFallback("script", ...) in router preference order.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import * as gemini from "@/lib/providers/gemini";
import * as groq from "@/lib/providers/groq";
import * as hfInference from "@/lib/providers/hf-inference";
import * as pollinations from "@/lib/providers/pollinations";
import type { ProviderResult } from "@/lib/providers/types";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { angleShiftLine, type AngleShift } from "./prompts";

const execFileAsync = promisify(execFile);

export type TextGen = (prompt: string, maxTokens: number) => Promise<string>;

export class DigitalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Default text generation: direct ordered failover over the free TEXT
 * providers (groq -> gemini -> pollinations -> hf), mirroring the script
 * chain's preference order. Deliberately NOT routed through
 * providers/fallback.ts: that graph pulls the voice providers (edge-tts)
 * into Next.js App Route bundles, which Turbopack cannot load — and a
 * text chain has no business depending on voice modules anyway.
 */
export const defaultTextGen: TextGen = async (prompt, maxTokens) => {
  const attempts: [string, () => Promise<ProviderResult<string>>][] = [
    ["groq", () => groq.generateText({ prompt, maxTokens, temperature: 0.7 })],
    ["gemini", () => gemini.generateText({ prompt, maxTokens, temperature: 0.7 })],
    ["pollinations", () => pollinations.generateText({ prompt, maxTokens, temperature: 0.7 })],
    [
      "hf",
      () => hfInference.generateText({ prompt, params: { max_new_tokens: maxTokens, temperature: 0.7 } }),
    ],
  ];
  const tried: string[] = [];
  let lastError = "";
  for (const [key, call] of attempts) {
    tried.push(key);
    try {
      const res = await call();
      if (!res.ok) {
        lastError = res.error?.message ?? "provider error";
        continue;
      }
      if (typeof res.data === "string" && res.data.trim().length > 0) return res.data;
      lastError = "empty response";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new DigitalError(
    "provider_unavailable",
    `Text generation failed after trying: ${tried.join(", ")}. Last error: ${lastError}`
  );
};

export type EbookWritingStyle = "standard" | "kadnar" | "saqlain";

export interface EbookRequest {
  topic: string;
  title?: string;
  audience?: string;
  language?: "hinglish" | "english";
  chapters?: number;
  wordsPerChapter?: number;
  authorName?: string;
  /**
   * Writing style for the whole book (default "standard" — plain
   * practical teaching). "kadnar" = practical explainer in Vaibhav
   * Kadnar's style (mirror-hook, numbered ideas, one vivid analogy
   * per idea, a step to do today). "saqlain" = documentary narrative
   * in Saqlain Khan's style (riddle-hook, lived second-person
   * narrative, reveal, history, evidence, solution). See
   * docs/ebook-writing-styles.md.
   */
  writingStyle?: EbookWritingStyle;
  /**
   * Angle Shift (Utkarsh Gose) — how this book stands out from
   * competitors: narrow_audience | language_examples | format_change.
   * Unset = unchanged behaviour. See docs/winning-product-validation.md.
   */
  angle?: AngleShift;
}

export interface EbookChapter {
  heading: string;
  paragraphs: string[];
}

export interface EbookResult {
  title: string;
  subtitle: string;
  slug: string;
  dir: string;
  chapters: EbookChapter[];
  wordCount: number;
  files: { html: string; pdf: string | null; manifest: string; zip: string | null };
  pdfPages: number | null;
  warnings: string[];
}

const COMPLIANCE_RULES_TEXT = [
  "STRICT RULES (Shariah-compliant, honest content):",
  "- NEVER state any price, discount, or offer.",
  "- NEVER promise income, earnings, guaranteed results, or success.",
  "- NEVER invent statistics, studies, reviews, testimonials, or facts you are unsure of; keep advice general and practical.",
  "- No health or financial guarantees. Where unsure, say the reader should verify or consult an expert.",
].join("\n");

function languageText(language: "hinglish" | "english"): string {
  return language === "english"
    ? "Write in simple, clear English."
    : "Write in Roman-script Hinglish (Hindi in Latin letters, the way people type it daily). Do NOT use Devanagari script.";
}

/**
 * Writing-style instructions (transferred from two YouTube creators —
 * see docs/ebook-writing-styles.md). The style is structural, not
 * language-bound: it works in English and in Hinglish alike.
 *
 * Honest adaptations, not copies:
 * - Kadnar's "personal lessons I implemented" becomes lessons and
 *   takeaways as principles — the model must NOT invent personal
 *   stories, life events, or "I did this" claims.
 * - Saqlain's documentary relies on cited sources, which this system
 *   does not have — so the style carries a hard guardrail: never
 *   invent statistics, dates, quotes, or historical details.
 */
export function writingStyleNotes(style: EbookWritingStyle): { outline: string; chapter: string } {
  if (style === "kadnar") {
    return {
      outline:
        "WRITING STYLE — practical explainer: shape the chapters into three parts in order: (1) big ideas that change how the reader thinks, (2) practical steps the reader can start today, (3) lessons and takeaways to keep. Headings name the idea or step, honestly, no clickbait.",
      chapter:
        "WRITING STYLE — practical explainer: open the chapter by mirroring the reader's own struggle with a direct second-person question, then reframe the problem (it is the system or method, not motivation). Teach ONE idea, explained with ONE vivid everyday analogy, and end with a concrete step the reader can do today. Short sentences, direct 'you' address, energetic but honest. Do NOT invent personal stories, life events, or 'I did this' claims — keep examples general and verifiable.",
    };
  }
  if (style === "saqlain") {
    return {
      outline:
        "WRITING STYLE — documentary narrative: shape the chapters into a documentary arc in order: (1) a hook chapter that poses a striking question or riddle, (2) a chapter that walks the reader through the lived experience of the problem in second person, (3) a reveal chapter — what is really going on beneath the surface, (4) a history chapter — how this came to be, (5) a chapter on what the numbers and evidence show, (6) a solution chapter — what the reader can do now. With fewer chapters, merge neighbouring parts in order; never shuffle the arc.",
      chapter:
        "WRITING STYLE — documentary narrative: write cinematically in second person — open with a striking question or fact, build the scene, then reveal the hidden mechanism behind it, and end with what it means for the reader. Only use facts you are confident about. NEVER invent statistics, dates, quotes, names, or historical details — if unsure, describe the pattern in general terms or leave it out.",
    };
  }
  return { outline: "", chapter: "" };
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

interface Outline {
  title: string;
  subtitle: string;
  chapters: { heading: string; brief: string }[];
}

async function buildOutline(req: EbookRequest, textGen: TextGen): Promise<Outline> {
  const count = Math.min(12, Math.max(3, req.chapters ?? 8));
  const styleNotes = writingStyleNotes(req.writingStyle ?? "standard");
  const prompt = [
    `You are writing a practical ebook on this topic: "${req.topic}".`,
    req.audience ? `Target reader: ${req.audience}.` : "",
    languageText(req.language ?? "hinglish"),
    COMPLIANCE_RULES_TEXT,
    styleNotes.outline,
    angleShiftLine(req.angle),
    "",
    `Reply with ONLY a JSON object, no other text:`,
    `{"title": "...", "subtitle": "...", "chapters": [{"heading": "...", "brief": "one line on what this chapter teaches"}]}`,
    `Exactly ${count} chapters, in a logical learning order. Title must be attractive but honest (no clickbait promises).`,
  ]
    .filter(Boolean)
    .join("\n");
  let parsed: unknown;
  try {
    parsed = extractJsonObject(await textGen(prompt, 1200));
  } catch (err) {
    throw new DigitalError(
      "outline_failed",
      `Ebook outline could not be generated: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const o = parsed as Partial<Outline>;
  const chapters = Array.isArray(o.chapters)
    ? o.chapters
        .filter((c) => c && typeof c.heading === "string" && c.heading.trim().length > 0)
        .map((c) => ({
          // Models love prefixing "1. " — the book adds its own numbering
          // (TOC + chapter order), so strip it to avoid "1. 1. Heading".
          heading: String(c.heading).trim().replace(/^\d{1,2}[.)]\s*/, ""),
          brief: String(c.brief ?? ""),
        }))
    : [];
  if (chapters.length < 3) {
    throw new DigitalError("outline_failed", `Outline returned only ${chapters.length} usable chapters (need >= 3).`);
  }
  return {
    title: (req.title ?? o.title ?? req.topic).toString().trim(),
    subtitle: (o.subtitle ?? "").toString().trim(),
    chapters: chapters.slice(0, 12),
  };
}

function complianceHit(text: string): string | null {
  const price = text.match(PRICE_PATTERN);
  if (price) return `price/offer pattern: "${price[0]}"`;
  const banned = text.match(BANNED_CLAIM_PATTERN);
  if (banned) return `banned claim pattern: "${banned[0]}"`;
  return null;
}

async function writeChapter(
  req: EbookRequest,
  outline: Outline,
  index: number,
  textGen: TextGen
): Promise<EbookChapter> {
  const ch = outline.chapters[index];
  const words = Math.min(900, Math.max(250, req.wordsPerChapter ?? 550));
  const styleNotes = writingStyleNotes(req.writingStyle ?? "standard");
  const makePrompt = (reminder: string) =>
    [
      `Write chapter ${index + 1} of the ebook "${outline.title}".`,
      `Chapter heading: "${ch.heading}". Chapter goal: ${ch.brief || "teach this part of the topic"}.`,
      `Full book topic: "${req.topic}". ${req.audience ? `Reader: ${req.audience}.` : ""}`,
      languageText(req.language ?? "hinglish"),
      COMPLIANCE_RULES_TEXT,
      styleNotes.chapter,
      angleShiftLine(req.angle),
      reminder,
      "",
      `Write about ${words} words of genuinely useful, practical content. Plain paragraphs separated by a blank line. No markdown, no heading line (the heading is added separately), no lists with symbols — flowing teaching text with concrete steps and examples woven into the paragraphs.`,
    ]
      .filter(Boolean)
      .join("\n");

  let lastHit: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await textGen(
      makePrompt(attempt > 0 ? "IMPORTANT: your previous draft broke a rule above. Rewrite fully compliant this time." : ""),
      1600
    );
    const paragraphs = raw
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 0 && !p.startsWith("#"));
    const joined = paragraphs.join("\n\n");
    lastHit = complianceHit(joined);
    if (!lastHit && paragraphs.length >= 2) {
      return { heading: ch.heading, paragraphs };
    }
    if (!lastHit) lastHit = "chapter too short (fewer than 2 paragraphs)";
  }
  throw new DigitalError(
    "compliance_rejected",
    `Chapter "${ch.heading}" failed the compliance scan after a rewrite: ${lastHit}. Ebook not generated — fix the topic or try again.`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(outline: Outline, chapters: EbookChapter[], author: string): string {
  const tocItems = chapters.map((c) => `<li>${escapeHtml(c.heading)}</li>`).join("\n      ");
  const body = chapters
    .map(
      (c) =>
        `  <section class="chapter">\n    <h2>${escapeHtml(c.heading)}</h2>\n${c.paragraphs
          .map((p) => `    <p>${escapeHtml(p)}</p>`)
          .join("\n")}\n  </section>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(outline.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 680px; margin: 0 auto; padding: 32px 20px; color: #232328; line-height: 1.65; }
  .cover { text-align: center; padding: 120px 0 80px; }
  .cover h1 { font-size: 40px; line-height: 1.2; margin: 0 0 16px; }
  .cover .subtitle { font-size: 19px; color: #5a5a64; }
  .cover .author { margin-top: 48px; font-size: 15px; color: #5a5a64; }
  .toc h2, .chapter h2 { font-size: 24px; margin: 40px 0 14px; }
  .chapter { page-break-before: always; }
  p { margin: 0 0 14px; font-size: 16.5px; }
</style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(outline.title)}</h1>
    ${outline.subtitle ? `<div class="subtitle">${escapeHtml(outline.subtitle)}</div>` : ""}
    ${author ? `<div class="author">${escapeHtml(author)}</div>` : ""}
  </div>
  <div class="toc">
    <h2>Contents</h2>
    <ol>
      ${tocItems}
    </ol>
  </div>
${body}
</body>
</html>
`;
}

interface PdfOutcome {
  pdfPath: string | null;
  pages: number | null;
  warning: string | null;
}

async function renderPdf(dir: string, outline: Outline, chapters: EbookChapter[], author: string): Promise<PdfOutcome> {
  const bridge = join(process.cwd(), "scripts", "pdf_bridge.py");
  if (!existsSync(bridge)) {
    return { pdfPath: null, pages: null, warning: "pdf_bridge_missing: scripts/pdf_bridge.py not found" };
  }
  const spec = {
    title: outline.title,
    subtitle: outline.subtitle,
    author,
    footer: outline.title,
    chapters: chapters.map((c) => ({ heading: c.heading, paragraphs: c.paragraphs })),
  };
  const specPath = join(dir, "book.spec.json");
  const pdfPath = join(dir, "book.pdf");
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf-8");
  try {
    const python = process.env.PDF_BRIDGE_PYTHON || "python3";
    const { stdout } = await execFileAsync(python, [bridge, specPath, pdfPath], { timeout: 240_000 });
    const lines = stdout.trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1]) as { pages?: number };
    if (!existsSync(pdfPath)) throw new Error("bridge reported success but no PDF file exists");
    return { pdfPath, pages: typeof parsed.pages === "number" ? parsed.pages : null, warning: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 240) : String(err);
    return {
      pdfPath: null,
      pages: null,
      warning: `pdf_engine_missing: PDF not rendered (${detail}). Deploy par 'pip install fpdf2' chahiye; HTML version tayyar hai.`,
    };
  }
}

/** Generate a complete ebook (HTML + PDF + manifest + zip) for a topic. */
export async function generateEbook(
  req: EbookRequest,
  deps?: { textGen?: TextGen; outRoot?: string }
): Promise<EbookResult> {
  const textGen = deps?.textGen ?? defaultTextGen;
  const outline = await buildOutline(req, textGen);

  const chapters: EbookChapter[] = [];
  for (let i = 0; i < outline.chapters.length; i++) {
    chapters.push(await writeChapter(req, outline, i, textGen));
  }

  const author = (req.authorName ?? "").trim();
  const slug = slugify(outline.title || req.topic);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  const htmlPath = join(dir, "book.html");
  await writeFile(htmlPath, buildHtml(outline, chapters, author), "utf-8");

  const pdf = await renderPdf(dir, outline, chapters, author);
  const warnings: string[] = [];
  if (pdf.warning) warnings.push(pdf.warning);

  const wordCount = chapters.reduce(
    (a, c) => a + c.paragraphs.join(" ").split(/\s+/).filter(Boolean).length,
    0
  );

  const manifestPath = await writeManifest(dir, {
    type: "ebook",
    title: outline.title,
    subtitle: outline.subtitle,
    topic: req.topic,
    audience: req.audience ?? null,
    language: req.language ?? "hinglish",
    writingStyle: req.writingStyle ?? "standard",
    angle: req.angle ?? null,
    author: author || null,
    chapters: chapters.map((c) => c.heading),
    wordCount,
    pdfPages: pdf.pages,
    compliance: "all chapters passed the price/banned-claim scan",
    files: { html: "book.html", pdf: pdf.pdfPath ? "book.pdf" : null, spec: "book.spec.json" },
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    title: outline.title,
    subtitle: outline.subtitle,
    slug,
    dir,
    chapters,
    wordCount,
    files: { html: htmlPath, pdf: pdf.pdfPath, manifest: manifestPath, zip: zipPath },
    pdfPages: pdf.pages,
    warnings,
  };
}
