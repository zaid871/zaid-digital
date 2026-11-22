/**
 * Manual promote tests — no live n8n: the webhook forward is stubbed.
 * Env paths point at /tmp so the real promotions file is untouched.
 */
process.env.MARKETING_PROMOTIONS_PATH = "/tmp/manual-promote-test.json";
process.env.N8N_BASE_URL = "http://n8n.test";
process.env.N8N_WEBHOOK_SECRET = "test-secret";

import { rm, readFile } from "fs/promises";
import {
  validatePromoteUrl, buildWebhookPayload, promote, listPromotions,
  type FetchFn,
} from "../src/lib/marketing/promote";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

// --- URL validation (first gate) ---
check("good https URL ok", validatePromoteUrl("https://meri-dukaan.com/ebook").ok === true);
check("http URL ok", validatePromoteUrl("http://example.com/page").ok === true);
check("ftp rejected", validatePromoteUrl("ftp://example.com/file").ok === false);
check("localhost rejected", validatePromoteUrl("http://localhost:3000/admin").ok === false);
check("127.0.0.1 rejected", validatePromoteUrl("http://127.0.0.1:5678/").ok === false);
check("192.168.x rejected", validatePromoteUrl("http://192.168.1.5/").ok === false);
check("10.x rejected", validatePromoteUrl("http://10.0.0.5/").ok === false);
check("no protocol rejected", validatePromoteUrl("meri-dukaan.com").ok === false);

// --- webhook payload mapping ---
{
  const p = buildWebhookPayload({ url: "https://meri-dukaan.com/", title: "Meri Dukaan" });
  check("payload defaults productType website", p.productType === "website");
  check("payload productName from title", p.productName === "Meri Dukaan");
  check("payload productLink is the URL", p.productLink === "https://meri-dukaan.com/");
  check("payload publish defaults true", p.publish === true);
  check("payload duration defaults 45", p.durationSeconds === 45);
  const p2 = buildWebhookPayload({ url: "https://x.com/", durationSeconds: 5 });
  check("payload duration clamps to 15", p2.durationSeconds === 15);
  const p3 = buildWebhookPayload({ url: "https://x.com/", durationSeconds: 300 });
  check("payload duration clamps to 180", p3.durationSeconds === 180);
  const p4 = buildWebhookPayload({ url: "https://x.com/", productType: "ebook", publish: false, platforms: ["pinterest", "x"] });
  check("payload keeps ebook + publish false + platforms", p4.productType === "ebook" && p4.publish === false && JSON.stringify(p4.platforms) === JSON.stringify(["pinterest", "x"]));
}

// --- workflow JSON: the three surgical edits are present ---
async function main() {
  const wf = JSON.parse(await readFile("n8n/workflows/digital-ads-marketing.json", "utf-8")) as {
    nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
  };
  const code = (name: string) => wf.nodes.find((n) => n.name === name)?.parameters.jsCode ?? "";
  check("workflow validate-input allows website", code("validate-input").includes("'website'"));
  check("workflow publish category has website", code("build-publish-payload").includes("website: 'website'"));
  check("workflow reels path respects publish=false", code("build-reels-payload").includes("publish_disabled"));

  await rm("/tmp/manual-promote-test.json", { force: true });

  // --- forward succeeds -> started ---
  const lastReq: { current: { url: string; headers: Record<string, string>; body: string } | null } = { current: null };
  const okFetch = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    lastReq.current = { url, headers: init?.headers ?? {}, body: String(init?.body ?? "") };
    return { ok: true, status: 200 };
  }) as unknown as FetchFn;

  const r1 = await promote(
    { url: "https://meri-dukaan.com/", title: "Meri Dukaan", productType: "website", publish: true },
    { fetchFn: okFetch }
  );
  check("forward ok -> started", r1.promotion.status === "started" && r1.forwarded === true);
  check("forward hits the ads-marketing webhook", lastReq.current?.url === "http://n8n.test/webhook/digital-ads-marketing");
  check("forward carries x-n8n-secret", lastReq.current?.headers["x-n8n-secret"] === "test-secret");
  const sentBody = JSON.parse(lastReq.current?.body ?? "{}") as Record<string, unknown>;
  check("forward body is the webhook payload", sentBody.productType === "website" && sentBody.productName === "Meri Dukaan" && sentBody.productLink === "https://meri-dukaan.com/");

  // --- forward fails (n8n 500) -> queued, nothing faked ---
  const failFetch = (async () => ({ ok: false, status: 500 })) as unknown as FetchFn;
  const r2 = await promote(
    { url: "https://doosri-dukaan.com/", title: "Doosri Dukaan" },
    { fetchFn: failFetch }
  );
  check("n8n 500 -> queued", r2.promotion.status === "queued" && r2.forwarded === false);
  check("queued note names the HTTP status", r2.promotion.note.includes("500"));

  // --- forward throws (n8n down) -> queued ---
  const throwFetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as FetchFn;
  const r3 = await promote(
    { url: "https://teesri-dukaan.com/", title: "Teesri Dukaan" },
    { fetchFn: throwFetch }
  );
  check("n8n down -> queued", r3.promotion.status === "queued" && r3.forwarded === false);

  // --- env missing -> queued with env note ---
  delete process.env.N8N_BASE_URL;
  const r4 = await promote({ url: "https://chauthi-dukaan.com/", title: "Chauthi Dukaan" }, { fetchFn: okFetch });
  check("no N8N_BASE_URL -> queued", r4.promotion.status === "queued" && r4.promotion.note.includes("N8N_BASE_URL"));
  process.env.N8N_BASE_URL = "http://n8n.test";

  // --- history round-trips, newest first, capped ---
  const list = await listPromotions();
  check("history has all 4 promotions", list.length === 4);
  check("history newest first", list[0]?.title === "Chauthi Dukaan");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL MANUAL-PROMOTE TESTS PASSED");
}

main();
