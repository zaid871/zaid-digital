/**
 * PDF buyer-stamping (piracy deterrent) — add #1 from the failure-articles
 * analysis (Nexway gap: our PDFs had zero protection).
 *
 * Flow: scripts/pdf_stamp.py renders a 1-page footer stamp with fpdf2 and
 * merges it onto every page via pypdf. Stamping happens at DELIVERY time
 * (buyer known) — not at generation time. Not yet wired into selling
 * (selling/delivery is parked); this module + tests are ready for it.
 *
 * Worker-side module (spawns python3) — do NOT import from App Routes
 * (Turbopack lesson).
 */
import { execFile } from "child_process";
import { stat } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { DigitalError } from "./ebook";

const execFileAsync = promisify(execFile);

export interface StampResult {
  pdfPath: string;
  pages: number;
  buyerEmail: string;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

/**
 * Stamp every page of `pdfPath` with a "Licensed to <buyerEmail>" footer.
 * Returns the stamped PDF path. Never throws raw errors.
 */
export async function stampPdfForBuyer(
  pdfPath: string,
  buyerEmail: string,
  outPath?: string
): Promise<StampResult> {
  const email = buyerEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new DigitalError("validation_error", "Invalid buyer email for PDF stamping.");
  }
  try {
    const s = await stat(pdfPath);
    if (!s.isFile()) throw new Error("not a file");
  } catch {
    throw new DigitalError("validation_error", "Input PDF not found for stamping.");
  }
  const out = outPath ?? pdfPath.replace(/\.pdf$/i, "") + ".stamped.pdf";
  const bridge = join(process.cwd(), "scripts", "pdf_stamp.py");
  try {
    await stat(bridge);
  } catch {
    throw new DigitalError("dependency_missing", "scripts/pdf_stamp.py not found.");
  }
  let raw: string;
  try {
    const { stdout } = await execFileAsync("python3", [bridge, pdfPath, email, out], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    raw = stdout.trim().split("\n").pop() ?? "";
  } catch (err) {
    throw new DigitalError(
      "generation_failed",
      `PDF stamping failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  let parsed: { ok: boolean; pages?: number; output?: string; error?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DigitalError("generation_failed", "PDF stamper returned unreadable output.");
  }
  if (!parsed.ok) {
    const code = /dependency/i.test(parsed.error ?? "")
      ? "dependency_missing"
      : /invalid buyer email/i.test(parsed.error ?? "")
        ? "validation_error"
        : "generation_failed";
    throw new DigitalError(code, parsed.error ?? "PDF stamping failed.");
  }
  return { pdfPath: parsed.output ?? out, pages: parsed.pages ?? 0, buyerEmail: email };
}
