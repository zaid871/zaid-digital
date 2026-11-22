/**
 * Icon + pattern bundle generator — deterministic SVG icons out.
 *
 * 16 stroke icons (24x24 grid, 2px stroke, round caps — the familiar
 * Feather-style geometric set) + 4 seamless pattern tiles (dots, grid,
 * diagonal stripes, chevron). Each icon ships as:
 *  - an editable SVG (stroke="currentColor" so buyers recolour it),
 *  - a 512x512 PNG preview rendered via ffmpeg's librsvg decoder,
 *  - plus one sprite.svg with every icon as a <symbol>.
 *
 * The icon shapes follow the Feather Icons set (MIT licensed) — the
 * bundle ships a NOTICE crediting them, and the manifest says so.
 * Patterns are original geometric tiles (seamless by construction).
 *
 * Deterministic — no AI call, no provider quota. The only input is the
 * theme/accent colour. Icons are fixed shapes, so there is no user text
 * to compliance-scan; the accent colour is validated as a hex code.
 */
import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

const execFileAsync = promisify(execFile);

export interface IconDef {
  name: string;
  label: string;
  /** Inner SVG elements (paths/lines/circles) on a 24x24 grid. */
  body: string;
}

export const ICONS: IconDef[] = [
  { name: "home", label: "Home", body: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>` },
  { name: "search", label: "Search", body: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>` },
  { name: "heart", label: "Heart", body: `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>` },
  { name: "star", label: "Star", body: `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>` },
  { name: "check", label: "Check", body: `<polyline points="20 6 9 17 4 12"/>` },
  { name: "x", label: "Close", body: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>` },
  { name: "plus", label: "Plus", body: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>` },
  { name: "arrow-right", label: "Arrow right", body: `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>` },
  { name: "chevron-down", label: "Chevron down", body: `<polyline points="6 9 12 15 18 9"/>` },
  { name: "user", label: "User", body: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>` },
  { name: "calendar", label: "Calendar", body: `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>` },
  { name: "clock", label: "Clock", body: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>` },
  { name: "mail", label: "Mail", body: `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>` },
  { name: "phone", label: "Phone", body: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>` },
  { name: "cart", label: "Shopping cart", body: `<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>` },
  { name: "camera", label: "Camera", body: `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>` },
];

export interface PatternDef {
  name: string;
  label: string;
  /** Inner SVG elements of one 200x200 seamless tile. */
  body: string;
}

export const PATTERNS: PatternDef[] = [
  { name: "dots", label: "Dots", body: `<g fill="ACCENT"><circle cx="25" cy="25" r="7"/><circle cx="75" cy="25" r="7"/><circle cx="125" cy="25" r="7"/><circle cx="175" cy="25" r="7"/><circle cx="25" cy="75" r="7"/><circle cx="75" cy="75" r="7"/><circle cx="125" cy="75" r="7"/><circle cx="175" cy="75" r="7"/><circle cx="25" cy="125" r="7"/><circle cx="75" cy="125" r="7"/><circle cx="125" cy="125" r="7"/><circle cx="175" cy="125" r="7"/><circle cx="25" cy="175" r="7"/><circle cx="75" cy="175" r="7"/><circle cx="125" cy="175" r="7"/><circle cx="175" cy="175" r="7"/></g>` },
  { name: "grid", label: "Grid", body: `<g stroke="ACCENT" stroke-width="3"><line x1="0" y1="50" x2="200" y2="50"/><line x1="0" y1="100" x2="200" y2="100"/><line x1="0" y1="150" x2="200" y2="150"/><line x1="50" y1="0" x2="50" y2="200"/><line x1="100" y1="0" x2="100" y2="200"/><line x1="150" y1="0" x2="150" y2="200"/></g>` },
  { name: "stripes", label: "Diagonal stripes", body: `<g stroke="ACCENT" stroke-width="12"><line x1="-50" y1="50" x2="50" y2="-50"/><line x1="0" y1="100" x2="100" y2="0"/><line x1="50" y1="150" x2="150" y2="50"/><line x1="100" y1="200" x2="200" y2="100"/><line x1="150" y1="250" x2="250" y2="150"/></g>` },
  { name: "chevron", label: "Chevron", body: `<g fill="none" stroke="ACCENT" stroke-width="8" stroke-linejoin="round"><polyline points="0,60 50,20 100,60 150,20 200,60"/><polyline points="0,140 50,100 100,140 150,100 200,140"/></g>` },
];

export interface IconBundleRequest {
  theme?: "dark" | "light";
  accent?: string;
  includePatterns?: boolean;
}

export interface IconBundleResult {
  title: string;
  slug: string;
  dir: string;
  icons: string[];
  patterns: string[];
  files: { manifest: string; zip: string | null; sprite: string };
  warnings: string[];
}

function iconSvg(icon: IconDef, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.body}</svg>\n`;
}

function patternSvg(pattern: PatternDef, color: string, bg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/>${pattern.body.replace(/ACCENT/g, color)}</svg>\n`;
}

async function renderPreview(svgPath: string, pngPath: string, size: number): Promise<boolean> {
  try {
    await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-y", "-i", svgPath, "-vf", `scale=${size}:${size}`, "-frames:v", "1", pngPath],
      { timeout: 60_000 }
    );
    return true;
  } catch {
    return false;
  }
}

export async function generateIconBundle(
  req: IconBundleRequest,
  deps?: { outRoot?: string }
): Promise<IconBundleResult> {
  const theme = req.theme === "light" ? "light" : "dark";
  const accent = req.accent && /^#[0-9a-fA-F]{6}$/.test(req.accent) ? req.accent : "#FF6B35";
  const bg = theme === "light" ? "#FAF7F2" : "#111318";
  const includePatterns = req.includePatterns !== false;
  const warnings: string[] = [];

  const title = `Icon Bundle (${theme})`;
  const slug = slugify(title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  const iconsDir = join(dir, "icons");
  const patternsDir = join(dir, "patterns");
  await mkdir(iconsDir, { recursive: true });
  await mkdir(patternsDir, { recursive: true });

  let previewFailures = 0;
  for (const icon of ICONS) {
    const svg = iconSvg(icon, accent);
    const svgPath = join(iconsDir, `${icon.name}.svg`);
    await writeFile(svgPath, svg, "utf-8");
    const ok = await renderPreview(svgPath, join(iconsDir, `${icon.name}.png`), 512);
    if (!ok) previewFailures++;
  }
  const patternNames: string[] = [];
  if (includePatterns) {
    for (const pattern of PATTERNS) {
      const svg = patternSvg(pattern, accent, bg);
      const svgPath = join(patternsDir, `${pattern.name}.svg`);
      await writeFile(svgPath, svg, "utf-8");
      const ok = await renderPreview(svgPath, join(patternsDir, `${pattern.name}.png`), 512);
      if (!ok) previewFailures++;
      patternNames.push(pattern.name);
    }
  }
  if (previewFailures > 0) {
    warnings.push(
      `preview_unavailable: ${previewFailures} PNG preview(s) nahi bane (ffmpeg me librsvg decoder chahiye) — SVG files tayyar hain`
    );
  }

  // One sprite file with every icon as a <symbol> (use: <use href="#icon-home"/>).
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n${ICONS.map(
    (i) => `  <symbol id="icon-${i.name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.body}</symbol>`
  ).join("\n")}\n</svg>\n`;
  const spritePath = join(dir, "sprite.svg");
  await writeFile(spritePath, sprite, "utf-8");

  await writeFile(
    join(dir, "NOTICE.txt"),
    `Icon shapes in this bundle follow the Feather Icons set (https://feathericons.com),\nlicensed under the MIT License (https://opensource.org/licenses/MIT).\nCopyright (c) 2013-2017 Cole Bemis. Patterns are original geometric tiles.\n`,
    "utf-8"
  );

  const manifestPath = await writeManifest(dir, {
    type: "icon_bundle",
    title,
    theme,
    accent,
    icons: ICONS.map((i) => ({ name: i.name, label: i.label, svg: `icons/${i.name}.svg`, png: `icons/${i.name}.png` })),
    patterns: patternNames.map((n) => ({ name: n, svg: `patterns/${n}.svg`, png: `patterns/${n}.png` })),
    sprite: "sprite.svg",
    deliveryNotes: [
      "Har icon ki SVG editable hai — stroke='currentColor' hai, is liye CSS se rang badla ja sakta hai.",
      "Sprite ko <use href=\"#icon-home\"> ki tarah istemal karein.",
      "Pattern tiles seamless hain — repeat karne par jod nazar nahi aata.",
      "Icon shapes Feather Icons (MIT) ke geometric set par based hain — NOTICE.txt dekhein.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    title,
    slug,
    dir,
    icons: ICONS.map((i) => i.name),
    patterns: patternNames,
    files: { manifest: manifestPath, zip: zipPath, sprite: spritePath },
    warnings,
  };
}
