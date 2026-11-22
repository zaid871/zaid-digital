/**
 * GIF export tests: opt-in detection (wantsGif), job-schema default OFF,
 * and a REAL FFmpeg two-pass conversion on the dry-run demo MP4
 * (14s 1080x1920) — header, codec, width, duration and size are all
 * verified with ffprobe, not assumed.
 * The delivery-stage wiring (GIF after final.mp4) needs Postgres, so it
 * is NOT live-tested here — it is type-checked (tsc) and build-verified,
 * and the deploy checklist runs a real job with gif:true.
 * Run: npx tsx scripts/test-gif.ts
 */
import { existsSync, readFileSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GifError, GIF_DEFAULTS, renderGif, wantsGif } from "../src/lib/pipeline/gif";
import { createJobSchema } from "../src/lib/schemas";
import { probeFull } from "../src/lib/pipeline/render";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name} ${extra}`);
  }
}

async function main(): Promise<void> {
  console.log("== wantsGif: explicit opt-in only ==");
  const yes: Array<[string, string]> = [
    ["hinglish gif banao", "Is video ke saath gif banao"],
    ["GIF BANAO caps", "GIF BANAO"],
    ["gif version", "gif version bhi chahiye"],
    ["convert to gif", "is ko gif me convert karo"],
    ["english make a gif", "please make a gif too"],
    ["gif banao + video", "video banao aur gif banao"],
    ["bana do", "is ka gif bana do"],
  ];
  for (const [name, prompt] of yes) check(name, wantsGif(prompt) === true, `prompt=${prompt}`);

  const no: Array<[string, string]> = [
    ["plain video", "video banao"],
    ["bare gif mention", "ek achha gif jaisa effect do"],
    ["gift word", "gift wrapping ka video banao"],
    ["explicit refusal 1", "bina gif ke video banao"],
    ["explicit refusal 2", "gif nahi chahiye, sirf video"],
    ["explicit refusal 3", "without gif, video only"],
    ["empty", ""],
    ["null", null as unknown as string],
  ];
  for (const [name, prompt] of no) check(name, wantsGif(prompt) === false, `prompt=${String(prompt)}`);

  console.log("== job schema: default OFF ==");
  const base = createJobSchema.parse({ productUrl: "https://example.com/product" });
  check("gif absent → undefined (off)", base.gif === undefined);
  const on = createJobSchema.parse({ productUrl: "https://example.com/product", gif: true });
  check("gif:true passes through", on.gif === true);
  check("defaults unchanged (480/8/3)", GIF_DEFAULTS.width === 480 && GIF_DEFAULTS.fps === 8 && GIF_DEFAULTS.seconds === 3);

  console.log("== renderGif: real FFmpeg conversion ==");
  const demo = join(process.cwd(), "storage", "dry-run-demo.mp4");
  if (!existsSync(demo)) {
    console.log("  SKIP: storage/dry-run-demo.mp4 not found — conversion not tested");
  } else {
    const dir = mkdtempSync(join(tmpdir(), "gif-test-"));
    try {
      const out = join(dir, "preview.gif");
      const result = await renderGif({ input: demo, output: out });
      check("output file exists", existsSync(out));
      const header = readFileSync(out, { encoding: "ascii" }).slice(0, 6);
      check("GIF89a header", header === "GIF89a", `got ${JSON.stringify(header)}`);
      check("width 480", result.width === 480, `got ${result.width}`);
      check("height 853 (9:16, 480x1920/1080)", result.height === 853, `got ${result.height}`);
      check("duration ~3s", Math.abs(result.durationSec - 3) < 1, `got ${result.durationSec}`);
      check("size sane (<10 MB)", result.bytes > 50_000 && result.bytes < 10_000_000, `got ${result.bytes}`);
      check("palette temp cleaned up", !existsSync(`${out}.palette.png`));
      const probe = await probeFull(out);
      check("ffprobe says gif codec", probe.videoCodec === "gif", `got ${probe.videoCodec}`);

      const out2 = join(dir, "small.gif");
      const small = await renderGif({ input: demo, output: out2, width: 320, fps: 8, seconds: 2 });
      check("custom width 320", small.width === 320, `got ${small.width}`);
      check("custom duration ~2s", Math.abs(small.durationSec - 2) < 1, `got ${small.durationSec}`);
      check("smaller file than default", small.bytes < result.bytes, `${small.bytes} vs ${result.bytes}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("== renderGif: missing input fails honestly ==");
  try {
    await renderGif({ input: "/tmp/does-not-exist-xyz.mp4", output: "/tmp/x.gif" });
    check("missing input throws", false);
  } catch (e) {
    check("missing input throws GifError (permanent)", e instanceof GifError && e.transient === false);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("test-gif crashed:", e);
  process.exit(1);
});
