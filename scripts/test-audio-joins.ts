/**
 * Audio join-fade tests (2026-11-10): the Nafay 3D editor's click-free
 * join technique (their cut.py ramps 6ms at every join) ported to the
 * voice stage as applyJoinFades (15ms head/tail fades per scene).
 * Real ffmpeg throughout: tones are generated, faded, joined with the
 * same concat-demuxer call the render stage uses, and the join region
 * is measured sample by sample. WAV is used for the join measurement
 * (sample-accurate; MP3 frame granularity would blur it).
 * Run: npx tsx scripts/test-audio-joins.ts
 */
import { execFile } from "child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { probeMedia } from "../src/lib/pipeline/assets";
import { applyJoinFades, JOIN_FADE_SEC } from "../src/lib/pipeline/voice";

const execFileAsync = promisify(execFile);
const SR = 48000;

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

/** Max |sample| in a time window of a decoded mono f32le PCM file. */
async function maxAbsInWindow(wavPath: string, fromSec: number, toSec: number): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", wavPath, "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"],
    { maxBuffer: 16 * 1024 * 1024, encoding: "buffer" }
  );
  const buf = stdout as Buffer;
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const a = Math.floor(fromSec * SR);
  const b = Math.min(samples.length, Math.ceil(toSec * SR));
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(samples[i]));
  return m;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "audio-joins-"));
  try {
    check("join fade is 15ms", JOIN_FADE_SEC === 0.015);

    // Two 1s tones, different pitches so the join is a real discontinuity.
    const tone1 = join(dir, "tone1.wav");
    const tone2 = join(dir, "tone2.wav");
    await execFileAsync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${SR}:duration=1`,
      "-ar", String(SR), "-ac", "1", tone1,
    ]);
    await execFileAsync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=${SR}:duration=1`,
      "-ar", String(SR), "-ac", "1", tone2,
    ]);

    // Faded pair.
    const f1 = join(dir, "f1.wav");
    const f2 = join(dir, "f2.wav");
    copyFileSync(tone1, f1);
    copyFileSync(tone2, f2);
    check("applyJoinFades returns true on a 1s tone", await applyJoinFades(f1));
    check("applyJoinFades returns true on the second tone", await applyJoinFades(f2));
    const p1 = await probeMedia(f1);
    check("fade does not change duration", p1.durationSec !== null && Math.abs(p1.durationSec - 1) < 0.05);

    // Join both pairs with the render stage's concat-demuxer call.
    const listFaded = join(dir, "faded.txt");
    const listControl = join(dir, "control.txt");
    writeFileSync(listFaded, `file '${f1}'\nfile '${f2}'\n`);
    writeFileSync(listControl, `file '${tone1}'\nfile '${tone2}'\n`);
    const joinedFaded = join(dir, "joined-faded.wav");
    const joinedControl = join(dir, "joined-control.wav");
    for (const [list, out] of [
      [listFaded, joinedFaded],
      [listControl, joinedControl],
    ] as const) {
      await execFileAsync("ffmpeg", [
        "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list,
        "-c:a", "pcm_s16le", out,
      ]);
    }
    const pj = await probeMedia(joinedFaded);
    check("joined output is ~2s", pj.durationSec !== null && Math.abs(pj.durationSec - 2) < 0.05);

    // The join is at t=1.0s. Measure ±2ms around it: the fades ramp to
    // zero exactly there, the control stays at full tone amplitude.
    // (The lavfi sine source peaks at 0.125, so all thresholds are
    // relative to the tone's own overall peak, not absolute.)
    const fadedMax = await maxAbsInWindow(joinedFaded, 0.998, 1.002);
    const controlMax = await maxAbsInWindow(joinedControl, 0.998, 1.002);
    const controlOverall = await maxAbsInWindow(joinedControl, 0, 2);
    check(
      "control join stays loud (real discontinuity)",
      controlMax > controlOverall * 0.7,
      `join ${controlMax.toFixed(3)} vs overall ${controlOverall.toFixed(3)}`
    );
    check(
      "faded join dips to near-silence at the boundary",
      fadedMax < controlMax * 0.4,
      `faded ${fadedMax.toFixed(3)} vs control ${controlMax.toFixed(3)}`
    );

    // MP3 smoke: the real scene files are MP3s — fade must succeed and
    // keep duration (no precise join measurement; MP3 frames blur it).
    const mp3 = join(dir, "tone.mp3");
    await execFileAsync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${SR}:duration=1`,
      "-ar", String(SR), "-ac", "1", mp3,
    ]);
    check("applyJoinFades works on MP3", await applyJoinFades(mp3));
    const pm = await probeMedia(mp3);
    check("MP3 duration kept after fade", pm.durationSec !== null && Math.abs(pm.durationSec - 1) < 0.05);

    // Guard: a file shorter than 2x fade is left untouched.
    const tiny = join(dir, "tiny.wav");
    await execFileAsync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${SR}:duration=0.02`,
      "-ar", String(SR), "-ac", "1", tiny,
    ]);
    check("too-short file is left alone", (await applyJoinFades(tiny)) === false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL AUDIO-JOIN TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
