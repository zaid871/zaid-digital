/**
 * Free 3D model arranger — keyword in, curated CC0/CC-BY GLB pack out.
 *
 * No 3D model generator exists anywhere in our stack, and none can be
 * built free — but the models themselves can be ARRANGED for free:
 * Poly Pizza hosts the archived Google Poly catalog + community uploads
 * with a no-key search API. Each model carries a per-model licence
 * (CC0 1.0 or CC-BY 3.0) and a creator — both are recorded in the
 * manifest, and CC-BY models keep their attribution (that is the
 * licence condition for commercial use).
 *
 * How it works (all verified live 2026-11-08):
 *   1. GET https://poly.pizza/api/search/<keyword> (no key, JSON)
 *      -> results: title, creator.username, licence, previewUrl, url
 *   2. GLB URL = previewUrl stem + ".glb" (same UUID; verified: the
 *      downloaded file starts with the "glTF" magic, version 2).
 *      Fallback: fetch the model page and extract the static.poly.pizza
 *      .glb link from its HTML.
 *   3. Every download is verified (glTF magic + non-empty) — a bad
 *      file is skipped with a warning, never shipped.
 *
 * Run: npx tsx scripts/arrange-free-3d.ts <keyword> [count]
 * Library: import { arrangeFree3d } from "./arrange-free-3d";
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "../src/lib/digital/package";

export interface ArrangedModel {
  title: string;
  creator: string;
  licence: string;
  sourceUrl: string;
  file: string;
}

export interface Arrange3dResult {
  keyword: string;
  slug: string;
  dir: string;
  models: ArrangedModel[];
  files: { manifest: string; zip: string | null };
  warnings: string[];
}

interface SearchResult {
  title?: string;
  creator?: { username?: string };
  licence?: string;
  previewUrl?: string;
  url?: string;
  publicID?: string;
}

function glbFromPreview(previewUrl: string): string | null {
  if (!previewUrl.startsWith("https://static.poly.pizza/")) return null;
  return previewUrl.replace(/\.[a-z0-9]+$/i, ".glb");
}

async function downloadGlb(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Muse-arrange-3d/1.0" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20 || buf.subarray(0, 4).toString() !== "glTF") return null;
    return buf;
  } catch {
    return null;
  }
}

async function glbFromModelPage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, { headers: { "User-Agent": "Muse-arrange-3d/1.0" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/https:\/\/static\.poly\.pizza\/[a-z0-9-]+\.glb/i);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export async function arrangeFree3d(
  keyword: string,
  count = 5,
  deps?: { outRoot?: string }
): Promise<Arrange3dResult> {
  const kw = keyword.trim();
  if (kw.length < 2) throw new Error("arrange-free-3d needs a keyword (min 2 chars).");
  const want = Math.min(10, Math.max(1, count));
  const warnings: string[] = [];

  const searchRes = await fetch(`https://poly.pizza/api/search/${encodeURIComponent(kw)}`, {
    headers: { Accept: "application/json", "User-Agent": "Muse-arrange-3d/1.0" },
  });
  if (!searchRes.ok) {
    throw new Error(`Poly Pizza search failed (HTTP ${searchRes.status}) — no models arranged.`);
  }
  const data = (await searchRes.json()) as { results?: SearchResult[] };
  const results = (data.results ?? []).filter((r) => r.previewUrl && r.title);
  if (results.length === 0) {
    throw new Error(`Poly Pizza returned no models for "${kw}" — no models arranged.`);
  }
  // CC0 first (no attribution needed), then CC-BY (attribution recorded).
  const sorted = [...results].sort((a, b) => {
    const score = (r: SearchResult) => (r.licence === "CC0 1.0" ? 0 : 1);
    return score(a) - score(b);
  });

  const slug = slugify(`3d-${kw}`);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  const models: ArrangedModel[] = [];
  for (const r of sorted) {
    if (models.length >= want) break;
    const title = String(r.title ?? "model").trim();
    const creator = String(r.creator?.username ?? "unknown").trim();
    const licence = String(r.licence ?? "unknown").trim();
    const sourceUrl = `https://poly.pizza${r.url ?? ""}`;
    let buf: Buffer | null = null;
    const direct = glbFromPreview(String(r.previewUrl));
    if (direct) buf = await downloadGlb(direct);
    if (!buf && r.url) {
      const pageGlb = await glbFromModelPage(sourceUrl);
      if (pageGlb) buf = await downloadGlb(pageGlb);
    }
    if (!buf) {
      warnings.push(`download_failed: "${title}" (${licence}) — GLB verify nahi hua, skip kiya`);
      continue;
    }
    const file = `${slugify(title) || "model"}-${models.length + 1}.glb`;
    await writeFile(join(dir, file), buf);
    models.push({ title, creator, licence, sourceUrl, file });
  }
  if (models.length === 0) {
    throw new Error(`No verifiable GLB downloads for "${kw}" — nothing arranged.`);
  }

  const manifestPath = await writeManifest(dir, {
    type: "free_3d_pack",
    keyword: kw,
    source: "Poly Pizza (poly.pizza) — archived Google Poly catalog + community uploads",
    models,
    attribution: models
      .filter((m) => m.licence.startsWith("CC-BY"))
      .map((m) => `"${m.title}" by ${m.creator} (${m.licence}) — ${m.sourceUrl}`),
    deliveryNotes: [
      "Models are ARRANGED, not generated — they come from Poly Pizza under their per-model licences.",
      "CC0 models need no attribution. CC-BY models MUST credit the creator (see attribution list) when used commercially.",
      "Every .glb was verified (glTF magic bytes) before shipping.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return { keyword: kw, slug, dir, models, files: { manifest: manifestPath, zip: zipPath }, warnings };
}

async function main() {
  const [keyword, countArg] = process.argv.slice(2);
  if (!keyword) {
    console.error("Usage: npx tsx scripts/arrange-free-3d.ts <keyword> [count]");
    process.exit(1);
  }
  const r = await arrangeFree3d(keyword, countArg ? Number(countArg) : 5);
  console.log(`Arranged ${r.models.length} model(s) for "${r.keyword}" in ${r.dir}`);
  for (const m of r.models) console.log(`  - ${m.file} (${m.title} by ${m.creator}, ${m.licence})`);
  if (r.warnings.length) for (const w of r.warnings) console.log(`WARN  ${w}`);
  console.log(`zip: ${r.files.zip ?? "(none)"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
