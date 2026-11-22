/**
 * check-pod-deps: deploy-time verification for the POD pipeline.
 * Run on the deploy VM (or in CI): npx tsx scripts/check-pod-deps.ts
 *
 * Checks: ffmpeg present, python3 present, rembg importable, print size.
 * Exit 0 = all good. Exit 1 = rembg missing (deploy must install it:
 * pip install rembg onnxruntime — first rembg run downloads the ~176MB
 * u2net model to ~/.u2net, so disk + network needed once).
 * ffmpeg/python3 missing also exits 1 (generation cannot run without them).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { checkRembgAvailable, printSize } from "../src/lib/digital/pod";

const execFileAsync = promisify(execFile);

async function which(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const ffmpeg = await which("ffmpeg");
  const python = await which("python3");
  const rembg = await checkRembgAvailable();
  const size = printSize();
  const report = {
    ffmpeg,
    python3: python,
    rembg,
    printSize: `${size.width}x${size.height}`,
    ok: ffmpeg && python && rembg,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!ffmpeg) console.error("MISSING: ffmpeg — install it (apk add ffmpeg).");
  if (!python) console.error("MISSING: python3 — install it (apk add python3).");
  if (!rembg) {
    console.error("MISSING: rembg — pip install rembg onnxruntime (then first run downloads the u2net model).");
    console.error("Without rembg, designs keep their generated background (transparent PNG skipped).");
  }
  process.exit(report.ok ? 0 : 1);
}

main();
