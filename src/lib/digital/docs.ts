/**
 * Office / ebook / spreadsheet documents — DOCX, PPTX, EPUB, XLSX.
 *
 * Same pattern as the ebook PDF bridge (scripts/pdf_bridge.py): the TS
 * side owns validation + the Shariah-compliance scan + packaging, and a
 * small Python bridge (scripts/docs_bridge.py) owns the real file
 * rendering (python-docx / python-pptx / EbookLib / openpyxl — all pure
 * Python, no system libs). A missing engine is a typed warning, never a
 * fake file: the caller still gets the JSON spec + manifest, and the
 * missing file is reported as null.
 *
 * Content is supplied as structured data (headings / paragraphs /
 * bullets / rows) — by the caller, by the ebook lane, or by the hub.
 * The bridge renders it faithfully; it never invents content.
 *
 * Honest limits (also in docs/digital-products.md):
 *  - Interactive PDF forms are NOT built here — fpdf2 has no AcroForm
 *    support. This module covers office/ebook/spreadsheet files only.
 *  - PPTX is a clean 16:9 title + bullet deck, not a designed slide
 *    system; EPUB is a reflowable book, not a fixed-layout one.
 *  - XLSX numbers stay numeric (sums keep working); only text cells
 *    are compliance-scanned — a numeric cell is data, not a claim.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError, type EbookChapter } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

const execFileAsync = promisify(execFile);

export interface DocSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface DocxRequest {
  title: string;
  subtitle?: string;
  author?: string;
  sections: DocSection[];
}

export interface PptxSlide {
  title: string;
  bullets?: string[];
  notes?: string;
}

export interface PptxRequest {
  title: string;
  subtitle?: string;
  slides: PptxSlide[];
}

export interface EpubChapter {
  heading: string;
  paragraphs: string[];
}

export interface EpubRequest {
  title: string;
  author?: string;
  language?: string;
  chapters: EpubChapter[];
}

export interface XlsxSheet {
  name: string;
  headers?: string[];
  rows?: (string | number | boolean | null)[][];
}

export interface XlsxRequest {
  title: string;
  sheets: XlsxSheet[];
}

export interface DocsResult {
  kind: "docx" | "pptx" | "epub" | "xlsx";
  title: string;
  slug: string;
  dir: string;
  file: string | null;
  count: number;
  files: { manifest: string; zip: string | null; spec: string };
  warnings: string[];
}

function complianceHit(text: string): string | null {
  const price = text.match(PRICE_PATTERN);
  if (price) return `price/offer pattern: "${price[0]}"`;
  const banned = text.match(BANNED_CLAIM_PATTERN);
  if (banned) return `banned claim pattern: "${banned[0]}"`;
  return null;
}

/** Scan supplied text; one hit fails the whole request (no partial docs). */
function scanTexts(texts: string[]): void {
  for (const text of texts) {
    if (!text || !text.trim()) continue;
    const hit = complianceHit(text);
    if (hit) {
      throw new DigitalError(
        "compliance_rejected",
        `Document failed the compliance scan: ${hit}. Fix the text and try again.`
      );
    }
  }
}

function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanSections(sections: DocSection[]): DocSection[] {
  return sections.slice(0, 30).map((s) => ({
    heading: cleanText(s.heading, 200),
    paragraphs: (s.paragraphs ?? []).slice(0, 40).map((p) => cleanText(p, 4000)),
    bullets: (s.bullets ?? []).slice(0, 12).map((b) => cleanText(b, 500)),
  }));
}

interface BridgeOutcome {
  file: string | null;
  count: number;
  warning: string | null;
}

async function runBridge(
  kind: "docx" | "pptx" | "epub" | "xlsx",
  spec: Record<string, unknown>,
  dir: string,
  outFile: string
): Promise<BridgeOutcome> {
  const bridge = join(process.cwd(), "scripts", "docs_bridge.py");
  if (!existsSync(bridge)) {
    return { file: null, count: 0, warning: "docs_bridge_missing: scripts/docs_bridge.py not found" };
  }
  const specPath = join(dir, `${kind}.spec.json`);
  const outPath = join(dir, outFile);
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf-8");
  try {
    const python = process.env.DOCS_BRIDGE_PYTHON || process.env.PDF_BRIDGE_PYTHON || "python3";
    const { stdout } = await execFileAsync(python, [bridge, kind, specPath, outPath], { timeout: 120_000 });
    const lines = stdout.trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    if (!existsSync(outPath)) throw new Error("bridge reported success but no file exists");
    const count =
      typeof parsed.sections === "number"
        ? parsed.sections
        : typeof parsed.slides === "number"
          ? parsed.slides
          : typeof parsed.chapters === "number"
            ? parsed.chapters
            : typeof parsed.rows === "number"
              ? parsed.rows
              : 0;
    return { file: outPath, count, warning: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 240) : String(err);
    return {
      file: null,
      count: 0,
      warning: `docs_engine_missing: ${kind.toUpperCase()} not rendered (${detail}). Deploy par 'pip install python-docx python-pptx EbookLib openpyxl' chahiye; spec + manifest tayyar hain.`,
    };
  }
}

async function finish(
  kind: DocsResult["kind"],
  title: string,
  dir: string,
  outcome: BridgeOutcome,
  manifestData: Record<string, unknown>
): Promise<DocsResult> {
  const warnings: string[] = [];
  if (outcome.warning) warnings.push(outcome.warning);
  const manifestPath = await writeManifest(dir, {
    ...manifestData,
    type: kind,
    title,
    compliance: "all supplied text passed the price/banned-claim scan",
    files: { document: outcome.file ? outcome.file.split("/").pop() : null, spec: `${kind}.spec.json` },
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");
  return {
    kind,
    title,
    slug: slugify(title),
    dir,
    file: outcome.file,
    count: outcome.count,
    files: { manifest: manifestPath, zip: zipPath, spec: join(dir, `${kind}.spec.json`) },
    warnings,
  };
}

/** Generate a .docx document (title + sections) from structured content. */
export async function generateDocx(
  req: DocxRequest,
  deps?: { outRoot?: string }
): Promise<DocsResult> {
  if (!req.title?.trim()) throw new DigitalError("validation_error", "DOCX needs a title.");
  if (!Array.isArray(req.sections) || req.sections.length < 1) {
    throw new DigitalError("validation_error", "DOCX needs at least 1 section.");
  }
  const sections = cleanSections(req.sections);
  scanTexts([
    req.title,
    req.subtitle ?? "",
    req.author ?? "",
    ...sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])]),
  ]);
  const slug = slugify(req.title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });
  const outcome = await runBridge(
    "docx",
    { title: req.title.trim(), subtitle: req.subtitle ?? "", author: req.author ?? "", sections },
    dir,
    "document.docx"
  );
  return finish("docx", req.title.trim(), dir, outcome, {
    sections: sections.map((s) => s.heading),
  });
}

/** Generate a 16:9 .pptx deck (title slide + bullet slides). */
export async function generatePptx(
  req: PptxRequest,
  deps?: { outRoot?: string }
): Promise<DocsResult> {
  if (!req.title?.trim()) throw new DigitalError("validation_error", "PPTX needs a title.");
  if (!Array.isArray(req.slides) || req.slides.length < 1) {
    throw new DigitalError("validation_error", "PPTX needs at least 1 slide.");
  }
  const slides = req.slides.slice(0, 40).map((s) => ({
    title: cleanText(s.title, 200),
    bullets: (s.bullets ?? []).slice(0, 8).map((b) => cleanText(b, 500)),
    notes: cleanText(s.notes ?? "", 1000),
  }));
  scanTexts([req.title, req.subtitle ?? "", ...slides.flatMap((s) => [s.title, ...s.bullets, s.notes])]);
  const slug = slugify(req.title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });
  const outcome = await runBridge(
    "pptx",
    { title: req.title.trim(), subtitle: req.subtitle ?? "", slides },
    dir,
    "deck.pptx"
  );
  return finish("pptx", req.title.trim(), dir, outcome, {
    slides: slides.map((s) => s.title),
  });
}

/** Generate a reflowable .epub ebook from chapters. */
export async function generateEpub(
  req: EpubRequest,
  deps?: { outRoot?: string }
): Promise<DocsResult> {
  if (!req.title?.trim()) throw new DigitalError("validation_error", "EPUB needs a title.");
  if (!Array.isArray(req.chapters) || req.chapters.length < 1) {
    throw new DigitalError("validation_error", "EPUB needs at least 1 chapter.");
  }
  const chapters = req.chapters.slice(0, 30).map((c) => ({
    heading: cleanText(c.heading, 200),
    paragraphs: (c.paragraphs ?? []).slice(0, 40).map((p) => cleanText(p, 4000)),
  }));
  scanTexts([
    req.title,
    req.author ?? "",
    ...chapters.flatMap((c) => [c.heading, ...c.paragraphs]),
  ]);
  const slug = slugify(req.title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });
  const outcome = await runBridge(
    "epub",
    { title: req.title.trim(), author: req.author ?? "", language: req.language ?? "en", chapters },
    dir,
    "book.epub"
  );
  return finish("epub", req.title.trim(), dir, outcome, {
    chapters: chapters.map((c) => c.heading),
  });
}

/** Generate a .xlsx workbook (titled sheets, bold headers, frozen panes). */
export async function generateSpreadsheet(
  req: XlsxRequest,
  deps?: { outRoot?: string }
): Promise<DocsResult> {
  if (!req.title?.trim()) throw new DigitalError("validation_error", "Spreadsheet needs a title.");
  if (!Array.isArray(req.sheets) || req.sheets.length < 1 || req.sheets.length > 10) {
    throw new DigitalError("validation_error", "Spreadsheet needs 1-10 sheets.");
  }
  const sheets = req.sheets.map((sh) => ({
    name: cleanText(sh.name, 31) || "Sheet",
    headers: (sh.headers ?? []).slice(0, 20).map((h) => cleanText(String(h), 200)),
    rows: (sh.rows ?? []).slice(0, 500).map((row) =>
      row.slice(0, 20).map((v) =>
        typeof v === "number" || typeof v === "boolean" || v === null ? v : cleanText(String(v), 1000)
      )
    ),
  }));
  // Only text is scanned: a numeric cell is data, not a promotional claim.
  scanTexts([
    req.title,
    ...sheets.flatMap((sh) => [
      sh.name,
      ...sh.headers,
      ...sh.rows.flatMap((row) => row.filter((v): v is string => typeof v === "string")),
    ]),
  ]);
  const slug = slugify(req.title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });
  const outcome = await runBridge("xlsx", { title: req.title.trim(), sheets }, dir, "workbook.xlsx");
  return finish("xlsx", req.title.trim(), dir, outcome, {
    sheets: sheets.map((s) => s.name),
    rows: sheets.reduce((a, s) => a + s.rows.length, 0),
  });
}

/**
 * Render already-generated ebook chapters as DOCX / EPUB without
 * re-generating text — the hub's ebook lane writes chapters once, the
 * docs lane renders them into every format from the same source.
 */
export function chaptersToSections(chapters: EbookChapter[]): DocSection[] {
  return chapters.map((c) => ({ heading: c.heading, paragraphs: c.paragraphs }));
}

export async function generateDocxFromEbook(
  title: string,
  subtitle: string,
  author: string,
  chapters: EbookChapter[],
  deps?: { outRoot?: string }
): Promise<DocsResult> {
  return generateDocx({ title, subtitle, author, sections: chaptersToSections(chapters) }, deps);
}

export async function generateEpubFromEbook(
  title: string,
  author: string,
  chapters: EbookChapter[],
  deps?: { outRoot?: string }
): Promise<DocsResult> {
  return generateEpub({ title, author, chapters }, deps);
}
