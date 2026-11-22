/**
 * Coloring-book generator — theme in, printable coloring book out.
 *
 * Flow: page subjects (one LLM call, JSON list; built-in bank fallback)
 * -> one line-art image per page (Pollinations, bold closed outlines,
 * no shading — shading/gray gets a KDP rejection) -> cover image
 * (colourful, no text — AI text misspells; the title is drawn as real
 * text by the PDF bridge) -> PDF via scripts/coloring_bridge.py
 * (8.5x11in, one design per page + a BLANK page behind each design,
 * per KDP spec) -> manifest + zip via ./package.
 *
 * KDP rules baked into the manifest (verified 2026-11-12):
 * - AI-generated images are ALLOWED but must be disclosed to KDP on publish.
 * - A coloring book is NOT a low-content book — leave that box unticked.
 * - Since 2026-09-21: max 2 new titles per format per week.
 * - Images are 1024px renders — at 8.5x11in that is ~120 DPI effective,
 *   fine for home-print PDFs, verify print quality before KDP.
 * Pages are never duplicated (KDP rejects repeated pages) and a book
 * with fewer than 24 usable pages fails honestly instead of shipping short.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { generateImage } from "../providers/pollinations";
import { DigitalError, defaultTextGen, type TextGen } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

const execFileAsync = promisify(execFile);

export interface ColoringBookRequest {
  theme: string;
  title?: string;
  /** 24–40 pages (KDP needs >= 24). Default 24. */
  pages?: number;
  authorName?: string;
}

export interface ColoringBookResult {
  title: string;
  slug: string;
  dir: string;
  subjects: string[];
  pageCount: number;
  files: { pdf: string | null; manifest: string; zip: string | null };
  pdfPages: number | null;
  warnings: string[];
}

export type ImageGen = (prompt: string, width: number, height: number) => Promise<Buffer | null>;

async function defaultImageGen(prompt: string, width: number, height: number): Promise<Buffer | null> {
  const img = await generateImage({ prompt, width, height, model: "flux" });
  if (!img.ok) return null;
  return Buffer.from(img.data);
}

/** Kid-friendly fallback subjects (animals, nature, vehicles, food). */
export const DEFAULT_COLORING_SUBJECTS: string[] = [
  "a lion sitting under a tree",
  "an elephant spraying water",
  "a peacock with a big tail",
  "a butterfly on a flower",
  "a sunflower in a garden",
  "a mango on a branch",
  "a bicycle with a basket",
  "a train crossing a bridge",
  "a rocket flying to the moon",
  "a fish swimming in the sea",
  "a turtle on a beach",
  "a monkey eating a banana",
  "a parrot on a branch",
  "a lotus flower on a pond",
  "a kite flying in the sky",
  "a drum with sticks",
  "a cupcake with a cherry",
  "a cat playing with yarn",
  "a dog with a bone",
  "a rabbit in a carrot patch",
  "a big tree with a swing",
  "a crescent moon with stars",
  "a starfish on the sand",
  "a boat sailing on waves",
];

function lineArtPrompt(subject: string): string {
  return (
    `Black and white coloring book page, clean bold closed outlines, ` +
    `no shading, no gray, no color, white background, ${subject}, ` +
    `simple large shapes for children to color, no text, no words, no letters`
  );
}

function coverPrompt(theme: string): string {
  return (
    `Colorful children's coloring book cover illustration, ${theme}, ` +
    `bright cheerful colors, cute animals and nature, no text, no words, no letters`
  );
}

async function buildSubjects(req: ColoringBookRequest, textGen: TextGen): Promise<{ subjects: string[]; usedBank: boolean }> {
  const count = Math.min(40, Math.max(24, req.pages ?? 24));
  const prompt = [
    `List ${count} simple coloring-book page subjects for children on the theme: "${req.theme}".`,
    `Reply with ONLY a JSON array of strings, one short subject per page (e.g. "a lion sitting under a tree").`,
    `Subjects must be kid-friendly, simple to draw with bold outlines, and all DIFFERENT from each other. No text, no people, no brands.`,
  ].join("\n");
  try {
    const raw = await textGen(prompt, 1200);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("no JSON array in model output");
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) throw new Error("subjects output is not an array");
    const subjects = arr
      .map((s) => String(s ?? "").trim())
      .filter((s) => s.length > 2)
      .filter((s, i, a) => a.indexOf(s) === i)
      .slice(0, count);
    if (subjects.length < count) throw new Error(`only ${subjects.length} usable subjects`);
    return { subjects, usedBank: false };
  } catch {
    // Bank fallback: cycle the 24 defaults; beyond 24, numbered
    // variations keep every subject distinct (KDP rejects repeated pages).
    const subjects = Array.from({ length: count }, (_, i) => {
      const base = DEFAULT_COLORING_SUBJECTS[i % DEFAULT_COLORING_SUBJECTS.length];
      const round = Math.floor(i / DEFAULT_COLORING_SUBJECTS.length);
      return round === 0 ? base : `${base} (variation ${round + 1})`;
    });
    return { subjects, usedBank: true };
  }
}

interface ColoringPdfOutcome {
  pdfPath: string | null;
  pages: number | null;
  warning: string | null;
}

async function renderColoringPdf(
  dir: string,
  title: string,
  author: string,
  coverFile: string | null,
  pageFiles: string[]
): Promise<ColoringPdfOutcome> {
  const bridge = join(process.cwd(), "scripts", "coloring_bridge.py");
  if (!existsSync(bridge)) {
    return { pdfPath: null, pages: null, warning: "coloring_bridge_missing: scripts/coloring_bridge.py not found" };
  }
  const spec = { title, author, coverImage: coverFile, pages: pageFiles };
  const specPath = join(dir, "coloring.spec.json");
  const pdfPath = join(dir, "coloring-book.pdf");
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
      warning: `pdf_engine_missing: PDF not rendered (${detail}). Deploy par 'pip install fpdf2' chahiye; page images tayyar hain.`,
    };
  }
}

/** Generate a complete coloring book (page PNGs + PDF + manifest + zip). */
export async function generateColoringBook(
  req: ColoringBookRequest,
  deps?: { textGen?: TextGen; imageGen?: ImageGen; outRoot?: string }
): Promise<ColoringBookResult> {
  const theme = req.theme.trim();
  if (theme.length < 3) {
    throw new DigitalError("validation_error", "Coloring book theme (min 3 chars) zaroori hai.");
  }
  const textGen = deps?.textGen ?? defaultTextGen;
  const imageGen = deps?.imageGen ?? defaultImageGen;
  const warnings: string[] = [];

  const { subjects, usedBank } = await buildSubjects(req, textGen);
  if (usedBank) warnings.push("subjects_bank_fallback: page subjects AI se nahi bane — built-in list use hui hai");

  const title = (req.title ?? `${theme} Coloring Book`).trim();
  const author = (req.authorName ?? "").trim();
  const slug = slugify(title || theme);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  // Cover image (colourful, no text in the image — title is real text in the PDF).
  let coverFile: string | null = null;
  const coverBuf = await imageGen(coverPrompt(theme), 1024, 1280);
  if (coverBuf && coverBuf.length > 0) {
    coverFile = "cover.png";
    await writeFile(join(dir, coverFile), coverBuf);
  } else {
    warnings.push("cover_image_failed: cover image nahi bani — PDF me sirf title hoga");
  }

  // One line-art image per page; one retry on failure. A page that fails
  // twice is skipped (never duplicated — KDP rejects repeated pages).
  const pageFiles: string[] = [];
  let failedPages = 0;
  for (let i = 0; i < subjects.length; i++) {
    const file = `page-${String(i + 1).padStart(2, "0")}.png`;
    let buf: Buffer | null = null;
    for (let attempt = 0; attempt < 2 && !buf; attempt++) {
      buf = await imageGen(lineArtPrompt(subjects[i]), 1024, 1280);
    }
    if (buf && buf.length > 0) {
      await writeFile(join(dir, file), buf);
      pageFiles.push(file);
    } else {
      failedPages++;
    }
  }
  if (failedPages > 0) {
    warnings.push(`image_failed: ${failedPages} page image(s) nahi bani — woh pages skip kiye gaye hain`);
  }
  if (pageFiles.length < 24) {
    throw new DigitalError(
      "generation_failed",
      `Coloring book needs >= 24 usable pages (KDP minimum); only ${pageFiles.length} images rendered. Try again — images nahi bani.`
    );
  }

  const pdf = await renderColoringPdf(dir, title, author, coverFile, pageFiles);
  if (pdf.warning) warnings.push(pdf.warning);

  const manifestPath = await writeManifest(dir, {
    type: "coloring_book",
    title,
    theme,
    author: author || null,
    pages: pageFiles.length,
    subjects,
    files: { pdf: pdf.pdfPath ? "coloring-book.pdf" : null, spec: "coloring.spec.json", images: pageFiles },
    kdp: {
      aiDisclosure: "REQUIRED: AI-generated images — KDP par publish karte waqt AI content disclose karna hota hai.",
      lowContentBox: "DO NOT tick — coloring books are NOT low-content books (KDP table).",
      weeklyLimit: "KDP limit (2026-09-21 se): max 2 new titles per format per week.",
      minPages: 24,
      trim: '8.5x11in, black-ink interior, blank page behind each design',
    },
    imageQuality:
      "Page images 1024px renders hain — 8.5x11in par ~120 DPI effective. Home-print PDF ke liye theek hai; KDP print se pehle print quality verify karo.",
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    title,
    slug,
    dir,
    subjects,
    pageCount: pageFiles.length,
    files: { pdf: pdf.pdfPath, manifest: manifestPath, zip: zipPath },
    pdfPages: pdf.pages,
    warnings,
  };
}
