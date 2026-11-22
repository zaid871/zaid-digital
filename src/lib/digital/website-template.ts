/**
 * Website-template generator — business name in, static 3-page site out.
 *
 * Pages: index (landing page, reuses generateLandingPage) + about +
 * contact, all sharing one visual system (dark/light theme, accent
 * #FF6B35, same nav). Pure static HTML — any free static host works.
 *
 * DISABLED BY DEFAULT: the product is built but switched off until the
 * workflows are running well. Enable with
 *   WEBSITE_TEMPLATES_ENABLED=true
 * in the deploy .env, then import digital-website-template-generation.json.
 * The route returns 503 "disabled" while the flag is off.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { DigitalError, type TextGen } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { generateLandingPage } from "./landing";

/** The disable switch — env flag, off unless explicitly enabled. */
export function isWebsiteTemplateEnabled(): boolean {
  return process.env.WEBSITE_TEMPLATES_ENABLED === "true";
}

export interface WebsiteTemplateRequest {
  businessName: string;
  topic?: string;
  tagline?: string;
  features?: string[];
  ctaText?: string;
  theme?: "dark" | "light";
  useAi?: boolean;
}

export interface WebsiteTemplateResult {
  businessName: string;
  slug: string;
  dir: string;
  files: { index: string; about: string; contact: string; manifest: string; zip: string | null };
  warnings: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** About / contact pages share the landing page's visual system. */
function buildSubPage(
  page: "about" | "contact",
  businessName: string,
  tagline: string,
  features: string[],
  theme: "dark" | "light"
): string {
  const bg = theme === "light" ? "#FAF7F2" : "#111318";
  const fg = theme === "light" ? "#1C1C22" : "#FFFFFF";
  const muted = theme === "light" ? "#5C5C66" : "#B9BEC9";
  const accent = "#FF6B35";
  const border = theme === "light" ? "#E3DED6" : "#2A2E37";
  const title = page === "about" ? `About ${businessName}` : `Contact ${businessName}`;
  const body =
    page === "about"
      ? `<p class="tagline">${escapeHtml(tagline)}</p>
  <div class="grid">
${features.map((f) => `    <div class="card"><div class="bar"></div><h3>${escapeHtml(f)}</h3></div>`).join("\n")}
  </div>`
      : `<p class="tagline">Baatchit shuru karein — form bhariye, hum jald jawaab denge.</p>
  <form class="form" action="#" method="post">
    <label>Naam<input type="text" name="name" required></label>
    <label>Email<input type="email" name="email" required></label>
    <label>Message<textarea name="message" rows="5" required></textarea></label>
    <button class="cta" type="submit">Bhejo</button>
  </form>
  <p class="note">Ye form static hai — apna form endpoint (Formspree / Google Forms) action me daal kar istemal karein.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${bg}; color: ${fg}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.6; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 64px 24px; }
  nav { margin-bottom: 48px; font-size: 16px; }
  nav a { color: ${muted}; text-decoration: none; margin-right: 24px; }
  nav a.active { color: ${accent}; font-weight: 700; }
  .eyebrow { color: ${accent}; letter-spacing: 4px; font-size: 13px; font-weight: 700; text-transform: uppercase; }
  h1 { font-size: 52px; line-height: 1.1; margin: 16px 0; }
  .tagline { font-size: 21px; color: ${muted}; max-width: 640px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 64px; }
  .card { border: 1px solid ${border}; border-radius: 12px; padding: 24px; }
  .card .bar { width: 48px; height: 5px; background: ${accent}; border-radius: 3px; margin-bottom: 16px; }
  .card h3 { font-size: 19px; margin-bottom: 8px; }
  .form { margin-top: 32px; display: grid; gap: 16px; max-width: 560px; }
  .form label { display: grid; gap: 6px; font-weight: 600; }
  .form input, .form textarea { padding: 12px; border: 1px solid ${border}; border-radius: 8px; background: transparent; color: ${fg}; font-size: 16px; }
  .cta { display: inline-block; margin-top: 8px; padding: 14px 32px; background: ${accent}; color: #fff; font-weight: 700; font-size: 18px; border-radius: 8px; border: none; cursor: pointer; }
  .note { margin-top: 24px; color: ${muted}; font-size: 14px; }
  footer { margin-top: 64px; color: ${muted}; font-size: 14px; border-top: 1px solid ${border}; padding-top: 24px; }
</style>
</head>
<body>
<div class="wrap">
  <nav><a href="index.html">Home</a><a href="about.html" class="${page === "about" ? "active" : ""}">About</a><a href="contact.html" class="${page === "contact" ? "active" : ""}">Contact</a></nav>
  <p class="eyebrow">${escapeHtml(businessName)}</p>
  <h1>${escapeHtml(title)}</h1>
  ${body}
  <footer>${escapeHtml(businessName)} — ${escapeHtml(tagline)}</footer>
</div>
</body>
</html>
`;
}

/** Generate a static 3-page website template (index + about + contact + manifest + zip). */
export async function generateWebsiteTemplate(
  req: WebsiteTemplateRequest,
  deps?: { textGen?: TextGen; outRoot?: string }
): Promise<WebsiteTemplateResult> {
  const businessName = req.businessName.trim();
  if (businessName.length < 2) {
    throw new DigitalError("validation_error", "Business name (min 2 chars) zaroori hai.");
  }
  const theme = req.theme === "light" ? "light" : "dark";
  const slug = slugify(businessName);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(`website-${slug}`));
  await mkdir(dir, { recursive: true });
  const warnings: string[] = [];

  // Index page = the proven landing-page generator (AI draft + compliance).
  const landing = await generateLandingPage(
    {
      businessName,
      topic: req.topic,
      tagline: req.tagline,
      features: req.features,
      ctaText: req.ctaText,
      theme,
      useAi: req.useAi,
    },
    { textGen: deps?.textGen, outRoot: deps?.outRoot }
  );
  warnings.push(...landing.warnings);
  const landingHtml = await readFile(join(landing.dir, "index.html"), "utf-8");
  // Same nav on the index page (inserted after <div class="wrap">).
  const nav = `<nav style="margin-bottom:48px;font-size:16px"><a href="index.html" style="color:#FF6B35;font-weight:700;text-decoration:none;margin-right:24px">Home</a><a href="about.html" style="color:inherit;text-decoration:none;margin-right:24px;opacity:.7">About</a><a href="contact.html" style="color:inherit;text-decoration:none;opacity:.7">Contact</a></nav>`;
  const indexHtml = landingHtml.replace('<div class="wrap">', `<div class="wrap">\n  ${nav}`);
  await writeFile(join(dir, "index.html"), indexHtml, "utf-8");

  const tagline = (req.tagline ?? "").trim() || `Simple, honest help with ${req.topic ?? businessName}.`;
  const features = (req.features ?? []).map((f) => f.trim()).filter((f) => f.length >= 5);
  await writeFile(join(dir, "about.html"), buildSubPage("about", businessName, tagline, features, theme), "utf-8");
  await writeFile(join(dir, "contact.html"), buildSubPage("contact", businessName, tagline, features, theme), "utf-8");

  const manifestPath = await writeManifest(dir, {
    type: "website_template",
    businessName,
    theme,
    pages: ["index.html", "about.html", "contact.html"],
    files: { index: "index.html", about: "about.html", contact: "contact.html" },
    deliveryNotes: [
      "Static 3-page site — kisi bhi free static host (GitHub Pages / Netlify / Cloudflare Pages) par deploy karein.",
      "CTA button ka href '#' hai — apna link daal kar istemal karein.",
      "Contact form static hai — Formspree / Google Forms ka endpoint action me daalein.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    businessName,
    slug,
    dir,
    files: { index: "index.html", about: "about.html", contact: "contact.html", manifest: manifestPath, zip: zipPath },
    warnings,
  };
}
