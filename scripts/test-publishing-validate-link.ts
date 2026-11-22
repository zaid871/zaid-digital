/**
 * Link validation tests: reachability, HEAD->GET fallback, SSRF gate
 * (localhost/private never fetched), and failure modes.
 * Run: npx tsx scripts/test-publishing-validate-link.ts
 */
import { checkLink, isPrivateHostname, type FetchFn } from "../src/lib/publishing/validate-link";

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

async function main() {
  check("localhost is private", isPrivateHostname("localhost"));
  check("127.0.0.1 is private", isPrivateHostname("127.0.0.1"));
  check("10.x is private", isPrivateHostname("10.0.0.5"));
  check("192.168.x is private", isPrivateHostname("192.168.1.1"));
  check("172.16-31 is private", isPrivateHostname("172.20.0.1"));
  check("172.32 is public", !isPrivateHostname("172.32.0.1"));
  check("public host is not private", !isPrivateHostname("example.com"));
  check(".local is private", isPrivateHostname("n8n.local"));

  let calls = 0;
  const stubFetch = (async (url: string | URL, init?: RequestInit) => {
    calls += 1;
    const u = String(url);
    if (u.includes("ok.example.com")) return new Response("", { status: 200 });
    if (u.includes("gone.example.com")) return new Response("", { status: 404 });
    if (u.includes("headless.example.com")) {
      if (init?.method === "HEAD") return new Response("", { status: 405 });
      return new Response("", { status: 200 });
    }
    throw new Error("network down");
  }) as unknown as FetchFn;

  {
    const r = await checkLink("https://ok.example.com/product", stubFetch);
    check("200 -> reachable", r.reachable === true && r.status === 200, JSON.stringify(r));
  }
  {
    const r = await checkLink("https://gone.example.com/product", stubFetch);
    check("404 -> not reachable", r.reachable === false && r.status === 404, JSON.stringify(r));
  }
  {
    calls = 0;
    const r = await checkLink("https://headless.example.com/product", stubFetch);
    check("HEAD 405 -> GET fallback reaches", r.reachable === true && calls === 2, JSON.stringify(r));
  }
  {
    calls = 0;
    const r = await checkLink("http://localhost:5678/webhook/x", stubFetch);
    check("localhost never fetched", r.reachable === false && calls === 0, JSON.stringify(r));
  }
  {
    calls = 0;
    const r = await checkLink("http://192.168.1.10/admin", stubFetch);
    check("private IP never fetched", r.reachable === false && calls === 0, JSON.stringify(r));
  }
  {
    const r = await checkLink("not a url", stubFetch);
    check("unparseable URL -> not reachable", r.reachable === false && r.status === null, JSON.stringify(r));
  }
  {
    const r = await checkLink("ftp://example.com/file", stubFetch);
    check("non-http(s) -> not reachable", r.reachable === false, JSON.stringify(r));
  }
  {
    const r = await checkLink("https://down.example.com/", stubFetch);
    check("fetch throws -> not reachable", r.reachable === false, JSON.stringify(r));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
