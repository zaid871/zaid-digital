/**
 * Guide-improvement tests (2026-10-23): caption safe-zone margins,
 * TTS lead-in silence trim, two-pass loudnorm helpers + live ffmpeg checks.
 * Run: npx tsx scripts/test-guide-improvements.ts
 */
import { execFile } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { cuesToAss, cuesToKineticAss, probeMedia, type ParsedCue } from "../src/lib/pipeline/assets";
import {
  loudnormFilter,
  measureLoudnorm,
  parseLoudnormMeasurement,
} from "../src/lib/pipeline/loudnorm";
import { trimLeadingSilence } from "../src/lib/pipeline/voice";

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

// ---------- 1. Safe-zone margins in both ASS builders ----------
{
  const cues: ParsedCue[] = [{ start: 0, end: 2, text: "hello doston" }];
  const plain = cuesToAss(cues, { fontSize: 48, marginV: 380 });
  const kinetic = cuesToKineticAss(cues, { fontSize: 62, marginV: 400, bold: true });
  check("standard ASS keeps text inside IG safe zone (MarginL 90 / MarginR 150)", plain.includes(",90,150,380,"));
  check("kinetic ASS keeps text inside IG safe zone (MarginL 90 / MarginR 150)", kinetic.includes(",90,150,400,"));
}

// ---------- 2. Loudnorm parse + filter (pure) ----------
{
  const sample = [
    "[Parsed_loudnorm_0 @ 0x123] ",
    "{",
    '\t"input_i" : "-26.31",',
    '\t"input_tp" : "-9.20",',
    '\t"input_lra" : "4.10",',
    '\t"input_thresh" : "-37.05",',
    '\t"target_offset" : "0.42"',
    "}",
  ].join("\n");
  const m = parseLoudnormMeasurement(sample);
  check("loudnorm JSON parsed", m !== null);
  check("parsed values correct", m?.inputI === -26.31 && m?.inputTp === -9.2 && m?.targetOffset === 0.42);
  check("garbage → null (no invented measurement)", parseLoudnormMeasurement("no json here") === null);
  check("single-pass filter is the bare target", loudnormFilter(null) === "loudnorm=I=-14:TP=-1.5:LRA=11");
  const two = loudnormFilter(m);
  check(
    "two-pass filter carries measured values + linear",
    two.includes("measured_I=-26.31") && two.includes("measured_TP=-9.20") && two.includes("linear=true")
  );
}

// ---------- 3. Live ffmpeg: lead-in trim + two-pass loudnorm ----------
async function live() {
  const dir = "/tmp/guide-improvements";
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Synthetic TTS-like file: 0.8s silence, then 1.2s tone.
  const raw = join(dir, "scene.mp3");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2",
    "-filter_complex", "[0:a]atrim=0:0.8[s];[s][1:a]concat=n=2:v=0:a=1[a]",
    "-map", "[a]", raw,
  ]);
  const before = await probeMedia(raw);
  check("synthetic file ~2.0s", (before.durationSec ?? 0) > 1.8, String(before.durationSec));

  const trimmed = await trimLeadingSilence(raw);
  check("trim reports success", trimmed === true);
  const after = await probeMedia(raw);
  const dur = after.durationSec ?? 0;
  check("lead-in silence removed (now ~1.25s)", dur > 1.05 && dur < 1.5, String(dur));
  check("trim on missing file is a safe no-op", (await trimLeadingSilence(join(dir, "nope.mp3"))) === false);

  // Two-pass loudnorm end-to-end on the trimmed file.
  const measured = await measureLoudnorm(raw);
  check("live measurement parsed", measured !== null, JSON.stringify(measured));
  const out = join(dir, "norm.m4a");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-y", "-i", raw,
    "-af", loudnormFilter(measured), "-c:a", "aac", "-b:a", "128k", out,
  ]);
  check("normalized file exists", existsSync(out));
  const final = await measureLoudnorm(out);
  check(
    "two-pass result within -14 ±1.5 LUFS",
    final !== null && Math.abs(final.inputI - -14) <= 1.5,
    final ? `inputI=${final.inputI}` : "measure failed"
  );
  check(
    "two-pass result true peak ≤ -1.0 dBTP",
    final !== null && final.inputTp <= -1.0,
    final ? `inputTp=${final.inputTp}` : ""
  );
}

live()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
    console.log("ALL GUIDE-IMPROVEMENT TESTS PASSED");
  })
  .catch((err) => {
    console.error("live section crashed:", err);
    process.exit(1);
  });
