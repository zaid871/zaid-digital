/**
 * Brand-kit generator — brand name in, sellable brand kit out.
 *
 * A complete kit: logo (SVG + PNG), colour palette (SVG swatches with
 * hex codes), typography specimen (Poppins, OFL — the house font), and
 * a brand-guidelines HTML page (logo usage, colours, type rules,
 * do/don't). One product dir with manifest + zip via ./package.
 *
 * Fonts note: Poppins is OFL — free to use in the kit's renders; font
 * files themselves are never sold standalone.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { DigitalError } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { buildSvg, renderPreview, TEMPLATE_THEMES, type TemplateTheme } from "./templates";

export interface BrandKitRequest {
  brandName: string;
  tagline?: string;
  /** Business niche (demand check + theme guidance). */
  niche?: string;
  /** Primary brand colour, #RRGGBB. */
  brandColor: string;
  accentColor?: string;
  handle?: string;
  theme?: "dark" | "light" | "sand" | "forest" | "wine" | "onyx" | "ember" | "tealrust";
  designStyle?: "standard" | "premium";
}

export interface BrandKitResult {
  brandName: string;
  slug: string;
  dir: string;
  colors: { primary: string; accent: string; background: string; text: string; muted: string };
  files: {
    logoSvg: string;
    logoPng: string | null;
    paletteSvg: string;
    typographySvg: string;
    guidelinesHtml: string;
    manifest: string;
    zip: string | null;
  };
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

/** Palette swatch sheet: 5 colours with names + hex codes. */
function buildPaletteSvg(colors: BrandKitResult["colors"], theme: TemplateTheme): string {
  const rows: { name: string; hex: string }[] = [
    { name: "Primary", hex: colors.primary },
    { name: "Accent", hex: colors.accent },
    { name: "Background", hex: colors.background },
    { name: "Text", hex: colors.text },
    { name: "Muted", hex: colors.muted },
  ];
  const W = 1080;
  const H = 1080;
  const rowH = 160;
  const top = 180;
  const body = rows
    .map(
      (r, i) => {
        const y = top + i * rowH;
        return `<rect x="76" y="${y}" width="220" height="120" rx="10" fill="${r.hex}" stroke="${theme.muted}" stroke-opacity="0.4" stroke-width="2"/><text x="330" y="${y + 52}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="40" font-weight="bold" fill="${theme.fg}">${escapeXml(r.name)}</text><text x="330" y="${y + 100}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="34" fill="${theme.muted}">${escapeXml(r.hex.toUpperCase())}</text>`;
      }
    )
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  <rect x="0" y="0" width="${W}" height="18" fill="${colors.primary}"/>
  <text x="76" y="110" font-family="Poppins, DejaVu Sans, sans-serif" font-size="27" letter-spacing="5" fill="${colors.accent}">BRAND PALETTE</text>
  ${body}
  <rect x="76" y="${H - 128}" width="64" height="5" fill="${colors.accent}"/>
  <text x="76" y="${H - 76}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="29" fill="${theme.muted}">Hex codes copy karke istemal karo.</text>
</svg>
`;
}

/** Typography specimen: brand name at 3 sizes + font rules. */
function buildTypographySvg(brandName: string, theme: TemplateTheme): string {
  const W = 1080;
  const H = 1080;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  <rect x="0" y="0" width="${W}" height="18" fill="${theme.accent}"/>
  <text x="76" y="110" font-family="Poppins, DejaVu Sans, sans-serif" font-size="27" letter-spacing="5" fill="${theme.accent}">TYPOGRAPHY — POPPINS</text>
  <text x="76" y="280" font-family="Poppins, DejaVu Sans, sans-serif" font-size="96" font-weight="bold" fill="${theme.fg}">${escapeXml(brandName.slice(0, 20))}</text>
  <text x="76" y="400" font-family="Poppins, DejaVu Sans, sans-serif" font-size="64" font-weight="bold" fill="${theme.fg}">${escapeXml(brandName.slice(0, 20))}</text>
  <text x="76" y="500" font-family="Poppins, DejaVu Sans, sans-serif" font-size="40" fill="${theme.fg}">${escapeXml(brandName.slice(0, 20))}</text>
  <line x1="76" y1="560" x2="1004" y2="560" stroke="${theme.muted}" stroke-opacity="0.3" stroke-width="2"/>
  <text x="76" y="640" font-family="Poppins, DejaVu Sans, sans-serif" font-size="34" fill="${theme.fg}">Headings — Poppins Bold</text>
  <text x="76" y="700" font-family="Poppins, DejaVu Sans, sans-serif" font-size="34" fill="${theme.muted}">Body — Poppins Regular</text>
  <text x="76" y="760" font-family="Poppins, DejaVu Sans, sans-serif" font-size="34" fill="${theme.muted}">Poppins (OFL) — free to use.</text>
  <rect x="76" y="${H - 128}" width="64" height="5" fill="${theme.accent}"/>
  <text x="76" y="${H - 76}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="29" fill="${theme.muted}">Ek font, har jagah — wahi pehchan.</text>
</svg>
`;
}

function buildGuidelinesHtml(req: BrandKitRequest, colors: BrandKitResult["colors"]): string {
  const name = escapeHtml(req.brandName);
  const tagline = escapeHtml((req.tagline ?? "").trim());
  const rows = (
    [
      ["Primary", colors.primary],
      ["Accent", colors.accent],
      ["Background", colors.background],
      ["Text", colors.text],
      ["Muted", colors.muted],
    ] as const
  )
    .map(
      ([label, hex]) =>
        `<tr><td><span style="display:inline-block;width:22px;height:22px;background:${hex};border:1px solid #888;vertical-align:middle;margin-right:10px"></span>${label}</td><td><code>${hex.toUpperCase()}</code></td></tr>`
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>${name} — Brand Guidelines</title>
<body style="font-family:sans-serif;max-width:680px;margin:0 auto;padding:32px 20px;color:#222;line-height:1.6">
<h1>${name}</h1>
${tagline ? `<p style="font-size:19px;color:#555">${tagline}</p>` : ""}
<h2>Logo</h2>
<p><img src="logo.png" width="270" alt="logo"></p>
<p>Logo ko stretch mat karo, rang mat badlo, us par effects mat daalo. Hamesha saaf jagah (clear space) chhodo — logo ke chaaron taraf kam se kam logo ki height ka aadha gap.</p>
<h2>Colours</h2>
<table border="1" cellpadding="8" cellspacing="0"><tr><th>Colour</th><th>Hex</th></tr>
${rows}
</table>
<p>Primary har jagah main rang hai; Accent sirf highlights (buttons, lines, chhote accents) ke liye.</p>
<h2>Typography</h2>
<p>Font: <strong>Poppins</strong> (OFL, free to use). Headings — Poppins Bold; body — Poppins Regular. Ek font, har jagah.</p>
<h2>Do / Don't</h2>
<ul>
<li>Do: logo + Primary + Poppins — teeno ek saath, har design me.</li>
<li>Do: naye designs ke liye template packs me yahi brandColor istemal karo.</li>
<li>Don't: logo ko dobara design mat karo, rang mat badlo, font mat badlo.</li>
<li>Don't: font files ko alag se mat becho — Poppins OFL hai, render ke liye free hai.</li>
</ul>
<h2>Files</h2>
<ul><li>logo.svg — editable logo source</li><li>logo.png — ready-to-use logo</li><li>palette.svg — colour swatches</li><li>typography.svg — font specimen</li></ul>
</body>`;
}

/** Generate a complete brand kit (logo + palette + typography + guidelines + manifest + zip). */
export async function generateBrandKit(
  req: BrandKitRequest,
  deps?: { outRoot?: string }
): Promise<BrandKitResult> {
  const brandName = req.brandName.trim();
  if (brandName.length < 2) {
    throw new DigitalError("validation_error", "Brand name (min 2 chars) zaroori hai.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(req.brandColor)) {
    throw new DigitalError("validation_error", "brandColor #RRGGBB format me do (e.g. #E85A24).");
  }
  if (req.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(req.accentColor)) {
    throw new DigitalError("validation_error", "accentColor #RRGGBB format me do.");
  }
  const baseTheme = TEMPLATE_THEMES[req.theme ?? "dark"];
  const theme: TemplateTheme = { ...baseTheme, accent: req.brandColor };
  const colors: BrandKitResult["colors"] = {
    primary: req.brandColor,
    accent: req.accentColor ?? baseTheme.accent,
    background: baseTheme.bg,
    text: baseTheme.fg,
    muted: baseTheme.muted,
  };
  const footer = (req.handle ?? "@yourhandle").trim();
  const slug = slugify(brandName);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });
  const warnings: string[] = [];

  const logoSvg = buildSvg(
    { kind: "logo", headline: brandName, body: (req.tagline ?? "").trim() || "Aapki pehchan, ek nishan." },
    "square",
    theme,
    footer,
    { designStyle: req.designStyle ?? "standard" }
  );
  await writeFile(join(dir, "logo.svg"), logoSvg, "utf-8");
  const pngOk = await renderPreview(join(dir, "logo.svg"), join(dir, "logo.png"), 1080, 1080);
  if (!pngOk) {
    warnings.push("preview_unavailable: logo.png nahi bana (ffmpeg me librsvg decoder chahiye) — logo.svg tayyar hai");
  }

  await writeFile(join(dir, "palette.svg"), buildPaletteSvg(colors, baseTheme), "utf-8");
  await writeFile(join(dir, "typography.svg"), buildTypographySvg(brandName, baseTheme), "utf-8");
  await writeFile(join(dir, "brand-guidelines.html"), buildGuidelinesHtml(req, colors), "utf-8");

  const manifestPath = await writeManifest(dir, {
    type: "brand_kit",
    brandName,
    tagline: (req.tagline ?? "").trim() || null,
    niche: (req.niche ?? "").trim() || null,
    colors,
    theme: req.theme ?? "dark",
    designStyle: req.designStyle ?? "standard",
    fonts: "Poppins (OFL) — render ke liye free; font files standalone product nahi.",
    files: {
      logoSvg: "logo.svg",
      logoPng: pngOk ? "logo.png" : null,
      paletteSvg: "palette.svg",
      typographySvg: "typography.svg",
      guidelinesHtml: "brand-guidelines.html",
    },
    deliveryNotes: [
      "logo.svg editable source hai — text aur rang badle ja sakte hain.",
      "Palette ke hex codes copy karke har design me istemal karo.",
      "Guidelines (brand-guidelines.html) me logo usage, colours, typography aur do/don't hain.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    brandName,
    slug,
    dir,
    colors,
    files: {
      logoSvg: "logo.svg",
      logoPng: pngOk ? "logo.png" : null,
      paletteSvg: "palette.svg",
      typographySvg: "typography.svg",
      guidelinesHtml: "brand-guidelines.html",
      manifest: manifestPath,
      zip: zipPath,
    },
    warnings,
  };
}
