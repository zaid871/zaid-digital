/**
 * Marketing-toolkit generator — product name in, sellable launch bundle out.
 *
 * Bundles the existing marketing components into one product:
 * sales copy (buyer-psychology edition) + auto-FAQ + caption pack +
 * social templates (promo/announcement/checklist pack) + launch checklist.
 * Every line is compliance-scanned by the underlying generators
 * (no prices, no fake claims — violating lines are dropped, never shipped).
 *
 * Captions are built deterministically from the sales copy (headline +
 * outcome bullets + CTA) — NOT via the pipeline caption-pack module,
 * which is worker-side only ("do not import it from a Next.js App Route":
 * it pulls the provider router + edge-tts/remotion into the route bundle
 * and breaks `npm run build`).
 */
import { copyFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { DigitalError, type TextGen } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { generateFaq } from "./faq";
import { generateSalesCopy, type SalesCopy } from "./sales-copy";
import { generateTemplatePack } from "./templates";

export interface MarketingToolkitRequest {
  productName: string;
  productType?: "ebook" | "template_pack" | "pod";
  productDescription?: string;
  /** Verified features only — never invented. */
  features?: string[];
  audience?: string;
  outcomes?: string[];
  niche?: string;
  handle?: string;
  theme?: "dark" | "light" | "sand" | "forest" | "wine" | "onyx" | "ember" | "tealrust";
  designStyle?: "standard" | "premium";
}

export interface MarketingToolkitResult {
  productName: string;
  slug: string;
  dir: string;
  files: {
    salesCopy: string;
    faq: string;
    captions: string;
    checklist: string;
    socialTemplates: string[];
    manifest: string;
    zip: string | null;
  };
  warnings: string[];
}

function mdSection(title: string, body: string): string {
  return `## ${title}\n\n${body}\n`;
}

interface ToolkitCaptions {
  instagram: string;
  facebook: string;
  headlines: string[];
  seoDescription: string;
  seoKeywords: string[];
  hashtags: string[];
}

/** Deterministic captions from the sales copy (no extra AI call, route-safe). */
function buildCaptions(productName: string, copy: SalesCopy, niche: string | null): ToolkitCaptions {
  const headline = copy.headline ?? productName;
  const bullets = copy.outcomeBullets.slice(0, 3);
  const cta = copy.ctaLine ?? "";
  const instagram = [headline, ...bullets, cta].filter(Boolean).join("\n");
  const facebook = [copy.subheadline ?? "", copy.problemSection ?? ""].filter(Boolean).join(" ").slice(0, 400);
  const headlineWords = (s: string) => s.split(/\s+/).slice(0, 10).join(" ");
  const headlines = [headline, ...bullets].slice(0, 3).map(headlineWords).filter((h) => h.length > 0);
  const seoDescription = copy.subheadline ?? headline;
  const tagWords = (niche ?? productName)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const seoKeywords = Array.from(new Set([...tagWords, "digital product", "printable", "template"])).slice(0, 8);
  const hashtags = Array.from(new Set(tagWords)).slice(0, 8).map((w) => `#${w}`);
  return { instagram, facebook, headlines, seoDescription, seoKeywords, hashtags };
}

/** Generate a complete marketing toolkit (copy + FAQ + captions + templates + checklist + manifest + zip). */
export async function generateMarketingToolkit(
  req: MarketingToolkitRequest,
  deps?: { textGen?: TextGen; outRoot?: string }
): Promise<MarketingToolkitResult> {
  const productName = req.productName.trim();
  if (productName.length < 2) {
    throw new DigitalError("validation_error", "Product name (min 2 chars) zaroori hai.");
  }
  const productType = req.productType ?? "template_pack";
  const features = (req.features ?? []).filter((f) => f.trim().length > 0).slice(0, 8);
  const slug = slugify(productName);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(`marketing-toolkit-${slug}`));
  await mkdir(dir, { recursive: true });
  const warnings: string[] = [];

  // 1. Sales copy (buyer-psychology edition — trustLine, objections, risk note).
  const copy = await generateSalesCopy(
    { productName, productType, features, audience: req.audience, outcomes: req.outcomes },
    deps?.textGen
  );
  warnings.push(...copy.warnings);
  const copyMd = [
    `# ${productName} — Sales Copy`,
    "",
    copy.headline ? mdSection("Headline", copy.headline) : "",
    copy.subheadline ? mdSection("Subheadline", copy.subheadline) : "",
    copy.problemSection ? mdSection("Problem", copy.problemSection) : "",
    copy.outcomeBullets.length > 0
      ? mdSection("Outcomes", copy.outcomeBullets.map((b) => `- ${b}`).join("\n"))
      : "",
    copy.insideList.length > 0
      ? mdSection("What's inside", copy.insideList.map((b) => `- ${b}`).join("\n"))
      : "",
    copy.whoIsItFor ? mdSection("Who is it for", copy.whoIsItFor) : "",
    copy.trustLine ? mdSection("Trust", copy.trustLine) : "",
    copy.objectionAnswers.length > 0
      ? mdSection("Objections answered", copy.objectionAnswers.map((b) => `- ${b}`).join("\n"))
      : "",
    copy.riskNote ? mdSection("Risk note", copy.riskNote) : "",
    copy.ctaLine ? mdSection("Call to action", copy.ctaLine) : "",
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(join(dir, "sales-copy.md"), copyMd, "utf-8");

  // 2. Auto-FAQ.
  const faq = await generateFaq({ productName, productType, about: features }, deps?.textGen);
  warnings.push(...faq.warnings);
  const faqMd = [
    `# ${productName} — FAQ`,
    "",
    ...faq.items.map((it) => `### ${it.q}\n\n${it.a}\n`),
  ].join("\n");
  await writeFile(join(dir, "faq.md"), faqMd, "utf-8");

  // 3. Caption pack — built from the sales copy (deterministic, route-safe).
  const pack = buildCaptions(productName, copy, req.niche ?? null);
  const captionsMd = [
    `# ${productName} — Captions`,
    "",
    pack.instagram ? mdSection("Instagram", pack.instagram) : "",
    pack.facebook ? mdSection("Facebook", pack.facebook) : "",
    pack.headlines.length > 0 ? mdSection("Headlines", pack.headlines.map((h) => `- ${h}`).join("\n")) : "",
    pack.seoDescription ? mdSection("SEO description", pack.seoDescription) : "",
    pack.seoKeywords.length > 0 ? mdSection("SEO keywords", pack.seoKeywords.join(", ")) : "",
    pack.hashtags.length > 0 ? mdSection("Hashtags", pack.hashtags.join(" ")) : "",
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(join(dir, "captions.md"), captionsMd, "utf-8");

  // 4. Social templates (promo/announcement/checklist pack, copied in).
  const templates = await generateTemplatePack(
    {
      niche: (req.niche ?? productName).trim(),
      count: 3,
      kinds: ["promo", "announcement", "checklist"],
      theme: req.theme ?? "dark",
      designStyle: req.designStyle ?? "standard",
      handle: req.handle,
    },
    { outRoot: deps?.outRoot }
  );
  warnings.push(...templates.warnings);
  const socialDir = join(dir, "social-templates");
  await mkdir(socialDir, { recursive: true });
  const socialFiles: string[] = [];
  for (const d of templates.designs) {
    for (const f of [d.svgFile, d.pngFile]) {
      if (!f) continue;
      await copyFile(join(templates.dir, f), join(socialDir, f));
      socialFiles.push(`social-templates/${f}`);
    }
  }

  // 5. Launch checklist.
  const checklistMd = `# ${productName} — Launch Checklist

## Pre-launch
- [ ] Sales copy padh lo — headline + CTA sahi hain
- [ ] FAQ check karo — sawaal-jawaab product se match karte hain
- [ ] Captions tayyar hain — IG + FB dono
- [ ] Social templates dekho — promo, announcement, checklist designs

## Launch day (best time: 07:30 / 08:30 / 19:30 / 20:30 IST)
- [ ] Announcement post karo — caption pack se
- [ ] Promo design share karo
- [ ] Comments ka jawaab do — DM CTA yaad rakho

## Post-launch
- [ ] Views + clicks note karo (goal loop me record karo)
- [ ] Jo caption sabse achha chala, usi angle se doosra post banao
- [ ] Checklist design se weekly reminder post karo
`;
  await writeFile(join(dir, "launch-checklist.md"), checklistMd, "utf-8");

  const manifestPath = await writeManifest(dir, {
    type: "marketing_toolkit",
    productName,
    productType,
    niche: (req.niche ?? "").trim() || null,
    files: {
      salesCopy: "sales-copy.md",
      faq: "faq.md",
      captions: "captions.md",
      checklist: "launch-checklist.md",
      socialTemplates: socialFiles,
    },
    deliveryNotes: [
      "Sales copy, FAQ aur captions AI se bane hain — har line compliance-scanned hai (no prices, no fake claims).",
      "Social templates editable SVG + PNG previews hain.",
      "Launch checklist me best-time slots (07:30/08:30/19:30/20:30 IST) likhe hain.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    productName,
    slug,
    dir,
    files: {
      salesCopy: "sales-copy.md",
      faq: "faq.md",
      captions: "captions.md",
      checklist: "launch-checklist.md",
      socialTemplates: socialFiles,
      manifest: manifestPath,
      zip: zipPath,
    },
    warnings,
  };
}
