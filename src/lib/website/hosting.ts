/**
 * Static-site hosting: pluggable deploy targets for the generated catalogue.
 *
 * The catalogue generator (catalogue.ts) is host-agnostic — it writes a
 * static site into any directory. This module is the deploy layer: it
 * publishes those files to independent free static hosts so the shop
 * window never depends on a single machine or provider:
 *
 *  - oracle-caddy   primary: files already on the VM, served by Caddy
 *                   (handled by the deploy script, not this module).
 *  - github-pages   free, custom domains supported.
 *  - cloudflare-pages free tier, custom domains supported.
 *  - netlify        free tier.
 *  - vercel         free tier.
 *
 * Every host is env-gated: unconfigured hosts report `not_configured`
 * honestly (never a fake success). Tokens live only in the deploy-time
 * .env — never in chat, never in code. A host failure is a typed result,
 * so one dead host never blocks the others.
 */
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, sep } from "path";
import { requireEnv } from "../providers/types";

export interface SiteFile {
  /** Site-relative path, always starting with "/". */
  path: string;
  content: Buffer;
  contentType: string;
}

export type HostDeployStatus = "deployed" | "not_configured" | "failed";

export interface HostDeployResult {
  host: string;
  ok: boolean;
  status: HostDeployStatus;
  url?: string;
  detail: string;
}

export interface StaticHost {
  key: string;
  name: string;
  isConfigured(): boolean;
  deploy(files: SiteFile[]): Promise<HostDeployResult>;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

/** Recursively collect a generated site directory into deployable files. */
export function collectSiteFiles(dir: string): SiteFile[] {
  const out: SiteFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = "/" + relative(dir, full).split(sep).join("/");
        out.push({
          path: rel,
          content: readFileSync(full),
          contentType: MIME[extname(name).toLowerCase()] ?? "application/octet-stream",
        });
      }
    }
  };
  walk(dir);
  return out;
}

function sha1Hex(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

function failed(host: string, detail: string): HostDeployResult {
  return { host, ok: false, status: "failed", detail };
}
function notConfigured(host: string, missing: string): HostDeployResult {
  return { host, ok: false, status: "not_configured", detail: `Missing ${missing} in .env — host skipped.` };
}

/* ------------------------------------------------------------------ */
/* GitHub Pages — Git Data API (blobs → tree → commit → ref)           */
/* ------------------------------------------------------------------ */

const githubPages: StaticHost = {
  key: "github-pages",
  name: "GitHub Pages",
  isConfigured: () => requireEnv("GITHUB_TOKEN") !== null && requireEnv("GITHUB_PAGES_REPO") !== null,
  async deploy(files) {
    const token = requireEnv("GITHUB_TOKEN");
    const repo = requireEnv("GITHUB_PAGES_REPO");
    if (!token || !repo) return notConfigured(this.key, "GITHUB_TOKEN / GITHUB_PAGES_REPO");
    const branch = process.env.GITHUB_PAGES_BRANCH || "gh-pages";
    const api = `https://api.github.com/repos/${repo}`;
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    };
    try {
      const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      for (const f of files) {
        const res = await fetch(`${api}/git/blobs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: f.content.toString("base64"), encoding: "base64" }),
        });
        if (!res.ok) return failed(this.key, `blob upload failed for ${f.path}: http=${res.status}`);
        const blob = (await res.json()) as { sha: string };
        tree.push({ path: f.path.replace(/^\//, ""), mode: "100644", type: "blob", sha: blob.sha });
      }
      const treeRes = await fetch(`${api}/git/trees`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tree }),
      });
      if (!treeRes.ok) return failed(this.key, `tree create failed: http=${treeRes.status}`);
      const treeObj = (await treeRes.json()) as { sha: string };

      const refRes = await fetch(`${api}/git/ref/heads/${branch}`, { headers });
      const parents: string[] = [];
      if (refRes.ok) {
        const refObj = (await refRes.json()) as { object: { sha: string } };
        parents.push(refObj.object.sha);
      }
      const commitRes = await fetch(`${api}/git/commits`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: `Deploy catalogue ${new Date().toISOString()}`,
          tree: treeObj.sha,
          parents,
        }),
      });
      if (!commitRes.ok) return failed(this.key, `commit failed: http=${commitRes.status}`);
      const commit = (await commitRes.json()) as { sha: string };

      if (parents.length > 0) {
        const upd = await fetch(`${api}/git/refs/heads/${branch}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ sha: commit.sha }),
        });
        if (!upd.ok) return failed(this.key, `ref update failed: http=${upd.status}`);
      } else {
        const create = await fetch(`${api}/git/refs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
        });
        if (!create.ok) return failed(this.key, `ref create failed: http=${create.status}`);
      }
      const [owner, name] = repo.split("/");
      return {
        host: this.key,
        ok: true,
        status: "deployed",
        url: `https://${owner}.github.io/${name}/`,
        detail: `${files.length} files committed to ${branch}.`,
      };
    } catch (err) {
      return failed(this.key, `GitHub Pages deploy threw: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Cloudflare Pages — Direct Upload API                                */
/* Hash per Wrangler's documented approach: sha256(base64(content) +   */
/* extension), hex, first 32 chars. First live deploy confirms it —    */
/* a mismatch returns a typed API failure here, never a fake success.  */
/* ------------------------------------------------------------------ */

export function cloudflareAssetHash(content: Buffer, path: string): string {
  const ext = extname(path).replace(/^\./, "");
  return createHash("sha256").update(content.toString("base64") + ext).digest("hex").slice(0, 32);
}

const cloudflarePages: StaticHost = {
  key: "cloudflare-pages",
  name: "Cloudflare Pages",
  isConfigured: () =>
    requireEnv("CLOUDFLARE_API_TOKEN") !== null &&
    requireEnv("CLOUDFLARE_ACCOUNT_ID") !== null &&
    requireEnv("CLOUDFLARE_PAGES_PROJECT") !== null,
  async deploy(files) {
    const token = requireEnv("CLOUDFLARE_API_TOKEN");
    const account = requireEnv("CLOUDFLARE_ACCOUNT_ID");
    const project = requireEnv("CLOUDFLARE_PAGES_PROJECT");
    if (!token || !account || !project) {
      return notConfigured(this.key, "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_PAGES_PROJECT");
    }
    const cf = "https://api.cloudflare.com/client/v4";
    const auth = { authorization: `Bearer ${token}` };
    try {
      const jwtRes = await fetch(`${cf}/accounts/${account}/pages/projects/${project}/upload-token`, { headers: auth });
      if (!jwtRes.ok) return failed(this.key, `upload-token failed: http=${jwtRes.status}`);
      const jwtBody = (await jwtRes.json()) as { result?: { jwt?: string } };
      const jwt = jwtBody.result?.jwt;
      if (!jwt) return failed(this.key, "upload-token returned no JWT.");
      const assetAuth = { authorization: `Bearer ${jwt}`, "content-type": "application/json" };

      const byHash = new Map(files.map((f) => [cloudflareAssetHash(f.content, f.path), f]));
      const checkRes = await fetch(`${cf}/pages/assets/check-missing`, {
        method: "POST",
        headers: assetAuth,
        body: JSON.stringify({ hashes: [...byHash.keys()] }),
      });
      if (!checkRes.ok) return failed(this.key, `check-missing failed: http=${checkRes.status}`);
      const checkBody = (await checkRes.json()) as { result?: string[] };
      const missing = checkBody.result ?? [...byHash.keys()];

      if (missing.length > 0) {
        const payload = missing
          .map((h) => byHash.get(h))
          .filter((f): f is SiteFile => f !== undefined)
          .map((f) => ({
            key: cloudflareAssetHash(f.content, f.path),
            value: f.content.toString("base64"),
            base64: true,
            metadata: { contentType: f.contentType },
          }));
        const upRes = await fetch(`${cf}/pages/assets/upload`, {
          method: "POST",
          headers: assetAuth,
          body: JSON.stringify(payload),
        });
        if (!upRes.ok) return failed(this.key, `asset upload failed: http=${upRes.status}`);
      }

      const manifest: Record<string, string> = {};
      for (const [hash, f] of byHash) manifest[f.path] = hash;
      const form = new FormData();
      form.append("manifest", JSON.stringify(manifest));
      form.append("branch", "main");
      const depRes = await fetch(`${cf}/accounts/${account}/pages/projects/${project}/deployments`, {
        method: "POST",
        headers: auth,
        body: form,
      });
      if (!depRes.ok) return failed(this.key, `deployment create failed: http=${depRes.status}`);
      const depBody = (await depRes.json()) as { result?: { url?: string } };
      return {
        host: this.key,
        ok: true,
        status: "deployed",
        url: depBody.result?.url ?? `https://${project}.pages.dev`,
        detail: `${files.length} files (${missing.length} newly uploaded).`,
      };
    } catch (err) {
      return failed(this.key, `Cloudflare Pages deploy threw: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Netlify — deploy by SHA-1 file digests                              */
/* ------------------------------------------------------------------ */

const netlify: StaticHost = {
  key: "netlify",
  name: "Netlify",
  isConfigured: () => requireEnv("NETLIFY_AUTH_TOKEN") !== null && requireEnv("NETLIFY_SITE_ID") !== null,
  async deploy(files) {
    const token = requireEnv("NETLIFY_AUTH_TOKEN");
    const siteId = requireEnv("NETLIFY_SITE_ID");
    if (!token || !siteId) return notConfigured(this.key, "NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID");
    const api = "https://api.netlify.com/api/v1";
    const auth = { authorization: `Bearer ${token}` };
    try {
      const digests: Record<string, string> = {};
      for (const f of files) digests[f.path] = sha1Hex(f.content);
      const depRes = await fetch(`${api}/sites/${siteId}/deploys`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ files: digests }),
      });
      if (!depRes.ok) return failed(this.key, `deploy create failed: http=${depRes.status}`);
      const dep = (await depRes.json()) as { id: string; required?: string[]; ssl_url?: string; url?: string };
      const required = new Set(dep.required ?? []);
      for (const f of files) {
        if (!required.has(digests[f.path])) continue;
        const put = await fetch(`${api}/deploys/${dep.id}/files${f.path}`, {
          method: "PUT",
          headers: { ...auth, "content-type": "application/octet-stream" },
          body: new Uint8Array(f.content),
        });
        if (!put.ok) return failed(this.key, `file upload failed for ${f.path}: http=${put.status}`);
      }
      return {
        host: this.key,
        ok: true,
        status: "deployed",
        url: dep.ssl_url ?? dep.url,
        detail: `${files.length} files, ${required.size} uploaded.`,
      };
    } catch (err) {
      return failed(this.key, `Netlify deploy threw: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Vercel — file upload by SHA-1 digest, then deployment               */
/* ------------------------------------------------------------------ */

const vercel: StaticHost = {
  key: "vercel",
  name: "Vercel",
  isConfigured: () => requireEnv("VERCEL_TOKEN") !== null && requireEnv("VERCEL_PROJECT") !== null,
  async deploy(files) {
    const token = requireEnv("VERCEL_TOKEN");
    const project = requireEnv("VERCEL_PROJECT");
    if (!token || !project) return notConfigured(this.key, "VERCEL_TOKEN / VERCEL_PROJECT");
    const teamId = process.env.VERCEL_TEAM_ID;
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    const auth = { authorization: `Bearer ${token}` };
    try {
      const fileRefs: Array<{ file: string; sha: string }> = [];
      for (const f of files) {
        const sha = sha1Hex(f.content);
        const up = await fetch(`https://api.vercel.com/v2/files${qs}`, {
          method: "POST",
          headers: { ...auth, "x-vercel-digest": sha, "content-type": "application/octet-stream" },
          body: new Uint8Array(f.content),
        });
        if (!up.ok) return failed(this.key, `file upload failed for ${f.path}: http=${up.status}`);
        fileRefs.push({ file: f.path.replace(/^\//, ""), sha });
      }
      const depRes = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ name: project, project, files: fileRefs, target: "production" }),
      });
      if (!depRes.ok) return failed(this.key, `deployment create failed: http=${depRes.status}`);
      const dep = (await depRes.json()) as { url?: string };
      return {
        host: this.key,
        ok: true,
        status: "deployed",
        url: dep.url ? `https://${dep.url}` : undefined,
        detail: `${files.length} files uploaded.`,
      };
    } catch (err) {
      return failed(this.key, `Vercel deploy threw: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  },
};

/** All alternative hosts (primary Oracle/Caddy is the deploy script's job). */
export const STATIC_HOSTS: StaticHost[] = [githubPages, cloudflarePages, netlify, vercel];

/**
 * Deploy the site files to every configured alternative host.
 * Unconfigured hosts are reported as not_configured (never dropped
 * silently, never faked). Hosts run sequentially to stay gentle on
 * free-tier rate limits.
 */
export async function deployToConfiguredHosts(files: SiteFile[]): Promise<HostDeployResult[]> {
  const results: HostDeployResult[] = [];
  for (const host of STATIC_HOSTS) {
    if (!host.isConfigured()) {
      results.push(notConfigured(host.key, "its .env settings"));
      continue;
    }
    results.push(await host.deploy(files));
  }
  return results;
}
