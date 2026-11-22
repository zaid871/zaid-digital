/**
 * Banner-unroll tests: real ffmpeg xfade wipedown render from two
 * synthetic stills (closed = dark navy, open = orange), verified by
 * ffprobe + frame pixel checks: mid-wipe the top rows must already be
 * the open colour and the bottom rows still the closed colour; the
 * final frame must be fully open. Also covers missing-input and
 * storyboard wiring (bannerUnroll flag + open prompt).
 * Run: npx tsx scripts/test-banner-unroll.ts
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { animateBannerUnroll } from "../src/lib/providers/ffmpeg-motion";
import { buildStoryboard } from "../src/lib/pipeline/storyboard";
import type { ScriptObjectT } from "../src/lib/pipeline/schemas";

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

/** Average RGB of a 10px-high row band, via crop + scale to 1x1. (A 1px crop is invalid for yuv420p — odd heights round to 0.) */
async function rowColor(video: string, timeSec: number, y: number): Promise<[number, number, number]> {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-v", "error",
    "-ss", String(timeSec), "-i", video,
    "-frames:v", "1",
    "-vf", `crop=w=1080:h=10:x=0:y=${y},scale=1:1`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 16 * 1024 * 1024, encoding: "buffer" });
  const buf = stdout as Buffer;
  return [buf[0] ?? 0, buf[1] ?? 0, buf[2] ?? 0];
}

function isOrange(c: [number, number, number]): boolean {
  return c[0] > 180 && c[1] > 80 && c[1] < 160 && c[2] < 90;
}
function isNavy(c: [number, number, number]): boolean {
  return c[0] < 60 && c[1] < 60 && c[2] > 40 && c[2] < 110;
}

function scriptOf(n: number): ScriptObjectT {
  return {
    schemaVersion: "1.0.0",
    language: "hinglish",
    scenes: Array.from({ length: n }, (_, i) => ({
      sceneId: `s${i + 1}`,
      narration: `Scene ${i + 1} ke liye natural hinglish narration line hai ye wali, comment me LINK likho`,
      estimatedSeconds: 5,
      evidenceClaimIds: [],
      pronunciationHints: {},
    })),
    totalEstimatedSeconds: n * 5,
    callToAction: "Check product details through the link in the description or profile.",
    dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga." },
  };
}

const identity = {
  canonicalName: "Gym Freak Fitness",
  brand: "Gym Freak",
  model: null,
  category: "Fitness",
  colors: [],
  materials: [],
  distinctiveDetails: [],
  visualConsistencyNotes: "",
};

async function main() {
  const dir = "/tmp/banner-unroll-test";
  const closed = `${dir}/closed.png`;
  const open = `${dir}/open.png`;
  await execFileAsync("mkdir", ["-p", dir]);
  await solidPng(closed, "0x1a1a2e");
  await solidPng(open, "0xff6b35");

  // Real render: 5s clip, 2s wipe.
  const r = await animateBannerUnroll(closed, open, {
    durationSec: 5,
    wipeSec: 2,
    outputPath: `${dir}/unroll.mp4`,
  });
  check("banner unroll render ok", r.ok, r.ok ? "" : r.error?.message ?? "");
  if (!r.ok) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  check("output file exists", existsSync(r.data.path));
  const p = await probe(r.data.path);
  check("output is 1080x1920", p.w === 1080 && p.h === 1920, `got ${p.w}x${p.h}`);
  check("output duration ≈ 5s", Math.abs(p.d - 5) < 1.0, `got ${p.d}`);

  // Wipe direction: at t=1s (mid-wipe) the TOP must already be open
  // (orange) and the BOTTOM still closed (navy). At t=4.5s the whole
  // frame must be open.
  const topMid = await rowColor(r.data.path, 1, 200);
  const bottomMid = await rowColor(r.data.path, 1, 1700);
  check("mid-wipe top rows are the open colour", isOrange(topMid), `rgb(${topMid.join(",")})`);
  check("mid-wipe bottom rows are still closed", isNavy(bottomMid), `rgb(${bottomMid.join(",")})`);
  const topEnd = await rowColor(r.data.path, 4.5, 200);
  const bottomEnd = await rowColor(r.data.path, 4.5, 1700);
  check("end frame top is open", isOrange(topEnd), `rgb(${topEnd.join(",")})`);
  check("end frame bottom is open", isOrange(bottomEnd), `rgb(${bottomEnd.join(",")})`);

  // Missing input → typed error, never a fake render.
  const bad = await animateBannerUnroll(`${dir}/nope.png`, open, { durationSec: 3 });
  check("missing closed image fails cleanly", !bad.ok && bad.error.code === "invalid_input");

  // Storyboard wiring: banner_unroll style → 3 scenes, scene 2 flagged.
  const sb = buildStoryboard(scriptOf(3), identity, 15, null, { scriptStyle: "banner_unroll" });
  check("storyboard has 3 scenes", sb.scenes.length === 3);
  check("scene purposes are hook/unroll/cta", sb.scenes.map((s) => s.purpose).join(",") === "hook,banner_unroll,call_to_action");
  check("scene 2 carries bannerUnroll", !!sb.scenes[1].bannerUnroll);
  check("banner text is the brand name", sb.scenes[1].bannerUnroll?.bannerText === "Gym Freak");
  check("unroll visual prompt is the closed state", sb.scenes[1].visualPrompt.includes("rolled up") || sb.scenes[1].visualPrompt.includes("closed"));
  check("unroll notes forbid prices on the banner", (sb.scenes[1].motionGraphicsNotes + sb.scenes[1].complianceNotes).includes("no prices"));

  // Macro-hero storyboard wiring (same file, shared purposes path).
  const mh = buildStoryboard(scriptOf(3), identity, 15, "premium_dark", { scriptStyle: "macro_hero" });
  check("macro-hero purposes are ingredient/craft/hero", mh.scenes.map((s) => s.purpose).join(",") === "ingredient,craft,hero");
  check("ingredient prompt is macro + pack-untouched", mh.scenes[0].visualPrompt.includes("macro") && mh.scenes[0].visualPrompt.includes("do not redesign"));
  check("hero prompt is pack-untouched", mh.scenes[2].visualPrompt.includes("do not redesign"));
  check("ingredient motion is macro_zoom", mh.scenes[0].cameraMovement === "macro_zoom");
  check("macro-hero notes warn about pack artefacts", mh.scenes[0].complianceNotes.includes("AI artefacts"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL BANNER-UNROLL TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
