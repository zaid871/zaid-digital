/**
 * test-digital-stamping: PDF buyer-stamping (piracy deterrent).
 *
 * Stamps the real sample ebook PDF, then verifies:
 *  - output exists, page count unchanged
 *  - buyer email text is extractable from a stamped page
 *  - invalid email / missing file -> typed DigitalError
 *
 * Run: npx tsx scripts/test-digital-stamping.ts
 */
import { stat, unlink } from "fs/promises";
import { join } from "path";
import { stampPdfForBuyer } from "../src/lib/digital/stamping";
import { DigitalError } from "../src/lib/digital/ebook";

const SAMPLE = join(
  process.env.HOME ?? "/home/hatch",
  "workspace/digital-samples/ghar-par-asaan-sehatmand-nashta-simple-steps-for-a-balanced--mvkwvnsz/book.pdf"
);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

async function main() {
  try { await stat(SAMPLE); }
  catch { console.log("SKIP: sample PDF not found"); process.exit(0); }

  const out = "/tmp/stamped-test.pdf";
  const res = await stampPdfForBuyer(SAMPLE, "Buyer@Example.com", out);
  ok("stamp returns pages > 0", res.pages > 0, JSON.stringify(res));
  ok("email lowercased", res.buyerEmail === "buyer@example.com");
  const st = await stat(out);
  ok("stamped file exists", st.size > 0);

  // page count unchanged + email extractable (verified via python pypdf)
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const verifyCode = `
from pypdf import PdfReader
a = PdfReader(${JSON.stringify(SAMPLE)})
b = PdfReader(${JSON.stringify(out)})
t = (b.pages[0].extract_text() or "").lower()
import json
print(json.dumps({"before": len(a.pages), "after": len(b.pages), "hasEmail": "buyer@example.com" in t}))
`;
  const { stdout } = await execFileAsync("python3", ["-c", verifyCode]);
  const v = JSON.parse(stdout.trim()) as { before: number; after: number; hasEmail: boolean };
  ok("page count unchanged", v.before === v.after && v.after > 0, JSON.stringify(v));
  ok("buyer email in page text", v.hasEmail);

  // invalid email -> validation_error
  try { await stampPdfForBuyer(SAMPLE, "not-an-email", "/tmp/x.pdf"); ok("invalid email rejected", false); }
  catch (e) { ok("invalid email rejected", e instanceof DigitalError && e.code === "validation_error"); }

  // missing file -> validation_error
  try { await stampPdfForBuyer("/tmp/does-not-exist.pdf", "a@b.co", "/tmp/x.pdf"); ok("missing file rejected", false); }
  catch (e) { ok("missing file rejected", e instanceof DigitalError && e.code === "validation_error"); }

  await unlink(out).catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
