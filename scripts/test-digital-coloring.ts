/**
 * Digital coloring-book tests: mocked text + image chain -> real PDF
 * via scripts/coloring_bridge.py (fpdf2), manifest, zip.
 * Run: npx tsx scripts/test-digital-coloring.ts
 */
import { existsSync, readFileSync } from "fs";
import {
  DEFAULT_COLORING_SUBJECTS,
  generateColoringBook,
  type ImageGen,
} from "../src/lib/digital/coloring";
import { DigitalError, type TextGen } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

const OUT = "/tmp/digital-coloring-test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const SUBJECTS_24 = Array.from({ length: 24 }, (_, i) => `subject number ${i + 1} animal`);

async function main() {
  // Happy path — 24 pages, real PDF (cover + design + blank back each).
  {
    const textGen: TextGen = async () => JSON.stringify(SUBJECTS_24);
    const imageGen: ImageGen = async () => tinyPng;
    const r = await generateColoringBook(
      { theme: "jungle animals", pages: 24 },
      { textGen, imageGen, outRoot: OUT }
    );
    check("24 subjects used", r.subjects.length === 24);
    check("pageCount is 24", r.pageCount === 24);
    check("page PNGs on disk", existsSync(`${r.dir}/page-01.png`) && existsSync(`${r.dir}/page-24.png`));
    check("PDF produced by the real bridge", r.files.pdf !== null && existsSync(r.files.pdf));
    if (r.files.pdf) {
      const head = readFileSync(r.files.pdf).subarray(0, 5).toString("latin1");
      check("PDF header is %PDF", head === "%PDF-");
    }
    // 1 cover + 24 designs + 24 blank backs = 49 pages.
    check("PDF pages = cover + 24 designs + 24 blanks", r.pdfPages === 49, String(r.pdfPages));
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as {
      type: string;
      kdp: { aiDisclosure: string; lowContentBox: string; weeklyLimit: string };
      imageQuality: string;
    };
    check("manifest type coloring_book", manifest.type === "coloring_book");
    check("manifest has KDP AI-disclosure note", manifest.kdp.aiDisclosure.includes("REQUIRED"));
    check("manifest says low-content box stays unticked", manifest.kdp.lowContentBox.includes("DO NOT tick"));
    check("manifest notes weekly title limit", manifest.kdp.weeklyLimit.includes("2 new titles"));
    check("manifest notes DPI limit honestly", manifest.imageQuality.includes("120 DPI"));
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Subjects bank fallback when the model returns garbage.
  {
    const textGen: TextGen = async () => "bilkul garbage, JSON nahi";
    const imageGen: ImageGen = async () => tinyPng;
    const r = await generateColoringBook(
      { theme: "jungle animals", pages: 24 },
      { textGen, imageGen, outRoot: OUT }
    );
    check(
      "bank subjects used on garbage output",
      r.subjects.length === 24 && r.subjects[0] === DEFAULT_COLORING_SUBJECTS[0]
    );
    check("bank fallback warning recorded", r.warnings.some((w) => w.includes("subjects_bank_fallback")));
  }

  // A page image that fails twice is skipped — and 23 < 24 fails honestly.
  {
    const textGen: TextGen = async () => JSON.stringify(SUBJECTS_24);
    const imageGen: ImageGen = async (prompt) => (prompt.includes("subject number 1 ") ? null : tinyPng);
    let caught: unknown = null;
    try {
      await generateColoringBook(
        { theme: "jungle animals", pages: 24 },
        { textGen, imageGen, outRoot: OUT }
      );
    } catch (err) {
      caught = err;
    }
    check(
      "23 usable pages -> DigitalError generation_failed",
      caught instanceof DigitalError && caught.code === "generation_failed",
      String(caught)
    );
  }

  // Short theme rejected.
  {
    let caught: unknown = null;
    try {
      await generateColoringBook({ theme: "ab" }, { outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "short theme -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-COLORING TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
