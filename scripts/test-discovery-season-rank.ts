/**
 * Season-rank route tests: auth, validation, and the ranked mapping.
 * The expected order is computed with the same seasons lib (so the test
 * holds in any month), and the route must match it exactly.
 * Run: npx tsx scripts/test-discovery-season-rank.ts
 */
import { POST } from "../src/app/api/v1/discovery/season-rank/route";
import { rankWithSeason } from "../src/lib/digital/seasons";

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

process.env.N8N_WEBHOOK_SECRET = "test-secret";

function req(body: unknown, secret?: string): Request {
  return new Request("http://localhost/api/v1/discovery/season-rank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret !== undefined ? { "x-n8n-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const products = [
    { title: "Fitness workout log", category: "fitness", description: "Daily workout tracker" },
    { title: "Wedding invitation pack", category: "wedding", description: "Shaadi invite templates" },
    { title: "Budget tracker", category: "finance", description: "Monthly budget sheet" },
  ];
  {
    const res = await POST(req({ products }, "test-secret"));
    const body = (await res.json()) as {
      ok: boolean;
      data?: { products: Array<{ title: string; _seasonScore: number; _seasonId: string | null; _seasonLabel: string | null }> };
    };
    check("authorized call succeeds", res.status === 200 && body.ok === true, `status=${res.status}`);
    const expected = rankWithSeason(
      products.map((p) => ({ product: p, demandScore: 50, text: [p.title, p.category, p.description].filter(Boolean).join(" ") })),
      new Date()
    ).map((r) => r.product.title);
    const got = (body.data?.products ?? []).map((p) => p.title);
    check("route order matches the seasons lib", JSON.stringify(got) === JSON.stringify(expected), `got=${got.join(",")} expected=${expected.join(",")}`);
    const first = body.data?.products[0];
    check("ranked items carry season fields", first != null && typeof first._seasonScore === "number" && "_seasonId" in first && "_seasonLabel" in first, JSON.stringify(first));
    const scores = (body.data?.products ?? []).map((p) => p._seasonScore);
    check("scores are non-increasing", scores.every((s, i) => i === 0 || s <= scores[i - 1]), scores.join(","));
  }
  {
    const res = await POST(req({ products }, "wrong-secret"));
    check("wrong secret -> 401", res.status === 401, `status=${res.status}`);
  }
  {
    const res = await POST(req({ products }));
    check("missing secret -> 401", res.status === 401, `status=${res.status}`);
  }
  {
    const res = await POST(req({ products: "not an array" }, "test-secret"));
    check("bad payload -> 422", res.status === 422, `status=${res.status}`);
  }
  {
    const res = await POST(req({ products: [] }, "test-secret"));
    const body = (await res.json()) as { ok: boolean; data?: { products: unknown[] } };
    check("empty list -> empty ranking", res.status === 200 && body.ok === true && (body.data?.products.length ?? -1) === 0, `status=${res.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
