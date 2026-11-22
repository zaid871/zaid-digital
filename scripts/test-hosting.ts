/**
 * Website hosting tests: 4 alternative static hosts with mocked fetch
 * (zero real HTTP) + collectSiteFiles on a real temp dir.
 * Run: npx tsx scripts/test-hosting.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import {
  STATIC_HOSTS,
  cloudflareAssetHash,
  collectSiteFiles,
  deployToConfiguredHosts,
  type SiteFile,
} from "../src/lib/website/hosting";

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

const files: SiteFile[] = [
  { path: "/index.html", content: Buffer.from("<h1>home</h1>"), contentType: "text/html" },
  { path: "/products/p1.html", content: Buffer.from("<h1>p1</h1>"), contentType: "text/html" },
];
const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ENV_KEYS = [
  "GITHUB_TOKEN", "GITHUB_PAGES_REPO", "GITHUB_PAGES_BRANCH",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_PAGES_PROJECT",
  "NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID",
  "VERCEL_TOKEN", "VERCEL_PROJECT", "VERCEL_TEAM_ID",
];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
function setAllEnv() {
  process.env.GITHUB_TOKEN = "t";
  process.env.GITHUB_PAGES_REPO = "owner/shop";
  process.env.CLOUDFLARE_API_TOKEN = "t";
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
  process.env.CLOUDFLARE_PAGES_PROJECT = "shop";
  process.env.NETLIFY_AUTH_TOKEN = "t";
  process.env.NETLIFY_SITE_ID = "site1";
  process.env.VERCEL_TOKEN = "t";
  process.env.VERCEL_PROJECT = "shop";
}

let githubBlobStatus = 200;
(globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? "GET";
  // GitHub
  if (u.includes("api.github.com")) {
    if (u.endsWith("/git/blobs")) return jsonRes({ sha: "blob-sha" }, githubBlobStatus);
    if (u.endsWith("/git/trees")) return jsonRes({ sha: "tree-sha" });
    if (u.includes("/git/ref/heads/")) return jsonRes({ object: { sha: "parent-sha" } });
    if (u.endsWith("/git/commits")) return jsonRes({ sha: "commit-sha" });
    if (u.includes("/git/refs/heads/") && method === "PATCH") return jsonRes({});
    if (u.endsWith("/git/refs")) return jsonRes({});
  }
  // Cloudflare
  if (u.includes("upload-token")) return jsonRes({ result: { jwt: "jwt-1" } });
  if (u.includes("check-missing")) {
    return jsonRes({ result: [cloudflareAssetHash(files[0].content, files[0].path)] });
  }
  if (u.includes("pages/assets/upload")) return jsonRes({ success: true });
  if (u.includes("/deployments") && u.includes("cloudflare")) {
    return jsonRes({ result: { url: "https://shop.pages.dev" } });
  }
  // Netlify
  if (u.includes("api.netlify.com") && u.endsWith("/deploys") && method === "POST") {
    return jsonRes({ id: "dep1", required: [sha1(files[0].content)], ssl_url: "https://shop.netlify.app" });
  }
  if (u.includes("api.netlify.com") && u.includes("/files/")) return jsonRes({});
  // Vercel
  if (u.includes("api.vercel.com/v2/files")) return jsonRes({});
  if (u.includes("api.vercel.com/v13/deployments")) return jsonRes({ url: "shop.vercel.app" });
  return new Response("unmocked: " + u, { status: 500 });
};

function host(key: string) {
  const h = STATIC_HOSTS.find((x) => x.key === key);
  if (!h) throw new Error("host missing: " + key);
  return h;
}

async function main() {
  check("4 alternative hosts registered", STATIC_HOSTS.length === 4);

  // collectSiteFiles on a real temp dir
  {
    const dir = mkdtempSync(join(tmpdir(), "site-"));
    writeFileSync(join(dir, "index.html"), "<h1>x</h1>");
    mkdirSync(join(dir, "products"));
    writeFileSync(join(dir, "products", "p1.html"), "<h1>p</h1>");
    const got = collectSiteFiles(dir);
    check(
      "collectSiteFiles walks + paths + mime",
      got.length === 2 &&
        got.some((f) => f.path === "/index.html" && f.contentType === "text/html") &&
        got.some((f) => f.path === "/products/p1.html"),
      JSON.stringify(got.map((f) => f.path))
    );
  }

  // Unconfigured: all four report honestly
  clearEnv();
  {
    const results = await deployToConfiguredHosts(files);
    check(
      "unconfigured hosts all report not_configured",
      results.length === 4 && results.every((r) => r.status === "not_configured" && !r.ok)
    );
  }

  setAllEnv();

  // GitHub Pages happy path (existing branch → PATCH ref)
  {
    const r = await host("github-pages").deploy(files);
    check("github-pages deploys + pages URL", r.ok && r.url === "https://owner.github.io/shop/", r.detail);
  }
  // GitHub failure is typed, not faked
  {
    githubBlobStatus = 500;
    const r = await host("github-pages").deploy(files);
    check("github-pages 500 → failed result", !r.ok && r.status === "failed");
    githubBlobStatus = 200;
  }
  // Cloudflare Pages happy path (check-missing → upload 1 → deployment)
  {
    const r = await host("cloudflare-pages").deploy(files);
    check("cloudflare-pages deploys", r.ok && (r.url ?? "").includes("pages.dev"), r.detail);
  }
  // Netlify happy path
  {
    const r = await host("netlify").deploy(files);
    check("netlify deploys + ssl url", r.ok && r.url === "https://shop.netlify.app", r.detail);
  }
  // Vercel happy path
  {
    const r = await host("vercel").deploy(files);
    check("vercel deploys + https url", r.ok && r.url === "https://shop.vercel.app", r.detail);
  }
  // All configured at once
  {
    const results = await deployToConfiguredHosts(files);
    check("deployToConfiguredHosts: 4 deployed", results.every((r) => r.ok && r.status === "deployed"), JSON.stringify(results.map((r) => r.status)));
  }
  // Cloudflare hash: stable, 32 hex chars, extension-sensitive
  {
    const h1 = cloudflareAssetHash(Buffer.from("abc"), "/a.html");
    const h2 = cloudflareAssetHash(Buffer.from("abc"), "/a.html");
    const h3 = cloudflareAssetHash(Buffer.from("abc"), "/a.css");
    check("cf hash stable + 32 hex + ext-sensitive", h1 === h2 && /^[0-9a-f]{32}$/.test(h1) && h1 !== h3);
  }

  clearEnv();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL HOSTING TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
