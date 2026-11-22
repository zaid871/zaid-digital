/**
 * Printable planner generator — daily / weekly A4 PDFs.
 *
 * Same pattern as the docs bridge: the TS side owns validation + the
 * compliance scan + date math + packaging, and a small Python bridge
 * (scripts/planner_bridge.py, fpdf2) owns the real PDF rendering.
 *
 * Honest limits (also in docs/digital-products.md):
 *  - Printable PDF only. Hyperlinked / fillable digital planners are
 *    NOT built here — fpdf2 has no AcroForm / link support.
 *  - Dates come from the request (startDate + count); the bridge draws
 *    the pages, it never invents content.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

const execFileAsync = promisify(execFile);

export type PlannerType = "daily" | "weekly";

export interface PlannerRequest {
  type: PlannerType;
  title: string;
  /** ISO date (YYYY-MM-DD). Defaults to today (UTC). */
  startDate?: string;
  /** Daily pages (1-31, default 7) or weeks (1-8, default 4). */
  count?: number;
  goals?: string[];
  habits?: string[];
}

export interface PlannerDay {
  date: string;
  label: string;
}

export interface PlannerResult {
  kind: "planner";
  type: PlannerType;
  title: string;
  slug: string;
  dir: string;
  file: string | null;
  count: number;
  files: { manifest: string; zip: string | null; spec: string };
  warnings: string[];
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function scanTexts(texts: string[]): void {
  for (const text of texts) {
    if (!text || !text.trim()) continue;
    const price = text.match(PRICE_PATTERN);
    if (price) {
      throw new DigitalError("compliance_rejected", `Planner failed the compliance scan: price/offer pattern: "${price[0]}".`);
    }
    const banned = text.match(BANNED_CLAIM_PATTERN);
    if (banned) {
      throw new DigitalError("compliance_rejected", `Planner failed the compliance scan: banned claim pattern: "${banned[0]}".`);
    }
  }
}

function parseStartDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) throw new DigitalError("validation_error", "startDate must be YYYY-MM-DD.");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new DigitalError("validation_error", "startDate is not a real date.");
  return d;
}

/** Build the day list: daily = count days; weekly = count*7 days (week pages of 7). */
export function buildDays(type: PlannerType, startDate: string | undefined, count: number): PlannerDay[] {
  const start = parseStartDate(startDate);
  const total = type === "weekly" ? count * 7 : count;
  const days: PlannerDay[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    days.push({
      date: d.toISOString().slice(0, 10),
      label: DAY_LABELS[d.getUTCDay()],
    });
  }
  return days;
}

export async function generatePlanner(
  req: PlannerRequest,
  deps?: { outRoot?: string }
): Promise<PlannerResult> {
  const type: PlannerType = req.type === "weekly" ? "weekly" : "daily";
  const title = cleanText(req.title, 200);
  if (title.length < 3) throw new DigitalError("validation_error", "Planner needs a title (min 3 chars).");
  const count =
    type === "weekly"
      ? Math.min(8, Math.max(1, Math.floor(req.count ?? 4)))
      : Math.min(31, Math.max(1, Math.floor(req.count ?? 7)));
  const goals = (req.goals ?? []).slice(0, 3).map((g) => cleanText(g, 100));
  const habits = (req.habits ?? []).slice(0, 5).map((h) => cleanText(h, 60));
  scanTexts([title, ...goals, ...habits]);

  const days = buildDays(type, req.startDate, count);
  const slug = slugify(title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  const spec = { title, type, days, goals, habits };
  const specPath = join(dir, "planner.spec.json");
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf-8");

  const warnings: string[] = [];
  let file: string | null = null;
  let pages = 0;
  const bridge = join(process.cwd(), "scripts", "planner_bridge.py");
  const outPath = join(dir, "planner.pdf");
  if (!existsSync(bridge)) {
    warnings.push("planner_bridge_missing: scripts/planner_bridge.py not found");
  } else {
    try {
      const python = process.env.PDF_BRIDGE_PYTHON || "python3";
      const { stdout } = await execFileAsync(python, [bridge, specPath, outPath], { timeout: 120_000 });
      const lines = stdout.trim().split("\n");
      const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
      if (!existsSync(outPath)) throw new Error("bridge reported success but no file exists");
      pages = typeof parsed.pages === "number" ? parsed.pages : days.length;
      file = outPath;
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 240) : String(err);
      warnings.push(
        `planner_engine_missing: PDF not rendered (${detail}). Deploy par 'pip install fpdf2' chahiye; spec + manifest tayyar hain.`
      );
    }
  }

  const manifestPath = await writeManifest(dir, {
    type: "planner",
    plannerType: type,
    title,
    days: days.map((d) => d.date),
    pages,
    compliance: "all supplied text passed the price/banned-claim scan",
    files: { document: file ? file.split("/").pop() : null, spec: "planner.spec.json" },
    deliveryNotes: [
      "Printable A4 PDF — print karke istemal karein.",
      "Hyperlinks / fillable fields nahi hain (printable planner hai, digital planner nahi).",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    kind: "planner",
    type,
    title,
    slug,
    dir,
    file,
    count: pages,
    files: { manifest: manifestPath, zip: zipPath, spec: specPath },
    warnings,
  };
}
