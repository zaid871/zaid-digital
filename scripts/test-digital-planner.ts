/**
 * Digital planner tests: daily / weekly A4 PDFs via scripts/planner_bridge.py
 * (fpdf2), reopened with pypdf to prove real pages + dates.
 * Run: npx tsx scripts/test-digital-planner.ts
 */
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { DigitalError } from "../src/lib/digital/ebook";
import { buildDays, generatePlanner } from "../src/lib/digital/planner";

const execFileAsync = promisify(execFile);

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

const OUT = "/tmp/digital-planner-test";

async function pdfPages(file: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "python3",
    ["-c", "from pypdf import PdfReader; import sys; print(len(PdfReader(sys.argv[1]).pages))", file],
    { timeout: 60_000 }
  );
  return Number(stdout.trim());
}

async function main() {
  // buildDays: dates increment by 1, labels are real weekdays.
  const days = buildDays("daily", "2026-11-09", 3);
  check("buildDays returns 3 days", days.length === 3);
  check("buildDays dates increment", days[0].date === "2026-11-09" && days[1].date === "2026-11-10" && days[2].date === "2026-11-11");
  check("buildDays labels are weekdays", days.every((d) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].includes(d.label)));
  const weekDays = buildDays("weekly", "2026-11-09", 2);
  check("weekly buildDays returns 14 days", weekDays.length === 14);

  // Daily planner: 3 pages, real PDF.
  const r = await generatePlanner(
    { type: "daily", title: "Ramadan Daily Planner", startDate: "2026-11-09", count: 3, goals: ["Read 10 pages", "Walk 30 min"], habits: ["Exercise", "Reading"] },
    { outRoot: OUT }
  );
  check("daily planner file exists", !!r.file && existsSync(r.file));
  check("daily planner is a PDF", !!r.file && readFileSync(r.file).subarray(0, 4).toString() === "%PDF");
  check("daily planner has 3 pages", !!r.file && (await pdfPages(r.file)) === 3);
  check("daily planner count is 3", r.count === 3);
  check("daily planner zip exists", !!r.files.zip && existsSync(r.files.zip));

  // Weekly planner: 2 weeks = 2 pages.
  const w = await generatePlanner(
    { type: "weekly", title: "Study Week Planner", startDate: "2026-11-09", count: 2 },
    { outRoot: OUT }
  );
  check("weekly planner file exists", !!w.file && existsSync(w.file));
  check("weekly planner has 2 pages", !!w.file && (await pdfPages(w.file)) === 2);

  // Compliance: price in title is rejected.
  try {
    await generatePlanner({ type: "daily", title: "Planner only $5 today" }, { outRoot: OUT });
    check("price title -> DigitalError compliance_rejected", false);
  } catch (err) {
    check("price title -> DigitalError compliance_rejected", err instanceof DigitalError && err.code === "compliance_rejected");
  }

  // Validation: title too short.
  try {
    await generatePlanner({ type: "daily", title: "ab" }, { outRoot: OUT });
    check("short title -> DigitalError validation_error", false);
  } catch (err) {
    check("short title -> DigitalError validation_error", err instanceof DigitalError && err.code === "validation_error");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("SOME DIGITAL-PLANNER TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL DIGITAL-PLANNER TESTS PASSED");
}

main();
