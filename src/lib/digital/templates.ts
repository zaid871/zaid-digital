/**
 * Template-pack generator — niche in, sellable design pack out.
 *
 * Each design is generated from a deterministic layout spec into:
 *  - an editable SVG source (buyers can edit text/shapes in vector tools;
 *    SVG can also be uploaded into Canva — subject to Canva's own plan
 *    rules, which the delivery notes state honestly), and
 *  - a ready-to-post PNG preview rendered from that SVG via ffmpeg's
 *    librsvg decoder (skipped with a warning when unavailable).
 *
 * Copy (headlines/bodies) is realistic SAMPLE text — templates are meant
 * to be edited by the buyer. Copy comes from the free LLM chain when a
 * textGen is supplied, otherwise from the built-in copy bank (with a
 * warning recorded). Pack ships with pack-preview.html, manifest, zip.
 */
import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { wrapWords } from "../pipeline/assets";
import { generateImage } from "../providers/pollinations";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";
import { angleShiftLine, type AngleShift } from "./prompts";
import type { TextGen } from "./ebook";

const execFileAsync = promisify(execFile);

export type TemplateSize = "square" | "portrait" | "story" | "card" | "poster";
export type TemplateKind = "quote" | "tips" | "promo" | "announcement" | "checklist" | "sale" | "event" | "testimonial" | "chart" | "table" | "logo" | "wedding_invite" | "planner_page" | "svg_cut" | "resume" | "onboarding" | "wall_art";

/** One section of a resume design (heading + up to 3 sample lines). */
export interface ResumeSection {
  heading: string;
  lines: string[];
}

/** Resume content (sample data — the buyer edits it). */
export interface ResumeData {
  name?: string;
  title?: string;
  contact?: string;
  sections?: ResumeSection[];
}

/** One bar of a chart design (values are sample data — the buyer edits them). */
export interface ChartDatum {
  label: string;
  value: number;
}

/** One row of a table design (sample data — the buyer edits it). */
export interface TableRow {
  label: string;
  value: string;
}

export const TEMPLATE_SIZES: Record<TemplateSize, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "Instagram post (1:1)" },
  portrait: { width: 1080, height: 1350, label: "Instagram portrait (4:5)" },
  story: { width: 1080, height: 1920, label: "Story / Reel cover (9:16)" },
  card: { width: 1050, height: 600, label: "Business card (3.5x2 in)" },
  poster: { width: 2400, height: 3000, label: "Wall art poster 8x10in @300dpi" },
};

export interface TemplateTheme {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  /** Second accent (trims/bands) — defaults to `accent` when unset. */
  accent2?: string;
}

/**
 * Premium themes (BlankBuilder system: one base + one/two restrained
 * accents). onyx = black + silver medallion; ember = orange + black
 * (panda tee); tealrust = warm white + teal + rust (tribal tee).
 */
export const TEMPLATE_THEMES: Record<"dark" | "light" | "sand" | "forest" | "wine" | "onyx" | "ember" | "tealrust", TemplateTheme> = {
  dark: { bg: "#111318", fg: "#FFFFFF", muted: "#B9BEC9", accent: "#FF6B35" },
  light: { bg: "#FAF7F2", fg: "#1C1C22", muted: "#5C5C66", accent: "#E4572E" },
  sand: { bg: "#EFE6DA", fg: "#2A2118", muted: "#6E5F4E", accent: "#B4551F" },
  forest: { bg: "#0E1F16", fg: "#F2F7F2", muted: "#A8BFA9", accent: "#E8B84B" },
  wine: { bg: "#241119", fg: "#FBF3F5", muted: "#D3A7B3", accent: "#E87A90" },
  onyx: { bg: "#0B0B0D", fg: "#FFFFFF", muted: "#B9BEC9", accent: "#C9CDD3", accent2: "#7A7F88" },
  ember: { bg: "#E85A24", fg: "#141414", muted: "#4A2E1E", accent: "#141414", accent2: "#FFFFFF" },
  tealrust: { bg: "#FAF7F2", fg: "#14201E", muted: "#5C6B66", accent: "#0F766E", accent2: "#B4551F" },
};

export interface TemplateDesign {
  id: string;
  kind: TemplateKind;
  headline: string;
  body: string;
  footer: string;
  svg: string;
  svgFile: string;
  pngFile: string | null;
}

export interface TemplatePackRequest {
  niche: string;
  count?: number;
  size?: TemplateSize;
  theme?: "dark" | "light" | "sand" | "forest" | "wine" | "onyx" | "ember" | "tealrust";
  /** "premium" = BlankBuilder system (trim bands, shadow backdrop,
   *  motif echo at three scales, oversized headline). Default standard. */
  designStyle?: "standard" | "premium";
  brandColor?: string;
  packName?: string;
  handle?: string;
  useAiCopy?: boolean;
  /** Photo background (Canva-style): one AI image per pack, embedded in
   *  every design's SVG + rendered into the PNG previews. */
  photoBackground?: boolean;
  backgroundPrompt?: string;
  /** White inset frame around photo-background designs. */
  frame?: boolean;
  /** Chart / table sample data (defaults are generic samples). */
  chartData?: ChartDatum[];
  tableData?: TableRow[];
  /** Restrict the pack to these kinds (rotated in order). Default: all kinds. */
  kinds?: TemplateKind[];
  /**
   * Angle Shift (Utkarsh Gose) — how this pack stands out from
   * competitors: narrow_audience | language_examples | format_change.
   * Unset = unchanged behaviour. See docs/winning-product-validation.md.
   */
  angle?: AngleShift;
  /** Resume content for the resume kind (sample data when omitted). */
  resumeData?: ResumeData;
  /** Onboarding flow steps (sample steps when omitted, max 6). */
  steps?: string[];
}

export interface TemplatePackResult {
  packName: string;
  slug: string;
  dir: string;
  size: TemplateSize;
  designs: TemplateDesign[];
  files: { manifest: string; zip: string | null; previewHtml: string };
  warnings: string[];
}

const KINDS: TemplateKind[] = ["quote", "tips", "announcement", "checklist", "promo", "sale", "event", "testimonial", "chart", "table", "logo", "wedding_invite", "planner_page", "svg_cut", "resume", "onboarding", "wall_art"];

const KIND_LABELS: Record<TemplateKind, string> = {
  quote: "QUOTE",
  tips: "TIPS",
  promo: "FOR YOU",
  announcement: "NEW POST",
  checklist: "CHECKLIST",
  sale: "SALE",
  event: "YOU'RE INVITED",
  testimonial: "REVIEW",
  chart: "NUMBERS",
  table: "PLAN",
  logo: "LOGO",
  wedding_invite: "SHADI",
  planner_page: "PLANNER",
  svg_cut: "SVG CUT",
  resume: "RESUME",
  onboarding: "ONBOARDING",
  wall_art: "WALL ART",
};

/** Sample resume content (buyer edits it — name/title/contact/sections). */
export const DEFAULT_RESUME_DATA: ResumeData = {
  name: "Ayesha Khan",
  title: "Digital Marketer — 5 saal ka tajurba",
  contact: "ayesha@example.com • +91 98765 43210",
  sections: [
    { heading: "Experience", lines: ["Senior Marketer, Bright Agency — 2023 se", "Social media campaigns, 40+ clients"] },
    { heading: "Education", lines: ["B.Com, Delhi University — 2019", "Digital Marketing Diploma — 2021"] },
    { heading: "Skills", lines: ["Instagram Reels • Canva • Meta Ads", "Hindi + English content"] },
  ],
};

/** Sample onboarding flow steps (buyer edits them). */
export const DEFAULT_ONBOARDING_STEPS: string[] = [
  "Inquiry — client ki zaroorat suno",
  "Discovery call — scope aur budget tay karo",
  "Proposal bhejo — price aur timeline likho",
  "Contract + advance — kaam shuru hone se pehle",
  "Kickoff — pehla deliverable aur timeline do",
];

/** Generic sample data for chart / table designs (buyer edits the values). */
export const DEFAULT_CHART_DATA: ChartDatum[] = [
  { label: "Week 1", value: 40 },
  { label: "Week 2", value: 65 },
  { label: "Week 3", value: 80 },
  { label: "Week 4", value: 55 },
];

export const DEFAULT_TABLE_DATA: TableRow[] = [
  { label: "Morning", value: "Revision" },
  { label: "Afternoon", value: "Practice" },
  { label: "Evening", value: "Notes" },
  { label: "Night", value: "Rest" },
];

/** Deterministic fallback copy — realistic samples, always niche-aware. */
function bankCopy(kind: TemplateKind, niche: string): { headline: string; body: string } {
  const n = niche.trim();
  switch (kind) {
    case "quote":
      return {
        headline: "Chhoti aadat, bada badlav.",
        body: `Har roz ek chhota kadam — ${n} me aage badhne ka yahi raaz hai.`,
      };
    case "tips":
      return {
        headline: `${n} ke 3 asaan tips`,
        body: "1. Chhota shuru karo  2. Roz thoda waqt do  3. Progress note karo",
      };
    case "announcement":
      return {
        headline: "Naya post aa gaya hai!",
        body: `${n} par aaj ka khaas content — miss mat karna.`,
      };
    case "checklist":
      return {
        headline: "Aaj ki checklist",
        body: "Plan banao - Kaam shuru karo - Review karo - Kal ke liye note chhodo",
      };
    case "promo":
      return {
        headline: "Sirf aapke liye",
        body: `${n} se judne walo ke liye khaas mauqa — tafseel caption me hai.`,
      };
    case "sale":
      return {
        headline: "Khaas offer, seemit waqt",
        body: `${n} par aaj ki khaas peshkash — tafseel ke liye caption dekho.`,
      };
    case "event":
      return {
        headline: "Aapko daawat hai!",
        body: `${n} ke khaas event me shamil ho — tareekh aur jagah caption me hai.`,
      };
    case "testimonial":
      return {
        headline: "Unhone kya kaha?",
        body: `"${n} ne mera kaam aasan kar diya." — ek khush customer`,
      };
    case "chart":
      return {
        headline: `${n} — numbers me`,
        body: "Sample data hai — apne numbers se badlo.",
      };
    case "table":
      return {
        headline: `${n} ka plan`,
        body: "Sample rows hain — apna content daalo.",
      };
    case "logo":
      return {
        headline: n,
        body: "Aapki pehchan, ek nishan.",
      };
    case "wedding_invite":
      return {
        headline: "Do dil, ek kahani.",
        body: "Shaadi ki tareekh aur jagah yahan likho — sample text hai, apne details se badlo.",
      };
    case "planner_page":
      return {
        headline: "Hafte ka plan",
        body: "Sample time-blocks hain — apna schedule daalo.",
      };
    case "svg_cut":
      return {
        headline: "Cut-ready design",
        body: "SVG + PNG — Cricut aur Silhouette ke liye tayyar. Test karke becho.",
      };
    case "resume":
      return {
        headline: "Ayesha Khan",
        body: "Digital Marketer — 5 saal ka tajurba",
      };
    case "onboarding":
      return {
        headline: "Client onboarding",
        body: "5 steps — inquiry se kickoff tak.",
      };
    case "wall_art":
      return {
        headline: "Shanti",
        body: "Ghar ke liye art print — sample text.",
      };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface DesignCopy {
  kind: TemplateKind;
  headline: string;
  body: string;
}

export interface BuildSvgOpts {
  /** base64 data URI (with mime) of the photo background, or null. */
  photo?: string | null;
  frame?: boolean;
  chartData?: ChartDatum[];
  tableData?: TableRow[];
  /** Resume content for the resume kind (sample data when omitted). */
  resumeData?: ResumeData;
  /** Onboarding flow steps (sample steps when omitted). */
  steps?: string[];
  /** "premium" = BlankBuilder system (bands, shadow, motif echo, oversized type). */
  designStyle?: "standard" | "premium";
  /** Second label line under the kind label (premium only) — the niche. */
  subtitle?: string;
}

/**
 * Small decorative motif per kind (Canva-style shape accents).
 * BlankBuilder's echo rule: the same motif appears at three scales —
 * giant faded centre (the "back print"), medium top-right (the "chest"),
 * small top-left (the "sleeve") — so each design reads as one system.
 */
function motifSvg(
  kind: TemplateKind,
  theme: TemplateTheme,
  x: number,
  y: number,
  scale = 1,
  opacity = 1
): string {
  const a = theme.accent;
  let inner = "";
  switch (kind) {
    case "testimonial":
      inner = `<polygon points="0,-26 7,-8 25,-8 11,4 16,22 0,11 -16,22 -11,4 -25,-8 -7,-8" fill="${a}"/>`;
      break;
    case "checklist":
      inner = `<polyline points="0,4 10,16 30,-12" fill="none" stroke="${a}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "sale":
      inner = `<g><path d="M4,4 H30 L46,20 L30,36 H4 Z" fill="${a}"/><circle cx="14" cy="20" r="4" fill="${theme.bg}"/></g>`;
      break;
    case "event":
      inner = `<g><rect x="0" y="0" width="44" height="40" rx="4" fill="none" stroke="${a}" stroke-width="4"/><rect x="0" y="0" width="44" height="10" fill="${a}"/><line x1="12" y1="-4" x2="12" y2="8" stroke="${a}" stroke-width="4"/><line x1="32" y1="-4" x2="32" y2="8" stroke="${a}" stroke-width="4"/></g>`;
      break;
    case "quote":
      inner = `<text x="-16" y="34" font-family="Poppins, DejaVu Sans, sans-serif" font-size="96" font-weight="bold" fill="${a}">\u201C</text>`;
      break;
    case "tips":
      inner = `<polygon points="0,-30 8,-8 30,0 8,8 0,30 -8,8 -30,0 -8,-8" fill="${a}"/>`;
      break;
    case "promo":
      inner = `<polygon points="0,-30 7,-10 22,-22 12,-5 30,0 12,5 22,22 7,10 0,30 -7,10 -22,22 -12,5 -30,0 -12,-5 -22,-22 -7,-10" fill="${a}"/>`;
      break;
    case "announcement":
      inner = `<g><line x1="0" y1="0" x2="0" y2="60" stroke="${a}" stroke-width="5" stroke-linecap="round"/><path d="M0,0 H34 L26,10 L34,20 H0 Z" fill="${a}"/></g>`;
      break;
    case "chart":
      inner = `<g><rect x="-26" y="26" width="12" height="24" rx="3" fill="${a}"/><rect x="-6" y="12" width="12" height="38" rx="3" fill="${a}"/><rect x="14" y="0" width="12" height="50" rx="3" fill="${a}"/></g>`;
      break;
    case "table":
      inner = `<g fill="${a}"><rect x="-26" y="0" width="22" height="22" rx="4"/><rect x="4" y="0" width="22" height="22" rx="4"/><rect x="-26" y="30" width="22" height="22" rx="4"/><rect x="4" y="30" width="22" height="22" rx="4"/></g>`;
      break;
    case "logo":
      inner = `<g><circle cx="0" cy="0" r="24" fill="none" stroke="${a}" stroke-width="6"/><circle cx="0" cy="0" r="8" fill="${a}"/></g>`;
      break;
    case "wedding_invite":
      // Two interlocked rings (all inner coords non-negative — the
      // house test flags y="-N" in the final SVG string).
      inner = `<g><circle cx="4" cy="16" r="16" fill="none" stroke="${a}" stroke-width="5"/><circle cx="28" cy="16" r="16" fill="none" stroke="${a}" stroke-width="5"/></g>`;
      break;
    case "planner_page":
      // Calendar grid with day dots (all inner coords non-negative).
      inner = `<g><rect x="0" y="0" width="44" height="40" rx="4" fill="none" stroke="${a}" stroke-width="4"/><line x1="0" y1="12" x2="44" y2="12" stroke="${a}" stroke-width="3"/><circle cx="11" cy="22" r="3" fill="${a}"/><circle cx="22" cy="22" r="3" fill="${a}"/><circle cx="33" cy="22" r="3" fill="${a}"/><circle cx="11" cy="32" r="3" fill="${a}"/><circle cx="22" cy="32" r="3" fill="${a}"/></g>`;
      break;
    case "svg_cut":
      // Scissors (cut-file mark, all inner coords non-negative).
      inner = `<g><circle cx="0" cy="32" r="7" fill="none" stroke="${a}" stroke-width="4"/><circle cx="0" cy="4" r="7" fill="none" stroke="${a}" stroke-width="4"/><line x1="6" y1="28" x2="44" y2="4" stroke="${a}" stroke-width="4" stroke-linecap="round"/><line x1="6" y1="8" x2="44" y2="32" stroke="${a}" stroke-width="4" stroke-linecap="round"/></g>`;
      break;
    case "resume":
      // Document with text lines (all inner coords non-negative).
      inner = `<g><rect x="0" y="0" width="36" height="44" rx="4" fill="none" stroke="${a}" stroke-width="4"/><line x1="8" y1="12" x2="28" y2="12" stroke="${a}" stroke-width="3"/><line x1="8" y1="20" x2="28" y2="20" stroke="${a}" stroke-width="3"/><line x1="8" y1="28" x2="20" y2="28" stroke="${a}" stroke-width="3"/></g>`;
      break;
    case "onboarding":
      // Three steps joined by a line (all inner coords non-negative).
      inner = `<g><circle cx="6" cy="18" r="6" fill="${a}"/><circle cx="22" cy="18" r="6" fill="${a}"/><circle cx="38" cy="18" r="6" fill="${a}"/><line x1="12" y1="18" x2="16" y2="18" stroke="${a}" stroke-width="3"/><line x1="28" y1="18" x2="32" y2="18" stroke="${a}" stroke-width="3"/></g>`;
      break;
    case "wall_art":
      // Picture frame with mountain + sun (all inner coords non-negative).
      inner = `<g><rect x="0" y="0" width="44" height="36" rx="3" fill="none" stroke="${a}" stroke-width="4"/><circle cx="32" cy="10" r="4" fill="${a}"/><polyline points="4,30 16,16 24,24 32,14 40,30" fill="none" stroke="${a}" stroke-width="3" stroke-linejoin="round"/></g>`;
      break;
  }
  if (!inner) return "";
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${opacity}">${inner}</g>`;
}

/**
 * Premium frame (BlankBuilder's construction details): a thick accent
 * trim band on the top edge + a thin second-accent band on the bottom
 * edge (ringer collar / sleeve band), over a subtle studio shadow
 * backdrop — diagonal "window-blind" stripes + a soft vignette.
 */
function premiumFrameSvg(theme: TemplateTheme, W: number, H: number): string {
  const accent2 = theme.accent2 ?? theme.accent;
  const stripes: string[] = [];
  for (let x = -H; x < W + H; x += 190) {
    stripes.push(`<line x1="${x}" y1="-40" x2="${x + H + 80}" y2="${H + 40}" stroke="${theme.fg}" stroke-width="30"/>`);
  }
  return `<defs><radialGradient id="prem-vig" cx="0.5" cy="0.42" r="0.78"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.14"/></radialGradient></defs>
  <g opacity="0.05">${stripes.join("")}</g>
  <rect width="${W}" height="${H}" fill="url(#prem-vig)"/>
  <rect x="0" y="0" width="${W}" height="18" fill="${theme.accent}"/>
  <rect x="0" y="${H - 10}" width="${W}" height="10" fill="${accent2}"/>`;
}

/** Premium motif echo: giant faded centre + small top-left (medium top-right is the existing motif call). */
function premiumEchoSvg(kind: TemplateKind, theme: TemplateTheme, W: number, H: number, pad: number): string {
  return `${motifSvg(kind, theme, Math.round(W / 2), Math.round(H * 0.52), 6, 0.07)}${motifSvg(kind, theme, pad + 220, pad + 26, 0.55, 0.9)}`;
}

/** Build one design's SVG from its layout spec. */
export function buildSvg(
  copy: DesignCopy,
  size: TemplateSize,
  theme: TemplateTheme,
  footer: string,
  opts?: BuildSvgOpts
): string {
  const { width: W, height: H } = TEMPLATE_SIZES[size];
  const premium = opts?.designStyle === "premium";
  const premiumFrame = premium ? premiumFrameSvg(theme, W, H) : "";
  const subtitle = (opts?.subtitle ?? "").trim();
  // Logo design: centered mark, not the social layout — a monogram disc
  // (first letters of the brand name) + wordmark + tagline. Scales to
  // any size, including the business-card size.
  if (copy.kind === "logo") {
    const words = copy.headline.trim().split(/\s+/).filter(Boolean);
    const mono = (words.slice(0, 2).map((w) => w[0] ?? "").join("") || "A").toUpperCase();
    const r = Math.round(Math.min(W, H) * 0.16);
    const cx = Math.round(W / 2);
    const cy = Math.round(H * 0.36);
    const nameSize = size === "card" ? 46 : 76;
    const nameLh = size === "card" ? 56 : 92;
    const tagSize = size === "card" ? 24 : 34;
    const nameLines = wrapWords(copy.headline, 14).slice(0, 2);
    const tagLines = wrapWords(copy.body, 30).slice(0, 2);
    const nameY = cy + r + 72;
    const tagY = nameY + nameLines.length * nameLh + 12;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  ${premiumFrame}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${theme.accent}"/>
  <text x="${cx}" y="${cy + Math.round(r * 0.36)}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${Math.round(r * 0.95)}" font-weight="bold" text-anchor="middle" fill="${theme.bg}">${escapeXml(mono)}</text>
  <text x="${cx}" y="${Math.round(H * 0.12)}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="27" letter-spacing="5" text-anchor="middle" fill="${theme.accent}">${escapeXml(KIND_LABELS[copy.kind])}</text>
${nameLines.map((line, i) => `  <text x="${cx}" y="${nameY + i * nameLh}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${nameSize}" font-weight="bold" text-anchor="middle" fill="${theme.fg}">${escapeXml(line)}</text>`).join("\n")}
${tagLines.map((line, i) => `  <text x="${cx}" y="${tagY + i * (tagSize + 12)}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${tagSize}" text-anchor="middle" fill="${theme.muted}">${escapeXml(line)}</text>`).join("\n")}
  <rect x="${cx - 32}" y="${H - 76}" width="64" height="5" fill="${theme.accent}"/>
  <text x="${cx}" y="${H - 28}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="29" text-anchor="middle" fill="${theme.muted}">${escapeXml(footer)}</text>
</svg>
`;
  }
  // Business-card size is short (600px) — compact spacing, smaller type.
  const isCard = size === "card";
  const pad = isCard ? 48 : 76;

  // Resume design: a designed one-page resume — name, title, contact,
  // then sections (Experience / Education / Skills) from resumeData.
  // Card size is too short for a resume (rotated out in the pack).
  if (copy.kind === "resume") {
    const data = opts?.resumeData ?? DEFAULT_RESUME_DATA;
    const name = (data.name ?? copy.headline).trim() || copy.headline;
    const title = (data.title ?? copy.body).trim();
    const contact = (data.contact ?? footer).trim();
    const sections = (data.sections ?? DEFAULT_RESUME_DATA.sections ?? []).slice(0, 4);
    const nameSize = Math.round(W * 0.067);
    const titleSize = Math.round(W * 0.031);
    const headSize = 26;
    const lineSize = 30;
    const lineH = 42;
    const nameY = pad + 62 + nameSize + 18;
    const titleY = nameY + titleSize + 14;
    const contactY = titleY + 34;
    let y = (contact ? contactY : titleY) + 44;
    const sectionSvg: string[] = [];
    for (const s of sections) {
      if (y + 80 > H - 110) break;
      sectionSvg.push(
        `<text x="${pad}" y="${y}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${headSize}" letter-spacing="4" font-weight="bold" fill="${theme.accent}">${escapeXml(s.heading.toUpperCase().slice(0, 30))}</text>`
      );
      y += 46;
      for (const line of s.lines.slice(0, 3)) {
        if (y + 30 > H - 110) break;
        for (const wl of wrapWords(line, 52).slice(0, 2)) {
          if (y + 30 > H - 110) break;
          sectionSvg.push(
            `<text x="${pad}" y="${y}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${lineSize}" fill="${theme.fg}">${escapeXml(wl)}</text>`
          );
          y += lineH;
        }
      }
      y += 18;
      if (y < H - 110) {
        sectionSvg.push(
          `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="${theme.muted}" stroke-opacity="0.3" stroke-width="2"/>`
        );
        y += 26;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  ${premiumFrame}
  <rect x="0" y="0" width="14" height="${H}" fill="${theme.accent}"/>
  <text x="${pad}" y="${pad + 62}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="27" letter-spacing="5" fill="${theme.accent}">${escapeXml(KIND_LABELS[copy.kind])}</text>
  <text x="${pad}" y="${nameY}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${nameSize}" font-weight="bold" fill="${theme.fg}">${escapeXml(name.slice(0, 30))}</text>
  ${title ? `<text x="${pad}" y="${titleY}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${titleSize}" fill="${theme.muted}">${escapeXml(title.slice(0, 60))}</text>` : ""}
  ${contact ? `<text x="${pad}" y="${contactY}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="26" fill="${theme.muted}">${escapeXml(contact.slice(0, 60))}</text>` : ""}
  ${sectionSvg.join("\n  ")}
  <rect x="${pad}" y="${H - pad - 52}" width="64" height="5" fill="${theme.accent}"/>
  <text x="${pad}" y="${H - pad}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="29" fill="${theme.muted}">${escapeXml(footer)}</text>
</svg>
`;
  }

  // Wall art print: full-bleed photo or giant motif + small caption.
  // Poster size (2400x3000) is print resolution; other sizes render the
  // same art smaller. The motif is centred on its anchor point.
  if (copy.kind === "wall_art") {
    const captionSize = Math.round(W * 0.045);
    const wallPhoto = opts?.photo ?? null;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  ${wallPhoto ? `<image href="${wallPhoto}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>\n  <rect width="${W}" height="${H}" fill="${theme.bg}" fill-opacity="0.25"/>` : ""}
  ${premiumFrame}
  ${wallPhoto ? "" : motifSvg(copy.kind, theme, Math.round(W / 2) - 264, Math.round(H * 0.44) - 216, 12, 0.9)}
  <rect x="${Math.round(W / 2) - 40}" y="${H - 190}" width="80" height="6" fill="${theme.accent}"/>
  <text x="${Math.round(W / 2)}" y="${H - 120}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${captionSize}" font-weight="bold" text-anchor="middle" fill="${theme.fg}">${escapeXml(copy.headline.slice(0, 40))}</text>
  <text x="${Math.round(W / 2)}" y="${H - 70}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${Math.round(captionSize * 0.55)}" text-anchor="middle" fill="${theme.muted}">${escapeXml(footer)}</text>
</svg>
`;
  }
  // Premium = oversized display headline (BlankBuilder's huge two-line
  // cover titles), tighter wrap so fewer, bigger words fill the frame.
  const headlineLines = wrapWords(copy.headline, premium ? (W >= 1080 ? 12 : 10) : (W >= 1080 ? 16 : 14)).slice(0, 4);
  const bodyLines = wrapWords(copy.body, 34).slice(0, 5);
  const headlineSize = premium ? (isCard ? 72 : 108) : (isCard ? 54 : 78);
  const headlineLh = premium ? (isCard ? 82 : 122) : (isCard ? 64 : 96);
  const bodySize = isCard ? 26 : 35;
  const bodyLh = isCard ? 36 : 50;

  const headlineY = Math.round(H * (isCard ? 0.26 : 0.3));
  const headlineSvg = headlineLines
    .map(
      (line, i) =>
        `<text x="${pad}" y="${headlineY + i * headlineLh}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${headlineSize}" font-weight="bold" fill="${theme.fg}">${escapeXml(line)}</text>`
    )
    .join("\n  ");
  const bodyY = headlineY + headlineLines.length * headlineLh + 44;
  const bodySvg = bodyLines
    .map(
      (line, i) =>
        `<text x="${pad}" y="${bodyY + i * bodyLh}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="${bodySize}" fill="${theme.muted}">${escapeXml(line)}</text>`
    )
    .join("\n  ");

  // Chart design: bars under the caption (sample data — buyer edits values).
  let chartSvg = "";
  if (copy.kind === "chart") {
    const data = (opts?.chartData ?? DEFAULT_CHART_DATA)
      .slice(0, 6)
      .map((d) => ({ label: String(d.label).slice(0, 12), value: Math.max(0, Number(d.value) || 0) }));
    const max = Math.max(...data.map((d) => d.value), 1);
    const chartTop = bodyY + bodyLines.length * bodyLh + 40;
    const chartH = Math.max(40, Math.min(420, H - chartTop - 220));
    const slotW = (W - pad * 2) / data.length;
    const barW = Math.min(140, slotW * 0.55);
    const bars = data
      .map((d, i) => {
        const x = Math.round(pad + i * slotW + (slotW - barW) / 2);
        const h = Math.round((d.value / max) * chartH);
        const y = chartTop + chartH - h;
        const cx = x + barW / 2;
        return `<rect x="${x}" y="${y}" width="${Math.round(barW)}" height="${h}" rx="6" fill="${theme.accent}"/><text x="${cx}" y="${y - 14}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="30" font-weight="bold" text-anchor="middle" fill="${theme.fg}">${d.value}</text><text x="${cx}" y="${chartTop + chartH + 38}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="26" text-anchor="middle" fill="${theme.muted}">${escapeXml(d.label)}</text>`;
      })
      .join("\n  ");
    chartSvg = `<line x1="${pad}" y1="${chartTop + chartH}" x2="${W - pad}" y2="${chartTop + chartH}" stroke="${theme.muted}" stroke-opacity="0.4" stroke-width="2"/>\n  ${bars}`;
  }

  // Table design: label/value rows under the caption (sample rows — buyer edits).
  // Planner pages reuse the same rows as time-blocks (Morning/Afternoon/...).
  let tableSvg = "";
  if (copy.kind === "table" || copy.kind === "planner_page") {
    // Short formats (business card) fit fewer rows — clamp, never overflow.
    const tableTop0 = bodyY + bodyLines.length * bodyLh + 30;
    const maxRows = Math.max(1, Math.floor((H - tableTop0 - 120) / 84));
    const rows = (opts?.tableData ?? DEFAULT_TABLE_DATA).slice(0, Math.min(6, maxRows));
    const rowH = 84;
    const tableTop = tableTop0;
    tableSvg = rows
      .map((r, i) => {
        const y = tableTop + i * rowH;
        const divider =
          i < rows.length - 1
            ? `<line x1="${pad}" y1="${y + 56}" x2="${W - pad}" y2="${y + 56}" stroke="${theme.muted}" stroke-opacity="0.3" stroke-width="2"/>`
            : "";
        return `<text x="${pad}" y="${y + 34}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="34" fill="${theme.fg}">${escapeXml(String(r.label).slice(0, 40))}</text><text x="${W - pad}" y="${y + 34}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="34" text-anchor="end" fill="${theme.accent}">${escapeXml(String(r.value).slice(0, 40))}</text>${divider}`;
      })
      .join("\n  ");
  }

  // Onboarding flow: numbered steps under the caption.
  let stepsSvg = "";
  if (copy.kind === "onboarding") {
    const steps = (opts?.steps ?? DEFAULT_ONBOARDING_STEPS).slice(0, 6);
    const stepsTop0 = bodyY + bodyLines.length * bodyLh + 30;
    const stepH = 118;
    const maxSteps = Math.max(1, Math.floor((H - stepsTop0 - 120) / stepH));
    const shown = steps.slice(0, maxSteps);
    const stepsTop = stepsTop0;
    stepsSvg = shown
      .map((s, i) => {
        const cy = stepsTop + i * stepH + 26;
        const line =
          i < shown.length - 1
            ? `<line x1="${pad + 26}" y1="${cy + 26}" x2="${pad + 26}" y2="${cy + stepH - 26}" stroke="${theme.accent}" stroke-width="4"/>`
            : "";
        const lines = wrapWords(s, 40).slice(0, 2);
        return `${line}<circle cx="${pad + 26}" cy="${cy}" r="26" fill="${theme.accent}"/><text x="${pad + 26}" y="${cy + 10}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="28" font-weight="bold" text-anchor="middle" fill="${theme.bg}">${i + 1}</text>${lines
          .map(
            (l, j) =>
              `<text x="${pad + 76}" y="${cy + j * 40}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="32" fill="${theme.fg}">${escapeXml(l)}</text>`
          )
          .join("")}`;
      })
      .join("\n  ");
  }

  const photo = opts?.photo ?? null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${theme.bg}"/>
  ${photo ? `<image href="${photo}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>\n  <rect width="${W}" height="${H}" fill="${theme.bg}" fill-opacity="0.62"/>` : ""}
  ${premiumFrame}
  ${premium ? premiumEchoSvg(copy.kind, theme, W, H, pad) : ""}
  <circle cx="${W - 60}" cy="${H - 120}" r="${isCard ? 140 : 300}" fill="${theme.accent}" fill-opacity="0.13"/>
  <circle cx="${pad + 20}" cy="${pad + 20}" r="10" fill="${theme.accent}"/>
  <rect x="${pad}" y="${pad}" width="128" height="11" fill="${theme.accent}"/>
  <text x="${pad}" y="${pad + 62}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="27" letter-spacing="5" fill="${theme.accent}">${escapeXml(KIND_LABELS[copy.kind])}</text>
  ${premium && subtitle ? `<text x="${pad}" y="${pad + 96}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="24" letter-spacing="3" fill="${theme.muted}">${escapeXml(subtitle.slice(0, 40))}</text>` : ""}
  ${motifSvg(copy.kind, theme, W - pad - 48, pad + 24)}
  ${headlineSvg}
  ${bodySvg}
  ${chartSvg}
  ${tableSvg}
  ${stepsSvg}
  <rect x="${pad}" y="${H - pad - 52}" width="64" height="5" fill="${theme.accent}"/>
  <text x="${pad}" y="${H - pad}" font-family="Poppins, DejaVu Sans, sans-serif" font-size="29" fill="${theme.muted}">${escapeXml(footer)}</text>
  ${opts?.frame ? `<rect x="32" y="32" width="${W - 64}" height="${H - 64}" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-opacity="0.9"/>` : ""}
</svg>
`;
}

/** Render a PNG preview from an SVG via ffmpeg's librsvg decoder. Exported for the brand-kit generator. */
export async function renderPreview(svgPath: string, pngPath: string, width: number, height: number): Promise<boolean> {
  try {
    await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-y", "-i", svgPath, "-vf", `scale=${width}:${height}`, "-frames:v", "1", pngPath],
      { timeout: 60_000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function aiCopy(
  req: TemplatePackRequest,
  kinds: TemplateKind[],
  textGen: TextGen
): Promise<DesignCopy[] | null> {
  const prompt = [
    `Write social-media template copy for the niche: "${req.niche}".`,
    `Reply with ONLY a JSON array of ${kinds.length} objects, one per kind in this exact order: ${kinds.join(", ")}.`,
    `Each object: {"kind": "<kind>", "headline": "short punchy sample headline (max 6 words)", "body": "one short sample line (max 16 words)"}.`,
    `Write in Roman-script Hinglish. Sample text only — NO prices, NO discounts, NO income or result promises, NO fake claims.`,
    angleShiftLine(req.angle),
  ].filter(Boolean).join("\n");
  try {
    const raw = await textGen(prompt, 900);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(raw.slice(start, end + 1)) as DesignCopy[];
    if (!Array.isArray(arr) || arr.length !== kinds.length) return null;
    const ok = arr.every(
      (d, i) => d && d.kind === kinds[i] && typeof d.headline === "string" && d.headline.trim() && typeof d.body === "string"
    );
    return ok ? arr.map((d) => ({ kind: d.kind, headline: d.headline.trim(), body: d.body.trim() })) : null;
  } catch {
    return null;
  }
}

/** Default photo-background image generator (Pollinations FLUX). */
async function defaultImageGen(prompt: string, width: number, height: number): Promise<Buffer | null> {
  const img = await generateImage({ prompt, width, height, model: "flux" });
  if (!img.ok) return null;
  return Buffer.from(img.data);
}

/** Generate a complete template pack (SVGs + PNG previews + manifest + zip). */
export async function generateTemplatePack(
  req: TemplatePackRequest,
  deps?: { textGen?: TextGen; outRoot?: string; imageGen?: (prompt: string, width: number, height: number) => Promise<Buffer | null> }
): Promise<TemplatePackResult> {
  const count = Math.min(20, Math.max(4, req.count ?? 10));
  const size: TemplateSize = req.size ?? "portrait";
  const baseTheme = TEMPLATE_THEMES[req.theme ?? "dark"];
  const theme: TemplateTheme =
    req.brandColor && /^#[0-9a-fA-F]{6}$/.test(req.brandColor)
      ? { ...baseTheme, accent: req.brandColor }
      : baseTheme;
  const packName = (req.packName ?? `${req.niche} Templates`).trim();
  const footer = (req.handle ?? "@yourhandle").trim();
  // Poster size is wall-art only (print resolution, 2400x3000) — other
  // kinds are social layouts and would render tiny at that scale.
  // A `kinds` filter narrows the rotation (e.g. a wedding-only pack);
  // a filter that leaves nothing usable at this size falls back to the
  // full non-table rotation instead of an empty pack.
  const requested =
    size === "poster"
      ? (["wall_art"] as TemplateKind[])
      : req.kinds && req.kinds.length > 0
        ? Array.from(new Set(req.kinds.filter((k) => KINDS.includes(k))))
        : KINDS;
  // Business cards are too short for chart/table/planner/resume/
  // onboarding sections — they rotate out of the card-size pack
  // (the logo layout works at any size).
  const CARD_OUT: TemplateKind[] = ["chart", "table", "planner_page", "resume", "onboarding"];
  const filtered = size === "card" ? requested.filter((k) => !CARD_OUT.includes(k)) : requested;
  const usableKinds = filtered.length > 0 ? filtered : KINDS.filter((k) => !CARD_OUT.includes(k));
  const kinds = Array.from({ length: count }, (_, i) => usableKinds[i % usableKinds.length]);
  const warnings: string[] = [];

  let copies: DesignCopy[] | null = null;
  if (req.useAiCopy !== false && deps?.textGen) {
    copies = await aiCopy(req, kinds, deps.textGen);
    if (!copies) warnings.push("ai_copy_fallback: AI copy nahi bani — built-in sample copy use hui hai");
  }
  if (!copies) {
    copies = kinds.map((kind) => ({ kind, ...bankCopy(kind, req.niche) }));
  }

  const slug = slugify(packName);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  // Photo background (Canva-style): ONE image per pack, shared by every
  // design — cohesive look, one image-gen call, quota-friendly. Failure
  // never fails the pack: text-only designs ship with a warning.
  const { width, height } = TEMPLATE_SIZES[size];
  let photo: string | null = null;
  let backgroundFile: string | null = null;
  if (req.photoBackground === true) {
    const prompt =
      (req.backgroundPrompt ?? "").trim() ||
      `Premium ${req.niche} background photo, cinematic lighting, clean negative space for text, no text, no words, no letters, photorealistic`;
    try {
      const imageGen = deps?.imageGen ?? defaultImageGen;
      const buf = await imageGen(prompt, width, height);
      if (buf && buf.length > 0) {
        const mime = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : "image/jpeg";
        photo = `data:${mime};base64,${buf.toString("base64")}`;
        backgroundFile = mime === "image/png" ? "background.png" : "background.jpg";
        await writeFile(join(dir, backgroundFile), buf);
      } else {
        warnings.push("photo_background_failed: background image nahi bani — text-only designs banaye gaye hain");
      }
    } catch {
      warnings.push("photo_background_failed: background image nahi bani — text-only designs banaye gaye hain");
    }
  }

  const designs: TemplateDesign[] = [];
  let previewFailures = 0;
  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i];
    const id = `design-${String(i + 1).padStart(2, "0")}`;
    const svg = buildSvg(copy, size, theme, footer, {
      photo,
      frame: req.frame === true,
      designStyle: req.designStyle ?? "standard",
      subtitle: req.niche,
      chartData: copy.kind === "chart" ? (req.chartData ?? DEFAULT_CHART_DATA) : undefined,
      tableData:
        copy.kind === "table" || copy.kind === "planner_page"
          ? (req.tableData ?? DEFAULT_TABLE_DATA)
          : undefined,
      resumeData: copy.kind === "resume" ? req.resumeData : undefined,
      steps: copy.kind === "onboarding" ? req.steps : undefined,
    });
    const svgFile = `${id}.svg`;
    await writeFile(join(dir, svgFile), svg, "utf-8");
    const pngOk = await renderPreview(join(dir, svgFile), join(dir, `${id}.png`), width, height);
    if (!pngOk) previewFailures++;
    designs.push({
      id,
      kind: copy.kind,
      headline: copy.headline,
      body: copy.body,
      footer,
      svg,
      svgFile,
      pngFile: pngOk ? `${id}.png` : null,
    });
  }
  if (previewFailures > 0) {
    warnings.push(
      `preview_unavailable: ${previewFailures} design(s) ke PNG preview nahi bane (ffmpeg me librsvg decoder chahiye) — SVG files tayyar hain`
    );
  }

  const previewHtml = join(dir, "pack-preview.html");
  await writeFile(
    previewHtml,
    `<!doctype html><meta charset="utf-8"><title>${packName}</title><body style="background:#222;font-family:sans-serif;color:#fff"><h1>${packName}</h1>${designs
      .map(
        (d) =>
          `<figure style="display:inline-block;margin:10px">${d.pngFile ? `<img src="${d.pngFile}" width="270">` : `<div style="width:270px;height:200px;background:#444;display:flex;align-items:center;justify-content:center">SVG only</div>`}<figcaption>${d.id} — ${d.kind}</figcaption></figure>`
      )
      .join("")}</body>`,
    "utf-8"
  );

  const manifestPath = await writeManifest(dir, {
    type: "template_pack",
    packName,
    niche: req.niche,
    size,
    dimensions: `${width}x${height}`,
    theme: req.theme ?? "dark",
    designStyle: req.designStyle ?? "standard",
    angle: req.angle ?? null,
    accent: theme.accent,
    photoBackground: photo !== null,
    backgroundFile,
    designs: designs.map((d) => ({ id: d.id, kind: d.kind, headline: d.headline, svg: d.svgFile, png: d.pngFile })),
    deliveryNotes: [
      "Har design ki SVG file editable source hai — text aur rang badle ja sakte hain.",
      "SVG ko Canva me upload karke bhi edit kiya ja sakta hai; ye Canva ke apne plan rules par depend karta hai (kabhi kabhi Pro feature hota hai).",
      "PNG files tayyar istemal (ready-to-post) ke liye hain.",
      "Saara text sample hai — apna text daalkar istemal karein.",
      ...(designs.some((d) => d.kind === "wedding_invite")
        ? ["Wedding invite designs sample text ke saath hain — couple ke naam, tareekh aur venue buyer bharega."]
        : []),
      ...(designs.some((d) => d.kind === "svg_cut")
        ? ["SVG cut files: Cricut Design Space / Silhouette Studio me test karke becho; DXF file is pack me nahi hai."]
        : []),
      ...(designs.some((d) => d.kind === "planner_page")
        ? ["Planner pages printable hain (A4/Letter par print karo); hyperlinked (GoodNotes) version nahi hai."]
        : []),
      ...(designs.some((d) => d.kind === "resume")
        ? ["Resume designs sample content ke saath hain — apni details se badlo."]
        : []),
      ...(designs.some((d) => d.kind === "onboarding")
        ? ["Onboarding flow chart sample steps ke saath hai — apne steps se badlo; client tracker sheet spreadsheets lane me hai."]
        : []),
      ...(designs.some((d) => d.kind === "wall_art")
        ? ["Wall art poster 2400x3000 (8x10in @300dpi) — print-ready PNG + editable SVG."]
        : []),
      ...(photo !== null
        ? ["Photo background SVG mein embedded hai — background.jpg/png alag se bhi pack mein hai."]
        : []),
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });

  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    packName,
    slug,
    dir,
    size,
    designs,
    files: { manifest: manifestPath, zip: zipPath, previewHtml },
    warnings,
  };
}
