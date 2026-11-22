/**
 * Digital thumbnail tests: 1280x720 PNG via Pollinations FLUX background
 * + FFmpeg drawtext title overlay (live network call — the title is
 * rendered by FFmpeg, never by the image model, so spelling is exact).
 * Run: npx tsx scripts/test-digital-thumbnails.ts
 */
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { DigitalError } from "../src/lib/digital/ebook";
import { generateThumbnail } from "../src/lib/digital/thumbnails";

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

const OUT = "/tmp/digital-thumbnail-test";

async function pngSize(file: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
    { timeout: 60_000 }
  );
  return stdout.trim();
}

async function main() {
  const r = await generateThumbnail(
    { title: "5 Aasaan Study Tips", subtitle: "Roz 30 minute, behtar result", style: "dark" },
    { outRoot: OUT }
  );
  check("thumbnail file exists", !!r.file && existsSync(r.file));
  check("thumbnail is a PNG", !!r.file && readFileSync(r.file).subarray(1, 4).toString() === "PNG");
  check("thumbnail is 1280x720", !!r.file && (await pngSize(r.file)) === "1280,720");
  check("thumbnail zip exists", !!r.files.zip && existsSync(r.files.zip));
  check("background image saved", existsSync(r.files.background));
  check("kind is thumbnail by default", r.kind === "thumbnail");

  // Intro screen: same chain, 1920x1080.
  const intro = await generateThumbnail(
    { title: "Welcome to Fit With Zaid", subtitle: "Aaj se shuruaat", style: "dark", format: "intro" },
    { outRoot: OUT }
  );
  check("intro file exists", !!intro.file && existsSync(intro.file));
  check("intro is 1920x1080", !!intro.file && (await pngSize(intro.file)) === "1920,1080");
  check("intro file named intro.png", !!intro.file && intro.file.endsWith("intro.png"));
  check("kind is intro", intro.kind === "intro");

  // Outro screen: 1920x1080, light theme.
  const outro = await generateThumbnail(
    { title: "Thanks for watching", subtitle: "Subscribe for more", style: "light", format: "outro" },
    { outRoot: OUT }
  );
  check("outro is 1920x1080", !!outro.file && (await pngSize(outro.file)) === "1920,1080");
  check("outro file named outro.png", !!outro.file && outro.file.endsWith("outro.png"));
  check("kind is outro", outro.kind === "outro");

  // Compliance: price in title is rejected (before any image call).
  try {
    await generateThumbnail({ title: "Only $5 today" }, { outRoot: OUT });
    check("price title -> DigitalError compliance_rejected", false);
  } catch (err) {
    check("price title -> DigitalError compliance_rejected", err instanceof DigitalError && err.code === "compliance_rejected");
  }

  // Validation: title too short.
  try {
    await generateThumbnail({ title: "ab" }, { outRoot: OUT });
    check("short title -> DigitalError validation_error", false);
  } catch (err) {
    check("short title -> DigitalError validation_error", err instanceof DigitalError && err.code === "validation_error");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("SOME DIGITAL-THUMBNAIL TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL DIGITAL-THUMBNAIL TESTS PASSED");
}

main();
