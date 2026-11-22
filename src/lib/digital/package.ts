/**
 * Shared packaging helpers for digital products (ebooks + template packs):
 * storage root, slugs, manifest, optional zip. Zip is best-effort — when
 * the `zip` binary is unavailable the product folder + manifest are still
 * the deliverable and the caller records a warning (never a fake zip).
 */
import { execFile } from "child_process";
import { writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Root folder for generated digital products. */
export function digitalRoot(): string {
  return process.env.DIGITAL_DIR || join(process.cwd(), "storage", "digital");
}

/** Filesystem-safe slug from any title/topic text. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "item";
}

/** Unique product directory name: <slug>-<base36 timestamp>. */
export function productDirName(slug: string): string {
  return `${slug}-${Date.now().toString(36)}`;
}

/** Write manifest.json into the product directory. Returns its path. */
export async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<string> {
  const path = join(dir, "manifest.json");
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
  return path;
}

/**
 * Zip the product directory next to itself (<dir>.zip). Returns the zip
 * path, or null when zipping is unavailable/failed — callers surface that
 * as a warning instead of pretending a zip exists.
 */
export async function zipDirectory(dir: string): Promise<string | null> {
  const zipPath = join(dirname(dir), `${basename(dir)}.zip`);
  try {
    await execFileAsync("zip", ["-r", "-q", zipPath, "."], { cwd: dir, timeout: 120_000 });
    return zipPath;
  } catch {
    return null;
  }
}
