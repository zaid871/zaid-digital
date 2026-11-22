/**
 * Auto-generate tick tests: brief pick + dedup + webhook fire + weekly
 * supporting rotation, all with a stubbed fetch (no live n8n).
 * Run: npx tsx scripts/test-digital-auto-generate.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  isoWeekKey,
  ledgerPath,
  runAutoGenerateTick,
  type AutoGenerateLedger,
  type FetchFn,
} from "../src/lib/digital/auto-generate";
import type { Brief } from "../src/lib/digital/briefs";

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

const OUT1 = "/tmp/digital-auto-generate-test-1";
const OUT2 = "/tmp/digital-auto-generate-test-2";

function writeBriefs(outRoot: string, briefs: Brief[]) {
  mkdirSync(join(outRoot, "briefs"), { recursive: true });
  writeFileSync(join(outRoot, "briefs", "latest.json"), JSON.stringify({ briefs, analysis: {}, minedAt: "2026-11-16T01:30:00Z", warnings: [] }), "utf-8");
}

function brief(id: string, productType: Brief["productType"], niche: string, demandScore: number): Brief {
  return {
    id,
    productType,
    niche,
    title: `${niche} — ${id}`,
    audience: "test",
    angle: "test angle",
    demandEvidence: ["test"],
    demandScore,
    trend: "rising",
    gap: "test gap",
    uniqueness: ["test"],
    status: "queued",
  };
}

function stubFetch(calls: Array<{ url: string; body: unknown }>, failWebhook?: string): FetchFn {
  return (async (url: unknown, init?: unknown) => {
    const body = JSON.parse(String((init as { body?: string }).body ?? "{}")) as unknown;
    calls.push({ url: String(url), body });
    const webhook = String(url).split("/webhook/")[1] ?? "";
    if (failWebhook && webhook === failWebhook) return { ok: false, status: 500 } as unknown as Response;
    return { ok: true, status: 200 } as unknown as Response;
  }) as unknown as FetchFn;
}

async function main() {
  // Hermetic: wipe the /tmp fixtures from any earlier run first.
  for (const d of [OUT1, OUT2, "/tmp/digital-auto-generate-test-empty"]) {
    rmSync(d, { recursive: true, force: true });
  }
  const savedBase = process.env.N8N_BASE_URL;
  const savedSecret = process.env.N8N_WEBHOOK_SECRET;
  process.env.N8N_BASE_URL = "http://n8n:5678";
  process.env.N8N_WEBHOOK_SECRET = "test-secret";
  const monday = new Date("2026-11-16T02:30:00Z"); // Monday
  const nextMonday = new Date("2026-11-23T02:30:00Z"); // next Monday

  // --- Main flow: top 3 picked, already-done brief skipped. ---
  {
    const briefs = [
      brief("b1", "template", "wedding", 90),
      brief("b2", "ebook", "budget", 82),
      brief("b3", "planner", "fitness", 75),
      brief("b4", "spreadsheet", "freelance", 60),
    ];
    writeBriefs(OUT1, briefs);
    // b1 already generated last week — must be skipped.
    mkdirSync(join(OUT1, "auto-generate"), { recursive: true });
    const ledger: AutoGenerateLedger = {
      entries: [
        { briefId: "b1", week: "2026-W46", kind: "product", productType: "template", webhook: "digital-template-generation", status: "triggered", at: "2026-11-09T02:30:00Z" },
      ],
    };
    writeFileSync(ledgerPath(OUT1), JSON.stringify(ledger, null, 2), "utf-8");
    const calls: Array<{ url: string; body: unknown }> = [];
    const r = await runAutoGenerateTick({ fetchFn: stubFetch(calls), outRoot: OUT1, now: monday });
    check("tick ok", r.ok === true);
    check("week key format", /^\d{4}-W\d{2}$/.test(r.week), r.week);
    check("week key matches helper", r.week === isoWeekKey(monday));
    check("picked the 3 not-done briefs", JSON.stringify(r.briefs) === JSON.stringify(["b2", "b3", "b4"]), JSON.stringify(r.briefs));
    check("skipped 1 already-done brief", r.skipped === 1, String(r.skipped));
    // 3 briefs x (product + toolkit + thumbnail) = 9, + 7 supporting = 16.
    check("16 fires (9 brief + 7 supporting)", r.triggered === 16, `triggered=${r.triggered}`);
    check("no failures", r.failed === 0);
    const urls = calls.map((c) => c.url);
    check(
      "product webhooks fired per type",
      urls.some((u) => u.endsWith("/webhook/digital-ebook-generation")) &&
        urls.some((u) => u.endsWith("/webhook/digital-planners-generation")) &&
        urls.some((u) => u.endsWith("/webhook/digital-spreadsheets-generation"))
    );
    check(
      "companions fired (toolkit + thumbnail)",
      urls.filter((u) => u.endsWith("/webhook/digital-marketing-toolkit-generation")).length === 3 &&
        urls.filter((u) => u.endsWith("/webhook/digital-thumbnails-generation")).length === 3
    );
    check(
      "supporting rotation fired (pod/prompts/landing/docs/brand/typography)",
      ["digital-pod-generation", "digital-prompts-generation", "digital-landing-generation", "digital-docs-generation", "digital-brand-kit-generation", "digital-typography-kit-generation"].every((w) =>
        urls.some((u) => u.endsWith(`/webhook/${w}`))
      )
    );
    check("website-template NEVER fired (disabled)", !urls.some((u) => u.includes("website-template")));
    const ebookCall = calls.find((c) => c.url.endsWith("/webhook/digital-ebook-generation"));
    check("ebook body carries topic + title", (ebookCall?.body as { topic?: string }).topic === "budget");
    const sheetCall = calls.find((c) => c.url.endsWith("/webhook/digital-spreadsheets-generation"));
    check("spreadsheet body carries title + kind", (sheetCall?.body as { kind?: string }).kind === "onboarding", JSON.stringify(sheetCall?.body));
    const saved = JSON.parse(readFileSync(ledgerPath(OUT1), "utf-8")) as AutoGenerateLedger;
    check("ledger written with 17 entries (1 old + 16 new)", saved.entries.length === 17, String(saved.entries.length));

    // Same-week re-run: nothing left to do.
    const calls2: Array<{ url: string; body: unknown }> = [];
    const r2 = await runAutoGenerateTick({ fetchFn: stubFetch(calls2), outRoot: OUT1, now: monday });
    check("same-week re-run fires nothing", r2.triggered === 0 && r2.fires.length === 0, `triggered=${r2.triggered}`);

    // Next week with a new top brief: 1 brief x 3 + 7 supporting = 10.
    const briefs2 = [...briefs, brief("b5", "template", "wedding", 95)];
    writeBriefs(OUT1, briefs2);
    const calls3: Array<{ url: string; body: unknown }> = [];
    const r3 = await runAutoGenerateTick({ fetchFn: stubFetch(calls3), outRoot: OUT1, now: nextMonday });
    check("next week picks the new brief", JSON.stringify(r3.briefs) === JSON.stringify(["b5"]), JSON.stringify(r3.briefs));
    check("next week fires 10 (3 + 7 supporting)", r3.triggered === 10, `triggered=${r3.triggered}`);
  }

  // --- Failure case: a failed supporting fire is recorded, retried next week. ---
  {
    writeBriefs(OUT2, [brief("c1", "template", "wedding", 90)]);
    const calls: Array<{ url: string; body: unknown }> = [];
    const r = await runAutoGenerateTick({ fetchFn: stubFetch(calls, "digital-pod-generation"), outRoot: OUT2, now: monday });
    check("failed fire counted, not faked", r.triggered === 9 && r.failed === 1, `triggered=${r.triggered} failed=${r.failed}`);
    const podEntry = r.fires.find((f) => f.productType === "pod");
    check("pod entry status failed with note", podEntry?.status === "failed" && (podEntry?.note ?? "").length > 0);
    const calls2: Array<{ url: string; body: unknown }> = [];
    const r2 = await runAutoGenerateTick({ fetchFn: stubFetch(calls2), outRoot: OUT2, now: nextMonday });
    check("next week retries the failed pod (7 supporting)", r2.triggered === 7, `triggered=${r2.triggered}`);
    check("pod refired next week", r2.fires.some((f) => f.productType === "pod" && f.status === "triggered"));
  }

  // --- No briefs / no env: honest reasons, nothing fired. ---
  {
    const calls: Array<{ url: string; body: unknown }> = [];
    const r = await runAutoGenerateTick({ fetchFn: stubFetch(calls), outRoot: "/tmp/digital-auto-generate-test-empty", now: monday });
    check("no briefs file -> ok:false no_briefs", r.ok === false && r.reason === "no_briefs");
    check("no briefs -> nothing fired", calls.length === 0);
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
    writeBriefs("/tmp/digital-auto-generate-test-empty", [brief("d1", "template", "wedding", 90)]);
    const calls2: Array<{ url: string; body: unknown }> = [];
    const r2 = await runAutoGenerateTick({ fetchFn: stubFetch(calls2), outRoot: "/tmp/digital-auto-generate-test-empty", now: monday });
    check("no n8n env -> ok:false webhook_unavailable", r2.ok === false && r2.reason === "webhook_unavailable");
    check("no env -> nothing fired", calls2.length === 0);
    process.env.N8N_BASE_URL = "http://n8n:5678";
    process.env.N8N_WEBHOOK_SECRET = "test-secret";
  }

  // --- Workflow JSON: Mon 08:00 IST tick. ---
  {
    const wf = JSON.parse(readFileSync("n8n/workflows/digital-auto-generate.json", "utf-8")) as {
      nodes: { name: string; parameters: { rule?: { interval?: { cronExpression?: string }[] }; url?: string } }[];
    };
    const sched = wf.nodes.find((n) => n.name === "schedule-trigger");
    check("workflow cron is Mon 02:30 UTC (08:00 IST)", sched?.parameters.rule?.interval?.[0]?.cronExpression === "30 2 * * 1");
    const tick = wf.nodes.find((n) => n.name === "tick");
    check("tick node posts to the tick endpoint", (tick?.parameters.url ?? "").includes("/api/v1/digital/auto-generate/tick"));
    check("workflow file exists", existsSync("n8n/workflows/digital-auto-generate.json"));
  }

  if (savedBase === undefined) delete process.env.N8N_BASE_URL;
  else process.env.N8N_BASE_URL = savedBase;
  if (savedSecret === undefined) delete process.env.N8N_WEBHOOK_SECRET;
  else process.env.N8N_WEBHOOK_SECRET = savedSecret;

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-AUTO-GENERATE TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
