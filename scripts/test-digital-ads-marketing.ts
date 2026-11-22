/**
 * Digital ads-marketing workflow tests: link validation + QC gate nodes,
 * the wiring (validate -> link -> job, reels -> QC -> publish/review/fail),
 * the errorWorkflow, and the jobId carried to the publishing triggers.
 * Executes the workflow's own code nodes against stubs.
 * Run: npx tsx scripts/test-digital-ads-marketing.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

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

type WFNode = { name: string; type: string; parameters: Record<string, unknown> };
type WF = { name: string; nodes: WFNode[]; connections: Record<string, { main: Array<Array<{ node: string }>> }>; errorWorkflow?: string };

function runNode(jsCode: string, stubs: Record<string, unknown>): unknown {
  const fn = new Function("$input", "$env", "$", jsCode);
  return fn(stubs.$input, stubs.$env, stubs.$);
}

async function main() {
  const wf = JSON.parse(
    readFileSync(join(process.cwd(), "n8n/workflows/digital-ads-marketing.json"), "utf-8")
  ) as WF;
  const nodes = new Map(wf.nodes.map((n) => [n.name, n]));
  const out = (from: string, branch = 0): string[] =>
    (wf.connections[from]?.main?.[branch] ?? []).map((e) => e.node);

  check("errorWorkflow is digital-error-recovery", wf.errorWorkflow === "digital-error-recovery", wf.errorWorkflow ?? "none");
  for (const n of ["link-check", "if-link-ok", "build-link-error", "qc-check", "if-qc-pass", "if-qc-review", "build-qc-review", "build-qc-failed"]) {
    check(`node exists: ${n}`, nodes.has(n));
  }
  check("validate -> link-check", out("if-valid", 0).includes("link-check"), out("if-valid", 0).join(","));
  check("link-check -> if-link-ok", out("link-check", 0).includes("if-link-ok"));
  check("link ok -> create-ad-job", out("if-link-ok", 0).includes("create-ad-job"));
  check("link bad -> build-link-error", out("if-link-ok", 1).includes("build-link-error"));
  check("link error -> respond-invalid", out("build-link-error", 0).includes("respond-invalid"));
  check("reels-ready -> qc-check", out("if-reels-ready", 0).includes("qc-check"), out("if-reels-ready", 0).join(","));
  check("qc-check -> if-qc-pass", out("qc-check", 0).includes("if-qc-pass"));
  check("qc pass -> trigger-ig", out("if-qc-pass", 0).includes("trigger-ig"));
  check("qc not-pass -> if-qc-review", out("if-qc-pass", 1).includes("if-qc-review"));
  check("qc review -> build-qc-review", out("if-qc-review", 0).includes("build-qc-review"));
  check("qc review -> respond-review", out("build-qc-review", 0).includes("respond-review"));
  check("qc fail -> build-qc-failed", out("if-qc-review", 1).includes("build-qc-failed"));
  check("qc fail -> respond-failed", out("build-qc-failed", 0).includes("respond-failed"));

  const linkCheck = nodes.get("link-check")?.parameters as { url?: string; jsonBody?: string };
  check("link-check calls the validate-link endpoint", String(linkCheck?.url ?? "").includes("/api/v1/publishing/validate-link"), String(linkCheck?.url));
  check("link-check sends the productLink", String(linkCheck?.jsonBody ?? "").includes("productLink"), String(linkCheck?.jsonBody));
  const qcCheck = nodes.get("qc-check")?.parameters as { url?: string; jsonBody?: string };
  check("qc-check calls the qc-check endpoint", String(qcCheck?.url ?? "").includes("/api/v1/publishing/qc-check"), String(qcCheck?.url));
  check("qc-check sends jobId + caption + productLink", String(qcCheck?.jsonBody ?? "").includes("jobId") && String(qcCheck?.jsonBody ?? "").includes("caption") && String(qcCheck?.jsonBody ?? "").includes("productLink"), String(qcCheck?.jsonBody));

  const trigIg = nodes.get("trigger-ig")?.parameters as { jsonBody?: string };
  const trigFb = nodes.get("trigger-fb")?.parameters as { jsonBody?: string };
  check("trigger-ig body carries jobId", String(trigIg?.jsonBody ?? "").includes("jobId"), String(trigIg?.jsonBody));
  check("trigger-fb body carries jobId", String(trigFb?.jsonBody ?? "").includes("jobId"), String(trigFb?.jsonBody));

  const $ = (name: string) => ({
    first: () => ({ json: name === "build-reels-payload" ? { jobId: "job-9", productName: "Test Pack" } : {} }),
  });
  const $input = (json: unknown) => ({ first: () => ({ json }), all: () => [{ json }] });
  {
    const jsCode = nodes.get("build-link-error")?.parameters.jsCode as string;
    const outItems = runNode(jsCode, {
      $input: $input({ data: { reachable: false, status: 404, note: "Server ne HTTP 404 diya" } }),
      $env: {}, $,
    }) as Array<{ json: { valid: boolean; error: string } }>;
    check("build-link-error formats a 400 error", outItems[0]?.json.valid === false && outItems[0].json.error.includes("reachable nahi hai") && outItems[0].json.error.includes("404"), JSON.stringify(outItems[0]?.json));
  }
  {
    const jsCode = nodes.get("build-qc-review")?.parameters.jsCode as string;
    const outItems = runNode(jsCode, {
      $input: $input({ data: { verdict: "review", checks: [{ name: "link-reachable", ok: false, detail: "Server ne HTTP 404 diya" }] } }),
      $env: {}, $,
    }) as Array<{ json: { needsReview: boolean; jobId: string; status: string } }>;
    check("build-qc-review formats needsReview", outItems[0]?.json.needsReview === true && outItems[0].json.jobId === "job-9" && outItems[0].json.status === "QC_REVIEW", JSON.stringify(outItems[0]?.json));
  }
  {
    const jsCode = nodes.get("build-qc-failed")?.parameters.jsCode as string;
    const outItems = runNode(jsCode, {
      $input: $input({ data: { verdict: "fail", checks: [{ name: "caption-claims", ok: false, detail: "banned claim" }] } }),
      $env: {}, $,
    }) as Array<{ json: { ok: boolean; code: string; jobId: string } }>;
    check("build-qc-failed formats qc_failed", outItems[0]?.json.ok === false && outItems[0].json.code === "qc_failed" && outItems[0].json.jobId === "job-9", JSON.stringify(outItems[0]?.json));
  }

  {
    // question threads through validate-input (and quora is accepted)
    const jsCode = nodes.get("validate-input")?.parameters.jsCode as string;
    check("validate-input jsCode carries question", jsCode.includes("question"));
    const outItems = runNode(jsCode, {
      $input: $input({ headers: { "x-n8n-secret": "s3cr3t" }, body: { productType: "ebook", productName: "Test Ebook", productLink: "https://example.com/ebook", platforms: ["quora", "x"], question: "How do I get clients?" } }),
      $env: { N8N_WEBHOOK_SECRET: "s3cr3t" }, $,
    }) as Array<{ json: { valid: boolean; question?: string; platforms?: string[] } }>;
    check("validate-input passes question + quora through", outItems[0]?.json.valid === true && outItems[0]?.json.question === "How do I get clients?" && (outItems[0]?.json.platforms ?? []).includes("quora"), JSON.stringify(outItems[0]?.json));
  }
  {
    // build-publish-payload hands question to the multi-publish route
    const jsCode = nodes.get("build-publish-payload")?.parameters.jsCode as string;
    check("build-publish-payload jsCode carries question", jsCode.includes("question"));
    const $bp = (name: string) => ({
      first: () => ({ json: name === "build-reels-payload" ? { productType: "ebook", productName: "Test Ebook", productLink: "https://example.com/ebook", publish: true, question: "How do I get clients?" } : {} }),
    });
    const outItems = runNode(jsCode, { $input: $input({}), $env: {}, $: $bp }) as Array<{ json: { publishPayload?: { question?: string } } }>;
    check("build-publish-payload passes question to multi-publish", outItems[0]?.json.publishPayload?.question === "How do I get clients?", JSON.stringify(outItems[0]?.json.publishPayload));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
