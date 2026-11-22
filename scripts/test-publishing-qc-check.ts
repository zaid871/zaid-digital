/**
 * QC check tests: publish-time gate verdicts (pass / review / fail)
 * for a finished video job. Run: npx tsx scripts/test-publishing-qc-check.ts
 */
import { runQcCheck } from "../src/lib/publishing/qc";
import type { FetchFn } from "../src/lib/publishing/validate-link";

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

const okFetch = (async () => new Response("", { status: 200 })) as unknown as FetchFn;
const deadFetch = (async () => new Response("", { status: 404 })) as unknown as FetchFn;

async function main() {
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Wedding invitation templates\n\nDetails: https://example.com/wedding",
      productLink: "https://example.com/wedding",
      fetchFn: okFetch, job: { status: "COMPLETED" }, hasVideo: true,
    });
    check("clean job -> pass", r.verdict === "pass", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Best product\n\nDetails: https://example.com/p",
      productLink: "https://example.com/p",
      fetchFn: okFetch, job: { status: "PROCESSING" }, hasVideo: true,
    });
    check("job not completed -> fail", r.verdict === "fail", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Best product", fetchFn: okFetch, job: { status: "COMPLETED" }, hasVideo: false,
    });
    check("no final video -> fail", r.verdict === "fail", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-missing", caption: "Best product", fetchFn: okFetch, job: null, hasVideo: false,
    });
    check("job missing -> fail", r.verdict === "fail" && r.checks[0]?.name === "job-exists", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Read our customer review — best product ever",
      fetchFn: okFetch, job: { status: "COMPLETED" }, hasVideo: true,
    });
    check("banned claim in caption -> fail", r.verdict === "fail", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Best product, sirf ₹499 me",
      fetchFn: okFetch, job: { status: "COMPLETED" }, hasVideo: true,
    });
    check("price in caption -> review", r.verdict === "review", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Best product\n\nDetails: https://example.com/p",
      productLink: "https://dead.example.com/p",
      fetchFn: deadFetch, job: { status: "COMPLETED" }, hasVideo: true,
    });
    check("dead product link -> review", r.verdict === "review", JSON.stringify(r));
  }
  {
    const r = await runQcCheck({
      jobId: "job-1", caption: "Best product", fetchFn: okFetch, job: { status: "COMPLETED" }, hasVideo: true,
    });
    check("no link given -> pass (no link check)", r.verdict === "pass", JSON.stringify(r));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
