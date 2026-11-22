/**
 * GitHub Actions render runner — renders ONE job from a render bundle
 * (GET /api/v1/jobs/:id/render-bundle) on a 4 vCPU / 16 GB runner.
 *
 * Usage (from the repo root, see .github/workflows/render-batch.yml):
 *   N8N_WEBHOOK_SECRET=<secret> npx tsx scripts/gh-render-batch.ts \
 *     --bundleUrl https://<backend>/api/v1/jobs/<id>/render-bundle \
 *     --jobId <id> --apiBase https://<backend>/api/v1 \
 *     [--outDir render-out]
 *
 * The secret comes from the environment only (a GitHub secret in the
 * workflow) — never from argv, never printed. The script downloads the
 * bundle's assets, renders with the repo's own renderFinalVideo(), copies
 * the finished MP4 to <outDir>/final-<jobId>.mp4, and reports the stage
 * back to the backend via stage-callback. Exit 1 on any failure.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { renderFinalVideo, type RenderSceneInput } from "../src/lib/pipeline/render";
import { RenderBundleSchema } from "../src/app/api/v1/jobs/[id]/render-bundle/route";

function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`download failed: http=${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`download empty: ${dest}`);
  writeFileSync(dest, buf);
}

async function postCallback(
  apiBase: string,
  jobId: string,
  secret: string,
  status: "succeeded" | "failed",
  message: string
): Promise<void> {
  const res = await fetch(`${apiBase}/jobs/${jobId}/stage-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-n8n-secret": secret,
    },
    body: JSON.stringify({
      stageKey: "editing_rendering",
      status,
      progressPct: 100,
      message: message.slice(0, 500),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error(`stage-callback failed: http=${res.status}`);
  }
}

async function main(): Promise<void> {
  const bundleUrl = arg("bundleUrl");
  const jobId = arg("jobId");
  const apiBase = arg("apiBase");
  const outDir = arg("outDir", "render-out");
  const secret = process.env.N8N_WEBHOOK_SECRET ?? "";
  if (!bundleUrl || !jobId || !apiBase) {
    throw new Error("Usage: --bundleUrl <url> --jobId <id> --apiBase <url>");
  }
  if (!secret) {
    throw new Error("N8N_WEBHOOK_SECRET is not set — refusing to fetch the bundle.");
  }
  const workDir = join(process.cwd(), outDir, jobId);
  mkdirSync(workDir, { recursive: true });

  const fail = async (msg: string): Promise<never> => {
    await postCallback(apiBase, jobId, secret, "failed", msg).catch(() => undefined);
    throw new Error(msg);
  };

  const bundleRes = await fetch(bundleUrl, {
    headers: { "x-n8n-secret": secret },
    signal: AbortSignal.timeout(60_000),
  });
  if (!bundleRes.ok) {
    await fail(`bundle fetch failed: http=${bundleRes.status}`);
  }
  const parsed = RenderBundleSchema.safeParse(await bundleRes.json());
  const bundle = parsed.success
    ? parsed.data
    : await fail("bundle failed validation.");

  const scenes: RenderSceneInput[] = [];
  for (const sc of bundle.scenes) {
    const videoPath = join(workDir, `scene-${sc.sceneId}.mp4`);
    const audioPath = join(workDir, `scene-${sc.sceneId}.mp3`);
    await download(sc.videoUrl, videoPath).catch((e: unknown) =>
      fail(`scene ${sc.sceneId} video download failed: ${(e as Error).message}`)
    );
    await download(sc.audioUrl, audioPath).catch((e: unknown) =>
      fail(`scene ${sc.sceneId} audio download failed: ${(e as Error).message}`)
    );
    scenes.push({ sceneId: sc.sceneId, videoPath, audioPath, durationSec: sc.durationSec });
  }
  const srtPath = join(workDir, "captions.srt");
  const vttPath = join(workDir, "captions.vtt");
  writeFileSync(srtPath, bundle.captions.srt, "utf-8");
  writeFileSync(vttPath, bundle.captions.vtt, "utf-8");

  let result;
  try {
    result = await renderFinalVideo(scenes, { ...bundle.opts, srtPath, vttPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await fail(`render failed: ${msg.slice(0, 300)}`);
  }
  const finalPath = join(outDir, `final-${jobId}.mp4`);
  copyFileSync(result!.outputPath, join(process.cwd(), finalPath));
  await postCallback(
    apiBase,
    jobId,
    secret,
    "succeeded",
    `Rendered on GitHub Actions (${bundle.scenes.length} scenes, ${result!.specs.durationSec}s).`
  );
  console.log(
    JSON.stringify({
      jobId,
      outputPath: finalPath,
      durationSec: result!.specs.durationSec,
      width: result!.specs.width,
      height: result!.specs.height,
      scenes: bundle.scenes.length,
    })
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
