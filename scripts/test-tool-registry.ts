/**
 * Tool Registry tests: registry load/validate, routable rules, quota
 * guard, ledger, dispatch (with stubbed fetch — no live keys, no live
 * tools), and the code adapters (NIM, Resend, GitHub Actions, Modal,
 * Kaggle, Cloudflare Workers) plus the R2 not-configured path, the
 * shard helper, the render-bundle schema, and the render-batch
 * workflow YAML. Phase 2 (2026-11-22) additions are at the end.
 * Run: npx tsx scripts/test-tool-registry.ts
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { load as yamlLoad } from "js-yaml";

// Isolated storage + registry so tests never touch storage/tools.
const tmp = mkdtempSync(join(tmpdir(), "tools-test-"));
process.env.TOOLS_STORAGE_DIR = join(tmp, "tools");
process.env.TOOLS_REGISTRY_PATH = join(tmp, "tool-registry.json");
const REAL_REGISTRY_PATH = join(process.cwd(), "storage", "tool-registry.json");

import { loadRegistry, getTool, routableTools, registrySummary, toPublicTool } from "../src/lib/tools/registry";
import { checkToolQuota, recordToolUse, setToolQuotaCount } from "../src/lib/tools/quota";
import { appendToolLedger, readToolLedger } from "../src/lib/tools/ledger";
import { dispatchTool } from "../src/lib/tools/dispatch";
import { nimAdapter } from "../src/lib/tools/adapters/nim";
import { resendAdapter } from "../src/lib/tools/adapters/resend";
import { githubActionsAdapter } from "../src/lib/tools/adapters/github-actions";
import { r2Adapter } from "../src/lib/tools/adapters/r2";
import { modalAdapter } from "../src/lib/tools/adapters/modal";
import { kaggleAdapter } from "../src/lib/tools/adapters/kaggle";
import { cfWorkersAdapter } from "../src/lib/tools/adapters/cf-workers";
import { splitIntoShards, runSharded } from "../src/lib/tools/shard";
import { isStale } from "../src/lib/tools/types";
import { RenderBundleSchema } from "../src/app/api/v1/jobs/[id]/render-bundle/route";

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

const TODAY = "2026-11-20";

function writeTempRegistry(): void {
  writeFileSync(
    process.env.TOOLS_REGISTRY_PATH as string,
    JSON.stringify({
      version: 1,
      updatedAt: TODAY,
      tools: [
        {
          id: "nim",
          displayName: "NVIDIA NIM",
          capabilities: ["text-llm"],
          limits: { rpd: "10,000 per model" },
          quota: { perDay: 10000, unit: "requests" },
          expiry: "free tier",
          fallback: "groq",
          cost: "$0",
          status: "wired",
          lastVerified: TODAY,
          secretEnv: "NVIDIA_API_KEY",
          adapter: "nim",
        },
        {
          id: "resend",
          displayName: "Resend",
          capabilities: ["email"],
          limits: { perMonth: "3,000" },
          quota: { perDay: 100, perMonth: 3000, unit: "emails" },
          expiry: "free tier",
          fallback: null,
          cost: "$0",
          status: "wired",
          lastVerified: TODAY,
          secretEnv: "RESEND_API_KEY",
          adapter: "resend",
        },
        {
          id: "kaggle",
          displayName: "Kaggle",
          capabilities: ["lora-train"],
          limits: { gpu: "T4 16 GB" },
          quota: { perWeek: 30, unit: "gpu-hours" },
          expiry: "free tier",
          fallback: "modal",
          cost: "$0",
          status: "candidate",
          lastVerified: TODAY,
          secretEnv: "KAGGLE_API_TOKEN",
          adapter: null,
        },
        {
          id: "stale-tool",
          displayName: "Stale Tool",
          capabilities: ["text-llm"],
          limits: {},
          quota: { unit: "requests" },
          expiry: "free tier",
          fallback: null,
          cost: "$0",
          status: "wired",
          lastVerified: "2026-01-01",
          adapter: "nim",
        },
        {
          id: "r2",
          displayName: "Cloudflare R2",
          capabilities: ["object-storage"],
          limits: {},
          quota: { unit: "GB" },
          expiry: "free tier",
          fallback: null,
          cost: "$0",
          status: "wired",
          lastVerified: TODAY,
          secretEnv: "S3_ACCESS_KEY",
          adapter: "s3-storage",
        },
        // Invalid entry: no capabilities — must be skipped with a warning.
        { id: "broken", displayName: "Broken", limits: {}, quota: { unit: "x" }, expiry: "?", fallback: null, cost: "$0", status: "wired", lastVerified: TODAY, adapter: null },
      ],
    })
  );
}

/** Stub fetch: NIM + Resend + GitHub dispatch succeed; anything else 404s. */
function stubFetch(): void {
  const fake = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("integrate.api.nvidia.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: "NIM says hello." } }] }),
      };
    }
    if (u.includes("api.resend.com")) {
      return { status: 200, ok: true, json: async () => ({ id: "re_123" }) };
    }
    if (u.includes("api.github.com")) {
      return { status: 204, ok: true, json: async () => ({}) };
    }
    return { status: 404, ok: false, json: async () => ({ message: "not found" }) };
  }) as unknown as typeof fetch;
  (globalThis as { fetch: typeof fetch }).fetch = fake;
}

async function main(): Promise<void> {
  writeTempRegistry();
  stubFetch();

  const { tools, warnings } = loadRegistry();
  check("registry loads 5 valid entries", tools.length === 5, `got ${tools.length}`);
  check("invalid entry skipped with warning", warnings.length === 1, warnings.join(";"));
  check("getTool finds nim", getTool(tools, "nim")?.displayName === "NVIDIA NIM");
  check("summary counts", JSON.stringify(registrySummary(tools)) === JSON.stringify({ candidate: 1, wired: 4, paused: 0, dead: 0 }));
  check("stale flag: jan entry is stale", isStale("2026-01-01", new Date("2026-11-20T00:00:00Z")));
  check("stale flag: today entry is fresh", !isStale(TODAY, new Date("2026-11-20T00:00:00Z")));
  process.env.NVIDIA_API_KEY = "test-key-never-real";
  check("public view leaks no secret value", !JSON.stringify(toPublicTool(tools[0])).includes("test-key-never-real"));

  const routableText = routableTools(tools, "text-llm");
  check("routable text-llm is nim only (stale excluded)", routableText.length === 1 && routableText[0].id === "nim");
  check("candidate kaggle not routable", routableTools(tools, "lora-train").length === 0);

  // Quota guard.
  const q0 = checkToolQuota("nim", { perDay: 10000 }, "requests");
  check("quota allows fresh tool", q0.allowed && q0.remaining === 10000);
  recordToolUse("nim", 3);
  check("recordToolUse decrements remaining", checkToolQuota("nim", { perDay: 10000 }, "requests").remaining === 9997);
  setToolQuotaCount("nim", { day: 10000 });
  check("quota blocks at the limit", !checkToolQuota("nim", { perDay: 10000 }, "requests").allowed);
  setToolQuotaCount("nim", { day: 0 });

  // Ledger round-trip.
  const lid = appendToolLedger({
    runId: "job-1",
    toolId: "nim",
    capability: "text-llm",
    jobId: "job-1",
    ok: true,
    status: "ok",
    unitsUsed: 1,
    durationMs: 5,
  });
  check("ledger row readable", readToolLedger(5).some((e) => e.ledgerId === lid && e.toolId === "nim"));

  // Dispatch: text-llm with stubbed NIM + key present.
  process.env.NVIDIA_API_KEY = "test-key-never-real";
  const d1 = await dispatchTool({ capability: "text-llm", jobId: "job-2", input: { prompt: "Hello" }, timeoutMs: 60000 });
  check("dispatch text-llm ok via NIM stub", d1.ok && d1.output?.text === "NIM says hello.", JSON.stringify(d1.error));
  check("dispatch wrote a ledger row", readToolLedger(5).some((e) => e.jobId === "job-2" && e.ok));

  // Dispatch: quota exhausted pauses with a typed code.
  setToolQuotaCount("nim", { day: 10000 });
  const d2 = await dispatchTool({ capability: "text-llm", jobId: "job-3", input: { prompt: "Hello" }, timeoutMs: 60000 });
  check("dispatch quota-exceeded pauses typed", !d2.ok && d2.pauseReason === "quota_exceeded");
  setToolQuotaCount("nim", { day: 0 });

  // Dispatch: no wired tool for the capability.
  const d3 = await dispatchTool({ capability: "gpu-video", jobId: "job-4", input: {}, timeoutMs: 60000 });
  check("dispatch gpu-video pauses not_wired", !d3.ok && d3.error?.code === "tool_not_wired");

  // Dispatch: email without a key pauses not_configured.
  delete process.env.RESEND_API_KEY;
  const d4 = await dispatchTool({ capability: "email", jobId: "job-5", input: { from: "a@b.co", to: "c@d.co", subject: "Hi", text: "hello" }, timeoutMs: 60000 });
  check("dispatch email without key pauses not_configured", !d4.ok && d4.pauseReason === "not_configured");

  // Adapters directly.
  const nimBad = await nimAdapter.run({ toolId: "nim", capability: "text-llm", jobId: "job-6", input: {}, timeoutMs: 60000 });
  check("NIM adapter rejects bad input typed", !nimBad.ok && nimBad.error?.code === "invalid_input");
  delete process.env.NVIDIA_API_KEY;
  const nimNoKey = await nimAdapter.run({ toolId: "nim", capability: "text-llm", jobId: "job-7", input: { prompt: "Hi" }, timeoutMs: 60000 });
  check("NIM adapter without key pauses not_configured", !nimNoKey.ok && nimNoKey.pauseReason === "not_configured");
  process.env.NVIDIA_API_KEY = "test-key-never-real";

  process.env.RESEND_API_KEY = "test-key-never-real";
  const re = await resendAdapter.run({ toolId: "resend", capability: "email", jobId: "job-8", input: { from: "a@b.co", to: "c@d.co", subject: "Hi", text: "hello" }, timeoutMs: 60000 });
  check("Resend adapter ok via stub, id returned", re.ok && re.output?.data?.id === "re_123");

  process.env.GITHUB_TOKEN = "test-key-never-real";
  process.env.GITHUB_REPO = "owner/repo";
  process.env.GITHUB_WORKFLOW_ID = "render.yml";
  const gh = await githubActionsAdapter.run({ toolId: "gh-actions", capability: "parallel-compute", jobId: "job-9", input: { ref: "main" }, timeoutMs: 60000 });
  check("GitHub Actions adapter ok via stub (204)", gh.ok && gh.output?.data?.dispatched === true);

  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY;
  delete process.env.S3_SECRET_KEY;
  const r2 = await r2Adapter.run({ toolId: "r2", capability: "object-storage", jobId: "job-10", input: { localPath: "/tmp/x.mp4", key: "v/x.mp4" }, timeoutMs: 60000 });
  check("R2 adapter without S3 env pauses not_configured", !r2.ok && r2.pauseReason === "not_configured");

  // Dispatch through the s3-storage map key (fixed 2026-11-22): a wired
  // r2 entry must reach the adapter (not_configured), not tool_not_wired.
  const d5 = await dispatchTool({ capability: "object-storage", jobId: "job-11", input: { localPath: "/tmp/x.mp4", key: "v/x.mp4" }, timeoutMs: 60000 });
  check("dispatch object-storage reaches s3-storage adapter", !d5.ok && d5.pauseReason === "not_configured", d5.error?.code ?? "");

  // Fallback cycle regression (2026-11-22 redeploy): kaggle <-> modal
  // formed a 2-cycle that spun dispatchTool's fallback loop forever at
  // 100% CPU and hung every later request (the event loop was blocked).
  // The loop must terminate; race against a timeout so a regression
  // fails fast instead of hanging the suite.
  {
    const cycleRegistry = {
      version: 1,
      updatedAt: TODAY,
      tools: [
        { id: "kaggle", displayName: "Kaggle", capabilities: ["lora-train"], limits: {}, quota: { unit: "gpu-hours" }, expiry: "free", fallback: "modal", cost: "$0", status: "wired", lastVerified: TODAY, adapter: "kaggle" },
        { id: "modal", displayName: "Modal", capabilities: ["lora-train"], limits: {}, quota: { unit: "gpu-minutes" }, expiry: "free", fallback: "kaggle", cost: "$0", status: "wired", lastVerified: TODAY, adapter: "modal" },
      ],
    };
    writeFileSync(process.env.TOOLS_REGISTRY_PATH as string, JSON.stringify(cycleRegistry));
    delete process.env.KAGGLE_USERNAME;
    delete process.env.KAGGLE_KEY;
    delete process.env.KAGGLE_API_TOKEN;
    delete process.env.MODAL_TOKEN_ID;
    delete process.env.MODAL_TOKEN_SECRET;
    const raced = await Promise.race([
      dispatchTool({ capability: "lora-train", jobId: "job-cycle", input: { action: "status", kernelSlug: "u/k" }, timeoutMs: 60000 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    check("dispatch terminates on a fallback cycle (kaggle<->modal)", raced !== null, "dispatchTool hung past 5s");
    writeTempRegistry();
  }

  // --- Phase 2: Modal / Kaggle / Workers adapters (no CLIs here) ---
  delete process.env.MODAL_TOKEN_ID;
  delete process.env.MODAL_TOKEN_SECRET;
  const moBad = await modalAdapter.run({ toolId: "modal", capability: "gpu-video", jobId: "job-12", input: {}, timeoutMs: 60000 });
  check("Modal adapter rejects bad input typed", !moBad.ok && moBad.error?.code === "invalid_input");
  const moNoKey = await modalAdapter.run({ toolId: "modal", capability: "gpu-video", jobId: "job-13", input: { function: "wan-generate", args: { prompt: "x" } }, timeoutMs: 60000 });
  check("Modal adapter without keys pauses not_configured", !moNoKey.ok && moNoKey.pauseReason === "not_configured");
  process.env.MODAL_TOKEN_ID = "test-id-never-real";
  process.env.MODAL_TOKEN_SECRET = "test-secret-never-real";
  const moNoCli = await modalAdapter.run({ toolId: "modal", capability: "gpu-video", jobId: "job-14", input: { function: "wan-generate", args: { prompt: "x" } }, timeoutMs: 60000 });
  check("Modal adapter without CLI pauses cli_missing", !moNoCli.ok && moNoCli.error?.code === "cli_missing", moNoCli.error?.code ?? "");
  delete process.env.MODAL_TOKEN_ID;
  delete process.env.MODAL_TOKEN_SECRET;

  delete process.env.KAGGLE_USERNAME;
  delete process.env.KAGGLE_KEY;
  const kaBad = await kaggleAdapter.run({ toolId: "kaggle", capability: "lora-train", jobId: "job-15", input: {}, timeoutMs: 60000 });
  check("Kaggle adapter rejects bad input typed", !kaBad.ok && kaBad.error?.code === "invalid_input");
  const kaNoKey = await kaggleAdapter.run({ toolId: "kaggle", capability: "lora-train", jobId: "job-16", input: { action: "status", kernelDir: "src/lib/tools/workers/kaggle-lora" }, timeoutMs: 60000 });
  check("Kaggle adapter without keys pauses not_configured", !kaNoKey.ok && kaNoKey.pauseReason === "not_configured");
  process.env.KAGGLE_USERNAME = "test-user-never-real";
  process.env.KAGGLE_KEY = "test-key-never-real";
  const kaNoCli = await kaggleAdapter.run({ toolId: "kaggle", capability: "lora-train", jobId: "job-17", input: { action: "status", kernelDir: "src/lib/tools/workers/kaggle-lora", kernelSlug: "test-user-never-real/toolbox-lora-train" }, timeoutMs: 60000 });
  check("Kaggle adapter without CLI pauses cli_missing", !kaNoCli.ok && kaNoCli.error?.code === "cli_missing", kaNoCli.error?.code ?? "");
  delete process.env.KAGGLE_USERNAME;
  delete process.env.KAGGLE_KEY;

  delete process.env.CLOUDFLARE_API_TOKEN;
  const cfNoKey = await cfWorkersAdapter.run({ toolId: "cf-workers", capability: "webhook-ingress", jobId: "job-18", input: { action: "status" }, timeoutMs: 60000 });
  check("Workers adapter without token pauses not_configured", !cfNoKey.ok && cfNoKey.pauseReason === "not_configured");
  process.env.CLOUDFLARE_API_TOKEN = "test-token-never-real";
  const cfNoCli = await cfWorkersAdapter.run({ toolId: "cf-workers", capability: "webhook-ingress", jobId: "job-19", input: { action: "status" }, timeoutMs: 60000 });
  check("Workers adapter without CLI pauses cli_missing", !cfNoCli.ok && cfNoCli.error?.code === "cli_missing", cfNoCli.error?.code ?? "");
  delete process.env.CLOUDFLARE_API_TOKEN;

  // --- Phase 2: shard helper ---
  check("splitIntoShards evens out 10 items into 3", JSON.stringify(splitIntoShards([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)) === JSON.stringify([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]));
  check("splitIntoShards drops empty shards", splitIntoShards([], 3).length === 0);
  const sh = await runSharded({
    capability: "gpu-video",
    jobId: "job-20",
    items: ["a", "b", "c"],
    shardCount: 2,
    shardInput: (shard, i, total) => ({ urls: shard, shard: i, total }),
  });
  check("runSharded reports per-shard pauses honestly", !sh.ok && sh.failed === 2 && sh.succeeded === 0, `failed=${sh.failed}`);

  // --- Phase 2: render-bundle schema ---
  const goodBundle = {
    jobId: "job-21",
    scenes: [{ sceneId: "s1", videoUrl: "https://example.com/v.mp4", audioUrl: "https://example.com/a.mp3", durationSec: 5 }],
    captions: { srt: "1\n00:00:00,000 --> 00:00:01,000\nHi\n", vtt: "WEBVTT\n" },
    opts: { jobId: "job-21", productName: "Widget", callToAction: "Check the link.", targetDurationSec: 45 },
  };
  check("render-bundle schema accepts a valid bundle", RenderBundleSchema.safeParse(goodBundle).success);
  check("render-bundle schema rejects empty scenes", !RenderBundleSchema.safeParse({ ...goodBundle, scenes: [] }).success);

  // --- Phase 2: render-batch workflow YAML ---
  const wfPath = join(process.cwd(), ".github", "workflows", "render-batch.yml");
  check("render-batch workflow file exists", existsSync(wfPath));
  const wf = yamlLoad(readFileSync(wfPath, "utf-8")) as {
    on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
    jobs?: { render?: { steps?: Array<{ run?: string; uses?: string }> } };
  };
  const wfInputs = wf.on?.workflow_dispatch?.inputs ?? {};
  check(
    "workflow has workflow_dispatch with bundleUrl/jobId/apiBase",
    "bundleUrl" in wfInputs && "jobId" in wfInputs && "apiBase" in wfInputs
  );
  const wfSteps = wf.jobs?.render?.steps ?? [];
  check(
    "workflow runs the render script and uploads the artifact",
    wfSteps.some((s) => (s.run ?? "").includes("gh-render-batch.ts")) &&
      wfSteps.some((s) => (s.uses ?? "").includes("upload-artifact"))
  );

  // --- Phase 2: worker files exist ---
  const workersDir = join(process.cwd(), "src", "lib", "tools", "workers");
  check(
    "Modal workers exist",
    ["modal-wan.py", "modal-upscale.py", "modal-whisper.py"].every((f) => existsSync(join(workersDir, f)))
  );
  const kernelMeta = JSON.parse(
    readFileSync(join(workersDir, "kaggle-lora", "kernel-metadata.json"), "utf-8")
  ) as { id?: string; enable_gpu?: boolean };
  check(
    "Kaggle kernel metadata is GPU-enabled with a username placeholder",
    kernelMeta.enable_gpu === true && (kernelMeta.id ?? "").includes("<kaggle-username>")
  );
  check(
    "Kaggle LoRA script exists",
    existsSync(join(workersDir, "kaggle-lora", "train-lora.py"))
  );
  check(
    "Webhook-ingress worker exists",
    existsSync(join(workersDir, "webhook-ingress", "index.ts")) &&
      existsSync(join(workersDir, "webhook-ingress", "wrangler.toml"))
  );
  check("GH render runner script exists", existsSync(join(process.cwd(), "scripts", "gh-render-batch.ts")));

  // --- Phase 2: the REAL registry file loads clean with adapters wired in ---
  const savedPath = process.env.TOOLS_REGISTRY_PATH;
  process.env.TOOLS_REGISTRY_PATH = REAL_REGISTRY_PATH;
  const real = loadRegistry();
  check("real registry loads with 0 warnings", real.warnings.length === 0, real.warnings.join(";"));
  check(
    "real registry: modal/kaggle/cf-workers have adapters (all three wired 2026-11-22)",
    ["modal", "kaggle", "cf-workers"].every((id) => {
      const t = getTool(real.tools, id);
      return t !== null && t.adapter !== null;
    }) &&
      getTool(real.tools, "kaggle")?.status === "wired" &&
      getTool(real.tools, "cf-workers")?.status === "wired" &&
      getTool(real.tools, "modal")?.status === "wired"
  );
  check("real registry: gh-actions notes the render-batch workflow", (getTool(real.tools, "gh-actions")?.limits.renderBatch ?? "").includes("render-batch.yml"));
  process.env.TOOLS_REGISTRY_PATH = savedPath;

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
