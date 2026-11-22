/**
 * Remotion code-motion tests: config gating, prop building, and the honest
 * typed fall-through when deps/Chrome are missing. The live render path is
 * a deploy-check (needs Chrome + remotion bundle at runtime).
 * Run: npx tsx scripts/test-remotion-motion.ts
 */
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCodeMotionProps,
  isConfigured,
  PROVIDER_KEY,
  renderCodeMotion,
} from "../src/lib/providers/remotion-motion";

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

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const dir = mkdtempSync(join(tmpdir(), "remotion-test-"));
const pngPath = join(dir, "still.png");
// 1080x1920 test still via ffmpeg (solid dark frame)
try {
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=0x141416:s=1080x1920:d=1",
    "-frames:v", "1", pngPath,
  ], { stdio: "ignore" });
} catch {
  // fallback: minimal 1x1 PNG bytes
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  writeFileSync(pngPath, png1x1);
}

async function main() {
  check("provider key", PROVIDER_KEY === "remotion");

  withEnv({ REMOTION_ENABLED: undefined }, () => {
    check("disabled by default", isConfigured() === false);
  });

  // buildCodeMotionProps: pure
  const props = buildCodeMotionProps(pngPath, "  Pehli baat: dumdaar look  ", "#ff6b35");
  check("title trimmed", props.title === "Pehli baat: dumdaar look", JSON.stringify(props.title));
  check("data uri png", props.imageDataUri.startsWith("data:image/png;base64,"));
  check("accent passthrough", props.accentColor === "#ff6b35");
  const long = buildCodeMotionProps(pngPath, "x".repeat(200), "#000000");
  check("title truncated to 90", long.title.length === 90, String(long.title.length));

  // renderCodeMotion: disabled -> typed not_configured, NEVER throws
  await withEnv({ REMOTION_ENABLED: undefined }, async () => {
    let threw = false;
    let r: Awaited<ReturnType<typeof renderCodeMotion>> | null = null;
    try {
      r = await renderCodeMotion({
        imagePath: pngPath,
        title: "test",
        durationSec: 2,
        outputPath: join(dir, "out.mp4"),
      });
    } catch {
      threw = true;
    }
    check("disabled render never throws", threw === false);
    check("disabled render -> not_configured", r !== null && !r.ok && r.error.code === "not_configured", r && !r.ok ? r.error.code : "?");
    check("disabled render names ffmpeg fallback", r !== null && !r.ok && r.error.fallback === "ffmpeg");
  });

  // invalid input -> typed error, never throws
  await withEnv({ REMOTION_ENABLED: "true" }, async () => {
    let threw = false;
    let r: Awaited<ReturnType<typeof renderCodeMotion>> | null = null;
    try {
      r = await renderCodeMotion({
        imagePath: join(dir, "nope.png"),
        title: "test",
        durationSec: 2,
        outputPath: join(dir, "out2.mp4"),
      });
    } catch {
      threw = true;
    }
    check("missing image never throws", threw === false);
    check("missing image -> invalid_input", r !== null && !r.ok && r.error.code === "invalid_input");
  });

  // composition source exists (bundler entry) — static check
  const entry = join(process.cwd(), "src", "lib", "remotion", "index.ts");
  const comp = join(process.cwd(), "src", "lib", "remotion", "CodeMotion.tsx");
  check("remotion entry exists", existsSync(entry), entry);
  check("composition exists", existsSync(comp), comp);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
