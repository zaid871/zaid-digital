/**
 * Typography-kit generator — kit name in, sellable typography kit out.
 *
 * A complete kit: one specimen sheet (SVG) per font pairing, plus a
 * pairing-guide HTML page (which pairing for what, size scale, do/don't).
 * Pairings use the fonts already arranged for rendering — Poppins,
 * Anton, Fraunces (all OFL) — with their real fontconfig family names
 * ("CVE anton-400" / "CVE fraunces-700" — "Anton" alone falls back to
 * DejaVu; see the 2026-11-10 Nafay build).
 *
 * LICENCE BOUNDARY: font files are NEVER included and never sold
 * standalone (OFL — render use only). The kit sells specimens + guide.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { DigitalError } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { TEMPLATE_THEMES, type TemplateTheme } from "./templates";

export type TypographyPairingId = "anton_poppins" | "fraunces_poppins" | "poppins_poppins";

export interface TypographyPairing {
  id: TypographyPairingId;
  name: string;
  headingFont: string;
  bodyFont: string;
  /** Real fontconfig family name for the heading font. */
  headingFamily: string;
  use: string;
  sample: string;
}

export const TYPOGRAPHY_PAIRINGS: TypographyPairing[] = [
  {
    id: "anton_poppins",
    name: "Anton + Poppins",
    headingFont: "Anton",
    bodyFont: "Poppins",
    headingFamily: "CVE anton-400",
    use: "Bold display headings — posters, thumbnails, sale banners",
    sample: "BIG SALE",
  },
  {
    id: "fraunces_poppins",
    name: "Fraunces + Poppins",
    headingFont: "Fraunces",
    bodyFont: "Poppins",
    headingFamily: "CVE fraunces-700",
    use: "Elegant serif headings — wedding, luxury, brand stories",
    sample: "Shaadi Mubarak",
  },
  {
    id: "poppins_poppins",
    name: "Poppins + Poppins",
    headingFont: "Poppins",
    bodyFont: "Poppins",
    headingFamily: "Poppins",
    use: "Clean single family — body text, guides, everyday designs",
    sample: "Seedhi baat",
  },
];

export interface TypographyKitRequest {
  kitName: string;
  brandColor?: string;
  accentColor?: string;
  theme?: "dark" | "light" | "sand" | "forest" | "wine" | "onyx" | "ember" | "tealrust";
  /** Pairings to include (default: all three). */
  pairings?: TypographyPairingId[];
}

export interface TypographyKitResult {
  kitName: string;
  slug: string;
  dir: string;
  pairings: TypographyPairingId[];
  files: { specimens: string[]; guideHtml: string; manifest: string; zip: string | null };
  warnings: string[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(s: string): string {
  return escapeXml(s);
}

/** One specimen sheet (1080x1080) for a pairing. */
function buildSpecimenSvg(pairing: TypographyPairing, theme: TemplateTheme, accent: string): string {
  const W = 1080;
  const H = 1080;
  const bodyFamily = "Poppins, DejaVu Sans, sans-serif";
  const headFamily = `${pairing.headingFamily}, DejaVu Sans, sans-serif`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  <rect x="0" y="0" width="${W}" height="18" fill="${accent}"/>
  <text x="76" y="110" font-family="${bodyFamily}" font-size="27" letter-spacing="5" fill="${accent}">${escapeXml(pairing.name.toUpperCase())}</text>
  <text x="76" y="290" font-family="${headFamily}" font-size="96" font-weight="bold" fill="${theme.fg}">${escapeXml(pairing.sample)}</text>
  <text x="76" y="400" font-family="${headFamily}" font-size="64" font-weight="bold" fill="${theme.fg}">${escapeXml(pairing.sample)}</text>
  <text x="76" y="500" font-family="${bodyFamily}" font-size="40" fill="${theme.fg}">${escapeXml(pairing.sample)}</text>
  <line x1="76" y1="560" x2="1004" y2="560" stroke="${theme.muted}" stroke-opacity="0.3" stroke-width="2"/>
  <text x="76" y="640" font-family="${bodyFamily}" font-size="36" fill="${theme.fg}">AaBbCcDdEeFfGg 0123456789</text>
  <text x="76" y="700" font-family="${bodyFamily}" font-size="34" fill="${theme.muted}">Headings — ${escapeXml(pairing.headingFont)} / Body — ${escapeXml(pairing.bodyFont)}</text>
  <text x="76" y="760" font-family="${bodyFamily}" font-size="34" fill="${theme.muted}">Display 96 / Heading 64 / Body 40</text>
  <text x="76" y="820" font-family="${bodyFamily}" font-size="34" fill="${theme.muted}">${escapeXml(pairing.use)}</text>
  <rect x="76" y="${H - 128}" width="64" height="5" fill="${accent}"/>
  <text x="76" y="${H - 76}" font-family="${bodyFamily}" font-size="29" fill="${theme.muted}">Ek pairing, har design me — wahi pehchan.</text>
</svg>
`;
}

function buildGuideHtml(kitName: string, pairings: TypographyPairing[]): string {
  const rows = pairings
    .map(
      (p) =>
        `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.headingFont)}</td><td>${escapeHtml(p.bodyFont)}</td><td>${escapeHtml(p.use)}</td></tr>`
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(kitName)} — Typography Guide</title>
<body style="font-family:sans-serif;max-width:680px;margin:0 auto;padding:32px 20px;color:#222;line-height:1.6">
<h1>${escapeHtml(kitName)}</h1>
<p>Font pairings — kaunsa font kahan, kitne size par.</p>
<h2>Pairings</h2>
<table border="1" cellpadding="8" cellspacing="0"><tr><th>Pairing</th><th>Headings</th><th>Body</th><th>Best use</th></tr>
${rows}
</table>
<h2>Size scale</h2>
<ul><li>Display (posters, covers) — 96px</li><li>Heading — 64px</li><li>Body — 40px</li><li>Small print — 28–32px</li></ul>
<h2>Do / Don't</h2>
<ul>
<li>Do: ek design me sirf ek pairing — headings ek font, body doosra.</li>
<li>Do: Anton sirf headings ke liye — body text ke liye bahut bhari hai.</li>
<li>Don't: ek design me 2 se zyada fonts mat milao.</li>
<li>Don't: Fraunces ko chhote size (24px se kam) par print mat karo.</li>
<li>Don't: font files ko alag se mat becho — Poppins/Anton/Fraunces OFL hain, sirf rendering ke liye free hain.</li>
</ul>
<h2>Files</h2>
<ul>${pairings.map((p) => `<li>specimen-${p.id}.svg — ${escapeHtml(p.name)} specimen</li>`).join("\n")}</ul>
</body>`;
}

/** Generate a complete typography kit (specimens + guide + manifest + zip). */
export async function generateTypographyKit(
  req: TypographyKitRequest,
  deps?: { outRoot?: string }
): Promise<TypographyKitResult> {
  const kitName = req.kitName.trim();
  if (kitName.length < 2) {
    throw new DigitalError("validation_error", "Kit name (min 2 chars) zaroori hai.");
  }
  if (req.brandColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(req.brandColor)) {
    throw new DigitalError("validation_error", "brandColor #RRGGBB format me do.");
  }
  if (req.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(req.accentColor)) {
    throw new DigitalError("validation_error", "accentColor #RRGGBB format me do.");
  }
  const baseTheme = TEMPLATE_THEMES[req.theme ?? "dark"];
  const accent = req.accentColor ?? req.brandColor ?? baseTheme.accent;
  const wanted = req.pairings && req.pairings.length > 0 ? req.pairings : TYPOGRAPHY_PAIRINGS.map((p) => p.id);
  const pairings = TYPOGRAPHY_PAIRINGS.filter((p) => wanted.includes(p.id));
  if (pairings.length === 0) {
    throw new DigitalError("validation_error", "Kam se kam ek pairing chahiye.");
  }
  const slug = slugify(kitName);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(`typography-${slug}`));
  await mkdir(dir, { recursive: true });
  const warnings: string[] = [];

  const specimenFiles: string[] = [];
  for (const p of pairings) {
    const file = `specimen-${p.id}.svg`;
    await writeFile(join(dir, file), buildSpecimenSvg(p, baseTheme, accent), "utf-8");
    specimenFiles.push(file);
  }
  await writeFile(join(dir, "pairing-guide.html"), buildGuideHtml(kitName, pairings), "utf-8");

  const manifestPath = await writeManifest(dir, {
    type: "typography_kit",
    kitName,
    pairings: pairings.map((p) => ({ id: p.id, name: p.name, headingFont: p.headingFont, bodyFont: p.bodyFont, use: p.use })),
    fonts:
      "Poppins / Anton / Fraunces (OFL) — render ke liye free; font files is kit me included NAHI hain aur kabhi standalone nahi bechi jaati.",
    files: { specimens: specimenFiles, guideHtml: "pairing-guide.html" },
    deliveryNotes: [
      "Specimen sheets SVG hain — editable, kisi bhi size par print kar sakte ho.",
      "Guide (pairing-guide.html) me pairing, size scale aur do/don't hain.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    kitName,
    slug,
    dir,
    pairings: pairings.map((p) => p.id),
    files: { specimens: specimenFiles, guideHtml: "pairing-guide.html", manifest: manifestPath, zip: zipPath },
    warnings,
  };
}
