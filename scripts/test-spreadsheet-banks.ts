/**
 * Spreadsheet-bank tests: the n8n workflow's own JS (validate-input +
 * build-bank) is executed against stubs, then the bank sheets are fed
 * through the real XLSX generator and reopened with openpyxl to prove
 * the formulas survive. Covers the new 'workout' + 'onboarding' banks.
 * Run: npx tsx scripts/test-spreadsheet-banks.ts
 */
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { generateSpreadsheet, type XlsxSheet } from "../src/lib/digital/docs";

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

const OUT = "/tmp/digital-banks-test";
const WORKFLOW = "n8n/workflows/digital-spreadsheets-generation.json";

async function pyCheck(name: string, code: string, file: string) {
  try {
    await execFileAsync("python3", ["-c", code, file], { timeout: 60_000 });
    check(name, true);
  } catch (err) {
    check(name, false, err instanceof Error ? err.message.slice(0, 200) : String(err));
  }
}

function runNode(jsCode: string, stubs: Record<string, unknown>): unknown {
  const fn = new Function("$input", "$env", "$", jsCode);
  return fn(stubs.$input, stubs.$env, stubs.$);
}

async function main() {
  const wf = JSON.parse(readFileSync(WORKFLOW, "utf-8")) as {
    nodes: { name: string; parameters: { jsCode?: string } }[];
  };
  const validateCode = wf.nodes.find((n) => n.name === "validate-input")?.parameters.jsCode ?? "";
  const bankCode = wf.nodes.find((n) => n.name === "build-bank")?.parameters.jsCode ?? "";
  check("workflow has validate-input + build-bank", validateCode.length > 0 && bankCode.length > 0);

  const secret = "test-secret";
  function validate(kind: string, title = "Test Tracker"): Record<string, unknown> {
    const out = runNode(validateCode, {
      $input: {
        first: () => ({
          json: { headers: { "x-n8n-secret": secret }, body: { title, kind } },
        }),
      },
      $env: { N8N_WEBHOOK_SECRET: secret },
      $: () => {
        throw new Error("unexpected $ call in validate-input");
      },
    }) as { json: Record<string, unknown> }[];
    return out[0].json;
  }
  function bank(validateJson: Record<string, unknown>): Record<string, unknown> {
    const out = runNode(bankCode, {
      $input: { first: () => ({ json: {} }) },
      $env: {},
      $: () => ({ first: () => ({ json: validateJson }) }),
    }) as { json: Record<string, unknown> }[];
    return out[0].json;
  }

  // validate-input accepts the new kinds, rejects unknown ones.
  {
    const w = validate("workout");
    check("validate accepts workout", w.valid === true && w.kind === "workout");
    const o = validate("onboarding");
    check("validate accepts onboarding", o.valid === true && o.kind === "onboarding");
    const bad = validate("yoga");
    check("validate rejects unknown kind", bad.valid === false);
    const b = validate("budget");
    check("validate still accepts budget", b.valid === true && b.kind === "budget");
  }

  // build-bank: workout sheets + formulas.
  let workoutSheets: XlsxSheet[] = [];
  {
    const v = validate("workout", "My Workout Log");
    const out = bank(v);
    const sheets = (out.payload as { sheets: XlsxSheet[] }).sheets;
    workoutSheets = sheets;
    const log = sheets.find((s) => s.name === "Workout Log");
    check("workout bank has Workout Log sheet", log !== undefined);
    check(
      "workout headers carry Sets/Reps/Weight",
      log !== undefined &&
        (log.headers ?? []).includes("Sets") &&
        (log.headers ?? []).includes("Reps") &&
        (log.headers ?? []).includes("Weight (kg)")
    );
    const total = (log?.rows ?? []).find((r) => r[0] === "TOTAL SETS");
    check(
      "workout TOTAL row has SUM formulas",
      total !== undefined && total[2] === "=SUM(C3:C7)" && total[3] === "=SUM(D3:D7)",
      JSON.stringify(total)
    );
    const summary = sheets.find((s) => s.name === "Summary");
    check(
      "workout Summary has volume formula",
      summary !== undefined &&
        (summary.rows ?? []).some((r) => typeof r[1] === "string" && r[1].startsWith("=SUMPRODUCT")),
      JSON.stringify(summary?.rows)
    );
  }

  // build-bank: onboarding sheets.
  let onboardingSheets: XlsxSheet[] = [];
  {
    const v = validate("onboarding", "Client Onboarding");
    const out = bank(v);
    const sheets = (out.payload as { sheets: XlsxSheet[] }).sheets;
    onboardingSheets = sheets;
    const tracker = sheets.find((s) => s.name === "Onboarding Tracker");
    check("onboarding bank has tracker sheet", tracker !== undefined);
    check(
      "onboarding headers carry Stage/Status",
      tracker !== undefined && (tracker.headers ?? []).includes("Stage") && (tracker.headers ?? []).includes("Status")
    );
    const total = (tracker?.rows ?? []).find((r) => r[0] === "TOTAL CLIENTS");
    check(
      "onboarding TOTAL row counts clients",
      total !== undefined && total[1] === "=COUNTA(A3:A5)",
      JSON.stringify(total)
    );
    check(
      "onboarding bank has Checklist sheet",
      sheets.some((s) => s.name === "Checklist")
    );
  }

  // End-to-end: bank sheets -> real XLSX, formulas survive openpyxl.
  {
    const r = await generateSpreadsheet(
      { title: "My Workout Log", sheets: workoutSheets },
      { outRoot: OUT }
    );
    check("workout xlsx file exists", r.file !== null && existsSync(r.file));
    if (r.file) {
      await pyCheck(
        "workout xlsx reopens, SUM formula string intact",
        "import sys; from openpyxl import load_workbook; wb=load_workbook(sys.argv[1]); ws=wb['Workout Log']; assert ws['C8'].value=='=SUM(C3:C7)', ws['C8'].value; assert ws['C3'].value==4 and isinstance(ws['C3'].value,(int,float)); print('ok')",
        r.file
      );
    }
    const r2 = await generateSpreadsheet(
      { title: "Client Onboarding", sheets: onboardingSheets },
      { outRoot: OUT }
    );
    check("onboarding xlsx file exists", r2.file !== null && existsSync(r2.file));
    if (r2.file) {
      await pyCheck(
        "onboarding xlsx reopens, COUNTA formula intact",
        "import sys; from openpyxl import load_workbook; wb=load_workbook(sys.argv[1]); ws=wb['Onboarding Tracker']; assert ws['B6'].value=='=COUNTA(A3:A5)', ws['B6'].value; assert ws['A3'].value=='Ayesha Khan'; print('ok')",
        r2.file
      );
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL SPREADSHEET-BANK TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
