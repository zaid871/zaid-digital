/**
 * Comparison-scene tests: real ffmpeg split-screen wipe render from two
 * synthetic stills, verified by ffprobe. Run: npx tsx scripts/test-comparison.ts
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { animateComparison } from "../src/lib/providers/ffmpeg-motion";

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

async function solidPng(path: string, color: string) {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=${color}:size=1080x1920:duration=1:rate=30`,
    "-frames:v", "1", path,
  ]);
}

async function probe(path: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,duration",
    "-of", "default=noprint_wrappers=1", path,
  ]);
  return {
    w: Number(/width=(\d+)/.exec(stdout)?.[1]),
    h: Number(/height=(\d+)/.exec(stdout)?.[1]),
    d: Number(/duration=([\d.]+)/.exec(stdout)?.[1]),
  };
}

async function main() {
  const dir = "/tmp/comparison-test";
  const left = `${dir}/left.png`;
  const right = `${dir}/right.png`;
  await execFileAsync("mkdir", ["-p", dir]);
  await solidPng(left, "0x1a1a2e");
  await solidPng(right, "0xff6b35");

  const r = await animateComparison(left, right, {
    durationSec: 4,
    leftLabel: "Pehle",
    rightLabel: "Ab",
    outputPath: `${dir}/wipe.mp4`,
  });
  check("comparison render ok", r.ok, r.ok ? "" : r.error?.message ?? "");
  if (r.ok) {
    check("output file exists", existsSync(r.data.path));
    const p = await probe(r.data.path);
    check("output is 1080x1920", p.w === 1080 && p.h === 1920, `${p.w}x${p.h}`);
    check("duration ~4s", Math.abs(p.d - 4) < 1.0, String(p.d));
  }

  const missing = await animateComparison(left, `${dir}/nope.png`, { durationSec: 3 });
  check("missing right image -> typed error, no fake render", !missing.ok && missing.error.code === "invalid_input");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL COMPARISON TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
