/**
 * Digital storefront catalog.
 *
 * Generated digital products live FLAT under the digital root
 * (storage/digital/<slug>-<base36ts>/manifest.json — one folder per
 * product, no type subfolders). The manifests ARE the catalog: this
 * module scans them, normalizes the per-type shapes into cards, and
 * groups them into shopping-site categories. No database, no prices —
 * prices are set per product at selling time, never invented here.
 *
 * Tolerant by design: a missing or broken manifest is skipped (counted
 * in `skipped`), never a crash — a half-written product must not take
 * the whole store down.
 */
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { digitalRoot } from "./package";
import { readHiddenIds } from "./store-admin";

export interface StorefrontCategory {
  slug: string;
  label: string;
  count: number;
}

export interface StorefrontProduct {
  /** Directory basename under the digital root, e.g. "wedding-invites-m3k2x9". */
  id: string;
  category: string;
  categoryLabel: string;
  /** Raw manifest type/kind, e.g. "ebook", "template_pack", "pod_design". */
  type: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  createdAt: string | null;
  /** Public preview image URL via /api/v1/digital/files, or null. */
  previewImage: string | null;
  badge: string | null;
  /** Type-specific facts for the detail page (chapters, page count...). */
  details: string[];
  includedFiles: string[];
  hasZip: boolean;
  /** True when the product is hidden from the public store (admin only). */
  hidden?: boolean;
}

interface CategoryDef {
  slug: string;
  label: string;
}

/** Raw manifest type/kind -> store category. Unknown types -> "other". */
const CATEGORY_BY_TYPE: Record<string, CategoryDef> = {
  ebook: { slug: "ebooks", label: "Ebooks" },
  coloring_book: { slug: "ebooks", label: "Ebooks" },
  template_pack: { slug: "templates", label: "Templates" },
  xlsx: { slug: "spreadsheets", label: "Spreadsheets" },
  docx: { slug: "documents", label: "Documents" },
  pptx: { slug: "documents", label: "Documents" },
  epub: { slug: "documents", label: "Documents" },
  pod_design: { slug: "pod", label: "Print on Demand" },
  planner: { slug: "planners", label: "Planners" },
  thumbnail: { slug: "thumbnails", label: "Thumbnails" },
  intro: { slug: "thumbnails", label: "Thumbnails" },
  outro: { slug: "thumbnails", label: "Thumbnails" },
  brand_kit: { slug: "brand-kits", label: "Brand Kits" },
  typography_kit: { slug: "typography-kits", label: "Typography Kits" },
  marketing_toolkit: { slug: "marketing-toolkits", label: "Marketing Toolkits" },
  landing_page: { slug: "landing-pages", label: "Landing Pages" },
  prompt_library: { slug: "prompt-libraries", label: "Prompt Libraries" },
  lut_pack: { slug: "presets", label: "LUTs & Presets" },
  lightroom_preset_pack: { slug: "presets", label: "LUTs & Presets" },
  icon_bundle: { slug: "icon-bundles", label: "Icon Bundles" },
  website_template: { slug: "website-templates", label: "Website Templates" },
};

/** SEO + header copy per store category, keyed by category slug.
 * Used by /store/<category> for <title>, meta description and the
 * page header. A category listed here renders even with zero
 * products (no 404); categories not listed here fall back to their
 * catalog label and 404 while they have zero products. */
export interface CategoryMeta {
  label: string;
  title: string;
  description: string;
  blurb: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  ebooks: {
    label: "Ebooks",
    title: "Ebooks",
    description:
      "Classic books and ebooks in digital editions. Timeless reads, instant download — new ebooks every week.",
    blurb: "Classic books aur ebooks — timeless reads, digital editions.",
  },
  templates: {
    label: "Templates",
    title: "Templates",
    description:
      "Premium templates and digital designs. Website templates, planners and more — instant download, ready to use.",
    blurb: "Premium templates aur digital designs — instant download, ready to use.",
  },
  spreadsheets: {
    label: "Spreadsheets",
    title: "Spreadsheets",
    description:
      "Budget spreadsheets and finance trackers. Plan, save and track your money with easy Excel and Google Sheets templates.",
    blurb: "Budget spreadsheets aur finance trackers — apne paise ko plan aur track karein.",
  },
  pod: {
    label: "Print on Demand",
    title: "Print on Demand",
    description:
      "Custom printed products — T-shirts, templates, shoes and more. Unique designs at budget prices.",
    blurb: "Custom printed products — T-shirts, templates, shoes aur bhi bahut kuch.",
  },
};

/** SEO copy for a category slug, or null when the category has none. */
export function categoryMeta(slug: string): CategoryMeta | null {
  return CATEGORY_META[slug] ?? null;
}

/** Display order of categories on the store home page. */
const CATEGORY_ORDER = [
  "ebooks",
  "templates",
  "spreadsheets",
  "pod",
  "planners",
  "documents",
  "thumbnails",
  "brand-kits",
  "typography-kits",
  "marketing-toolkits",
  "landing-pages",
  "prompt-libraries",
  "presets",
  "icon-bundles",
  "website-templates",
  "other",
];

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
}

/** Infer a raw type from the directory name when the manifest has none. */
function inferTypeFromDir(id: string): string | null {
  if (id.startsWith("pod-")) return "pod_design";
  if (id.startsWith("typography-")) return "typography_kit";
  if (id.startsWith("marketing-toolkit-")) return "marketing_toolkit";
  if (id.startsWith("thumbnail-")) return "thumbnail";
  if (id.startsWith("intro-")) return "intro";
  if (id.startsWith("outro-")) return "outro";
  return null;
}

/** "wedding-invites-m3k2x9" -> "Wedding Invites" (drops the timestamp tail). */
function prettifyDirName(id: string): string {
  const parts = id.split("-").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && /^[a-z0-9]{4,10}$/.test(last)) parts.pop();
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || id;
}

function pickPreviewImage(files: string[]): string | null {
  const images = files.filter((f) => IMAGE_EXT.has(f.slice(f.lastIndexOf(".")).toLowerCase()));
  if (!images.length) return null;
  const preferred = images.find((f) => /preview|mockup|design|cover/i.test(f));
  return preferred ?? [...images].sort()[0] ?? null;
}

function buildDetails(type: string, m: Record<string, unknown>): string[] {
  const details: string[] = [];
  if (type === "ebook" || type === "coloring_book") {
    const chapters = asStringArray(m.chapters);
    if (chapters.length) details.push(`${chapters.length} chapters`);
    if (typeof m.pdfPages === "number" && m.pdfPages > 0) details.push(`${m.pdfPages} pages`);
    if (typeof m.wordCount === "number" && m.wordCount > 0) details.push(`${m.wordCount.toLocaleString("en-IN")} words`);
    if (type === "coloring_book") details.push("Coloring book — print at home");
  } else if (type === "template_pack") {
    if (typeof m.count === "number" && m.count > 0) details.push(`${m.count} templates`);
    const kinds = asStringArray(m.kinds);
    if (kinds.length) details.push(`Kinds: ${kinds.join(", ")}`);
  } else if (type === "pod_design") {
    if (asString(m.style)) details.push(`Style: ${asString(m.style)}`);
    if (asString(m.shirtColor)) details.push(`Shirt colour: ${asString(m.shirtColor)}`);
    if (asString(m.niche)) details.push(`Niche: ${asString(m.niche)}`);
  } else if (type === "planner") {
    if (asString(m.kind)) details.push(`Kind: ${asString(m.kind)}`);
  } else if (type === "prompt_library") {
    if (typeof m.count === "number" && m.count > 0) details.push(`${m.count} prompts`);
  } else if (type === "icon_bundle") {
    if (typeof m.count === "number" && m.count > 0) details.push(`${m.count} icons`);
  }
  return details;
}

async function readProductDir(root: string, id: string): Promise<StorefrontProduct | null> {
  let raw: string;
  try {
    raw = await readFile(join(root, id, "manifest.json"), "utf-8");
  } catch {
    return null;
  }
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const type = asString(m.type) ?? asString(m.kind) ?? inferTypeFromDir(id) ?? "product";
  const cat = CATEGORY_BY_TYPE[type] ?? { slug: "other", label: "Other" };
  const title = asString(m.title) ?? asString(m.name) ?? asString(m.topic) ?? prettifyDirName(id);
  const subtitle = asString(m.subtitle);
  const description = asString(m.description) ?? (subtitle ? null : asString(m.topic));
  let files: string[] = [];
  try {
    files = (await readdir(join(root, id))).filter((f) => !f.startsWith("."));
  } catch {
    files = [];
  }
  const preview = pickPreviewImage(files);
  const included =
    m.files && typeof m.files === "object"
      ? Object.values(m.files as Record<string, unknown>)
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.split("/").pop() ?? v)
          .filter(Boolean)
      : [];
  return {
    id,
    category: cat.slug,
    categoryLabel: cat.label,
    type,
    title,
    subtitle,
    description,
    createdAt: asString(m.createdAt),
    previewImage: preview ? `/api/v1/digital/files/${encodeURIComponent(id)}/${encodeURIComponent(preview)}` : null,
    badge:
      type === "coloring_book"
        ? "Coloring Book"
        : type === "website_template"
          ? "Website Template"
          : null,
    details: buildDetails(type, m),
    includedFiles: [...new Set(included)],
    hasZip: existsSync(join(root, `${id}.zip`)),
  };
}

export interface StoreCatalog {
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  /** Product folders skipped (no/unreadable manifest) — never a crash. */
  skipped: number;
}

/** Read every product manifest under the digital root, newest first.
 * Hidden products are excluded unless `includeHidden` is set (the
 * admin panel lists them; the public store never sees them). */
export async function listStoreProducts(opts?: { includeHidden?: boolean }): Promise<StoreCatalog> {
  const root = digitalRoot();
  const hidden = await readHiddenIds();
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return { products: [], categories: [], skipped: 0 };
  }
  const products: StorefrontProduct[] = [];
  let skipped = 0;
  for (const id of entries) {
    const p = await readProductDir(root, id);
    if (!p) {
      skipped++;
      continue;
    }
    p.hidden = hidden.has(id);
    if (p.hidden && !opts?.includeHidden) continue;
    products.push(p);
  }
  products.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at || a.title.localeCompare(b.title);
  });
  const counts = new Map<string, { label: string; count: number }>();
  for (const p of products) {
    const c = counts.get(p.category) ?? { label: p.categoryLabel, count: 0 };
    c.count++;
    counts.set(p.category, c);
  }
  const categories: StorefrontCategory[] = [...counts.entries()]
    .map(([slug, c]) => ({ slug, label: c.label, count: c.count }))
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.slug);
      const bi = CATEGORY_ORDER.indexOf(b.slug);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.label.localeCompare(b.label);
    });
  return { products, categories, skipped };
}

/** One product by category + id, or null (wrong category / missing / hidden). */
export async function getStoreProduct(category: string, id: string): Promise<StorefrontProduct | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
  const hidden = await readHiddenIds();
  if (hidden.has(id)) return null;
  const p = await readProductDir(digitalRoot(), id);
  if (!p || p.category !== category) return null;
  return p;
}

/** All known category slugs (for route validation). */
export function knownCategorySlugs(): string[] {
  return [...new Set(Object.values(CATEGORY_BY_TYPE).map((c) => c.slug)), "other"];
}

/**
 * Raw manifest JSON for one product dir, or null. Used by the ebook
 * landing page, which needs fields the StorefrontProduct card does not
 * carry (estimatedPrice, chapters). Does NOT apply the hidden filter —
 * callers check that themselves.
 */
export async function readRawManifest(id: string): Promise<Record<string, unknown> | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
  let raw: string;
  try {
    raw = await readFile(join(digitalRoot(), id, "manifest.json"), "utf-8");
  } catch {
    return null;
  }
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    return m && typeof m === "object" ? m : null;
  } catch {
    return null;
  }
}

/** True when a product dir is hidden from the public store. */
export async function isStoreProductHidden(id: string): Promise<boolean> {
  return (await readHiddenIds()).has(id);
}
