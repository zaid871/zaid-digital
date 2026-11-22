/**
 * test-pod-print-size: POD print size defaults/env + rembg probe.
 * Run: npx tsx scripts/test-pod-print-size.ts
 */
import { printSize, checkRembgAvailable } from "../src/lib/digital/pod";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

async function main() {
  delete process.env.POD_PRINT_WIDTH;
  delete process.env.POD_PRINT_HEIGHT;
  const d = printSize();
  check("default 5000x5500", d.width === 5000 && d.height === 5500, JSON.stringify(d));

  process.env.POD_PRINT_WIDTH = "4000";
  process.env.POD_PRINT_HEIGHT = "4400";
  const o = printSize();
  check("env override", o.width === 4000 && o.height === 4400, JSON.stringify(o));

  process.env.POD_PRINT_WIDTH = "100";
  process.env.POD_PRINT_HEIGHT = "99999";
  const c = printSize();
  check("clamp 1500-6000", c.width === 1500 && c.height === 6000, JSON.stringify(c));

  process.env.POD_PRINT_WIDTH = "abc";
  delete process.env.POD_PRINT_HEIGHT;
  const f = printSize();
  check("invalid falls back", f.width === 5000 && f.height === 5500, JSON.stringify(f));

  const rembg = await checkRembgAvailable();
  check("rembg probe returns boolean", typeof rembg === "boolean", String(rembg));
  console.log(`(sandbox rembg: ${rembg ? "installed" : "NOT installed — expected here; deploy check will catch it"})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
