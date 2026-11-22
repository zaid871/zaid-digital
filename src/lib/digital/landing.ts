/**
 * Landing-page generator — business name in, sellable static HTML out.
 *
 * One self-contained index.html (inline CSS, no external assets, dark
 * premium look): hero (business name + tagline + CTA button) + features
 * grid + footer. Buyers drop in their own links/images and host it
 * anywhere (or deploy it with the repo's free static-host adapters).
 *
 * Copy is drafted by the free text chain from the topic (JSON: tagline
 * + features) when a textGen is supplied; otherwise the caller-supplied
 * features are used, or a generic sample bank (warning recorded).
 * Every line passes the compliance scan — a violating feature is
 * dropped with a warning, never shipped.
 *
 * Honest limits: this is ONE static page, not a theme/UI kit — no
 * component library, no multi-page site, no Figma file.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError, type TextGen } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

export interface LandingRequest {
  businessName: string;
  topic?: string;
  tagline?: string;
  features?: string[];
  ctaText?: string;
  theme?: "dark" | "light";
  useAi?: boolean;
}

export interface LandingResult {
  title: string;
  slug: string;
  dir: string;
  file: string;
  files: { manifest: string; zip: string | null; html: string };
  warnings: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bankFeatures(topic: string): string[] {
  const t = topic.trim();
  return [
    `Simple to start — ${t} ke liye step-by-step guide`,
    "Beginner-friendly — koi pehle ka tajurba zaroori nahi",
    "Practical examples — sirf theory nahi, kaam ki cheezein",
    "Apni raftaar se seekho — kabhi bhi, kahin bhi",
  ];
}

async function aiDraft(
  req: LandingRequest,
  textGen: TextGen
): Promise<{ tagline: string; features: string[] } | null> {
  const topic = (req.topic ?? req.businessName).trim();
  const prompt = [
    `Write landing-page copy for a business called "${req.businessName}" about the topic "${topic}".`,
    `Reply with ONLY a JSON object, no other text: {"tagline": "one short tagline (max 12 words)", "features": ["4-6 short feature lines, max 12 words each, each a real benefit"]}.`,
    `Write in Roman-script Hinglish where natural. Honest, practical copy — NO prices, NO discounts, NO income or result promises, NO fake claims.`,
  ].join("\n");
  try {
    const raw = await textGen(prompt, 600);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const tagline = String(obj.tagline ?? "").trim();
    const features = (Array.isArray(obj.features) ? obj.features : [])
      .map((f) => String(f ?? "").trim())
      .filter((f) => f.length >= 5)
      .slice(0, 6);
    if (tagline.length < 5 || features.length < 3) return null;
    return { tagline, features };
  } catch {
    return null;
  }
}

function scanLine(line: string): string | null {
  const price = line.match(PRICE_PATTERN);
  if (price) return `price/offer pattern: "${price[0]}"`;
  const banned = line.match(BANNED_CLAIM_PATTERN);
  if (banned) return `banned claim pattern: "${banned[0]}"`;
  return null;
}

export async function generateLandingPage(
  req: LandingRequest,
  deps?: { textGen?: TextGen; outRoot?: string }
): Promise<LandingResult> {
  const businessName = req.businessName.trim();
  if (businessName.length < 2) throw new DigitalError("validation_error", "Landing page needs a business name (min 2 chars).");
  const theme = req.theme === "light" ? "light" : "dark";
  const warnings: string[] = [];

  let tagline = (req.tagline ?? "").trim();
  let features = (req.features ?? []).map((f) => f.trim()).filter((f) => f.length >= 5);
  if (req.useAi !== false && deps?.textGen && (!tagline || features.length < 3)) {
    const draft = await aiDraft(req, deps.textGen);
    if (draft) {
      if (!tagline) tagline = draft.tagline;
      if (features.length < 3) features = draft.features;
    } else {
      warnings.push("ai_draft_fallback: AI copy nahi bani — supplied/bank copy use hui hai");
    }
  }
  if (!tagline) tagline = `Simple, honest help with ${req.topic ?? businessName}.`;
  if (features.length === 0) {
    features = bankFeatures(req.topic ?? businessName);
    warnings.push("ai_draft_fallback: no features supplied — generic sample features use hue hain");
  }

  // Compliance: drop violating lines, never ship them.
  const kept: string[] = [];
  for (const f of features) {
    const hit = scanLine(f);
    if (hit) warnings.push(`compliance_dropped: feature dropped (${hit})`);
    else kept.push(f);
  }
  const tagHit = scanLine(tagline);
  if (tagHit) throw new DigitalError("compliance_rejected", `Tagline failed the compliance scan (${tagHit}).`);
  if (kept.length === 0) throw new DigitalError("compliance_rejected", "All features failed the compliance scan — nothing to ship.");
  const ctaText = (req.ctaText ?? "Shuru karein").trim() || "Shuru karein";

  const bg = theme === "light" ? "#FAF7F2" : "#111318";
  const fg = theme === "light" ? "#1C1C22" : "#FFFFFF";
  const muted = theme === "light" ? "#5C5C66" : "#B9BEC9";
  const accent = "#FF6B35";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(businessName)} — ${escapeHtml(tagline)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${bg}; color: ${fg}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.6; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 64px 24px; }
  .eyebrow { color: ${accent}; letter-spacing: 4px; font-size: 13px; font-weight: 700; text-transform: uppercase; }
  h1 { font-size: 52px; line-height: 1.1; margin: 16px 0; }
  .tagline { font-size: 21px; color: ${muted}; max-width: 640px; }
  .cta { display: inline-block; margin-top: 32px; padding: 14px 32px; background: ${accent}; color: #fff; font-weight: 700; font-size: 18px; border-radius: 8px; text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 64px; }
  .card { border: 1px solid ${theme === "light" ? "#E3DED6" : "#2A2E37"}; border-radius: 12px; padding: 24px; }
  .card .bar { width: 48px; height: 5px; background: ${accent}; border-radius: 3px; margin-bottom: 16px; }
  .card h3 { font-size: 19px; margin-bottom: 8px; }
  .card p { color: ${muted}; }
  footer { margin-top: 64px; color: ${muted}; font-size: 14px; border-top: 1px solid ${theme === "light" ? "#E3DED6" : "#2A2E37"}; padding-top: 24px; }
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">${escapeHtml(businessName)}</p>
  <h1>${escapeHtml(businessName)}</h1>
  <p class="tagline">${escapeHtml(tagline)}</p>
  <a class="cta" href="#">${escapeHtml(ctaText)}</a>
  <div class="grid">
${kept.map((f) => `    <div class="card"><div class="bar"></div><h3>${escapeHtml(f)}</h3></div>`).join("\n")}
  </div>
  <footer>${escapeHtml(businessName)} — ${escapeHtml(tagline)}</footer>
</div>
</body>
</html>
`;

  const slug = slugify(businessName);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(`landing-${slug}`));
  await mkdir(dir, { recursive: true });
  const htmlPath = join(dir, "index.html");
  await writeFile(htmlPath, html, "utf-8");

  const manifestPath = await writeManifest(dir, {
    type: "landing_page",
    title: businessName,
    tagline,
    theme,
    features: kept,
    ctaText,
    files: { html: "index.html" },
    deliveryNotes: [
      "Single static file — kisi bhi free static host par deploy karein, ya zip khol kar browser me dekhein.",
      "CTA button ka href '#' hai — apna link daal kar istemal karein.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    title: businessName,
    slug,
    dir,
    file: htmlPath,
    files: { manifest: manifestPath, zip: zipPath, html: htmlPath },
    warnings,
  };
}
