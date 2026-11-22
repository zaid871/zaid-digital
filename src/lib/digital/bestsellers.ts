/**
 * Bestseller Style Analyzer — jo templates/ebooks market mein full
 * demand mein hain aur full bik rahe hain, unka STYLE kya hai, usme
 * kya kami hai, aur usi style mein hum uniqueness kaise daalein.
 *
 * Honest limits (yeh design ka hissa hain, baad mein pata chalne wali
 * baat nahi):
 *  - Etsy/Gumroad/Creative Market ki per-listing SALES data ka koi free
 *    API nahi hai — sales numbers proprietary hain. Unki pages scrape
 *    karna ToS/ban risk hai (bot walls), isliye NAHI karte. Etsy ka
 *    Open API v3 (free key, key-only) listing search + shop total sales
 *    + reviews deta hai — yehi real platform signals hain (etsy.ts).
 *    Creative Market ka koi public API nahi; Gumroad ka API sirf apni
 *    khud ki sales ke liye hai. Unke liye manual lane + one-off browser
 *    read hai, scheduled scrape nahi.
 *
 * Output per niche: styleProfile (formats + styles + audience),
 * bestsellerEvidence (top video titles / manual entries), whatsMissing
 * (kya kami hai), uniquenessInStyle (usi style mein hamara twist).
 * YouTube key na ho to video step skip hota hai (warning) — baaki
 * analysis phir bhi chalta hai. Kuch bhi kabhi throw nahi karta.
 */
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { defaultTextGen, type TextGen } from "./ebook";
import { etsyEvidenceLine, searchEtsyListings } from "./etsy";

export interface CompetitorInput {
  title: string;
  source?: string;
  note?: string;
}

export interface TopVideo {
  title: string;
  channel: string;
  views: number;
}

export interface NicheBestseller {
  niche: string;
  styleProfile: string;
  formats: string[];
  styles: string[];
  audience: string[];
  bestsellerEvidence: string[];
  whatsMissing: string[];
  uniquenessInStyle: string[];
}

export interface BestsellersResult {
  niches: NicheBestseller[];
  warnings: string[];
}

type FetchFn = typeof fetch;

/** Deterministic style/format/audience keyword scan (no AI needed). */
const STYLE_WORDS = ["minimal", "aesthetic", "dark", "premium", "cute", "modern", "simple", "luxury", "clean", "elegant", "boho", "vintage"];
const FORMAT_WORDS = ["printable", "digital", "editable", "canva", "bundle", "a4", "pdf", "excel", "planner", "workbook"];
const AUDIENCE_WORDS = ["beginners", "students", "small business", "teachers", "moms", "freelancers", "creators", "brides"];

function scanWords(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w));
}

export function extractStyle(texts: string[]): { formats: string[]; styles: string[]; audience: string[] } {
  const joined = texts.join(" | ");
  return {
    formats: [...new Set(scanWords(joined, FORMAT_WORDS))],
    styles: [...new Set(scanWords(joined, STYLE_WORDS))],
    audience: [...new Set(scanWords(joined, AUDIENCE_WORDS))],
  };
}

/** Whats-missing bank (fallback when the LLM call fails). */
const MISSING_BANK = [
  "No Hinglish version — English packs ki bheed mein alag",
  "No printable + digital bundle — ek pack mein dono format",
  "No photo-background option — plain text packs se alag",
  "No local (Indian) context — dates, examples, festivals",
];

const UNIQUENESS_BANK = [
  "Hinglish copy — local audience ke liye",
  "Photo background option — plain packs se alag",
  "Printable + digital bundle — ek daam mein dono",
];

function complianceHit(text: string): boolean {
  return PRICE_PATTERN.test(text) || BANNED_CLAIM_PATTERN.test(text);
}

/**
 * YouTube Data API v3: top videos by viewCount for "{niche} template"
 * (and "{niche} ebook" when productType is ebook — caller passes the
 * query). Free key (YOUTUBE_API_KEY), 10k units/day. No key → [].
 * Never throws.
 */
export async function fetchTopVideos(
  query: string,
  apiKey: string | undefined,
  fetchFn: FetchFn = fetch
): Promise<TopVideo[]> {
  if (!apiKey) return [];
  try {
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
      `&order=viewCount&maxResults=5&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const sRes = await fetchFn(searchUrl, { signal: AbortSignal.timeout(15000) });
    if (!sRes.ok) return [];
    const sData = (await sRes.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }> };
    const items = (sData.items ?? []).filter((i) => i.id?.videoId && i.snippet?.title);
    if (!items.length) return [];
    const ids = items.map((i) => i.id!.videoId!).join(",");
    const vRes = await fetchFn(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${apiKey}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const viewsById = new Map<string, number>();
    if (vRes.ok) {
      const vData = (await vRes.json()) as { items?: Array<{ id?: string; statistics?: { viewCount?: string } }> };
      for (const v of vData.items ?? []) {
        if (v.id) viewsById.set(v.id, Number(v.statistics?.viewCount ?? 0));
      }
    }
    return items
      .map((i) => ({
        title: i.snippet!.title!.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
        channel: i.snippet!.channelTitle ?? "",
        views: viewsById.get(i.id!.videoId!) ?? 0,
      }))
      .sort((a, b) => b.views - a.views);
  } catch {
    return [];
  }
}

interface AiStyleOut {
  whatsMissing?: string[];
  uniquenessInStyle?: string[];
}

/** One LLM call for all niches: whats-missing + uniqueness-in-style. */
async function aiStyleAngles(
  niches: Array<{ niche: string; styleProfile: string; evidence: string[] }>,
  textGen: TextGen
): Promise<Map<number, AiStyleOut> | null> {
  const items = niches
    .map((n, i) => `${i + 1}. niche="${n.niche}", style="${n.styleProfile}", evidence: ${n.evidence.slice(0, 3).join(" | ")}`)
    .join("\n");
  const prompt = [
    "For each niche below, look at the bestseller style and evidence, then write:",
    '(a) 2 things MISSING in the bestsellers (gaps a new product can fill),',
    '(b) 2 uniqueness angles IN THE SAME STYLE as the bestsellers (same look/feel, our twist).',
    "Write in short Roman-script Hinglish. Reply with ONLY a JSON array, one object per niche in the same order.",
    'Each object: {"whatsMissing": ["gap 1 (max 14 words)", "gap 2"], "uniquenessInStyle": ["angle 1 (max 14 words)", "angle 2"]}.',
    "No prices, no discounts, no income or result promises, no fake claims.",
    items,
  ].join("\n");
  try {
    const raw = await textGen(prompt, 1600);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(raw.slice(start, end + 1)) as AiStyleOut[];
    if (!Array.isArray(arr) || arr.length !== niches.length) return null;
    const map = new Map<number, AiStyleOut>();
    arr.forEach((a, i) => {
      if (!a) return;
      map.set(i, {
        whatsMissing: Array.isArray(a.whatsMissing)
          ? a.whatsMissing.filter((s) => typeof s === "string" && s.trim()).map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200))
          : undefined,
        uniquenessInStyle: Array.isArray(a.uniquenessInStyle)
          ? a.uniquenessInStyle.filter((s) => typeof s === "string" && s.trim()).map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200))
          : undefined,
      });
    });
    return map;
  } catch {
    return null;
  }
}

export async function analyzeBestsellers(
  niches: Array<{ niche: string; evidence: string[] }>,
  opts: { competitors?: CompetitorInput[]; includeYouTube?: boolean; includeEtsy?: boolean; useAi?: boolean },
  deps?: { textGen?: TextGen; fetchFn?: FetchFn }
): Promise<BestsellersResult> {
  const warnings: string[] = [];
  const apiKey = process.env.YOUTUBE_API_KEY || undefined;
  const etsyKey = process.env.ETSY_API_KEY || undefined;
  const fetchFn = deps?.fetchFn ?? fetch;
  const top = niches.slice(0, 3);

  // Manual competitors folded into the matching niche (keyword overlap).
  const manualByNiche = new Map<string, CompetitorInput[]>();
  for (const c of opts.competitors ?? []) {
    const hay = `${c.title} ${c.note ?? ""}`.toLowerCase();
    const match = top.find((n) => hay.includes(n.niche.toLowerCase().split(" ")[0])) ?? null;
    const key = match ? match.niche : top[0]?.niche;
    if (!key) continue;
    manualByNiche.set(key, [...(manualByNiche.get(key) ?? []), c]);
  }

  // YouTube top videos per niche (skipped without a key — never fatal).
  const videosByNiche = new Map<string, TopVideo[]>();
  if (opts.includeYouTube !== false) {
    if (!apiKey) {
      warnings.push("youtube_skipped_no_key: YOUTUBE_API_KEY nahi hai — top videos ke bina analysis chal rahi hai (free key .env mein daalo, 10k units/day)");
    } else {
      for (const n of top) {
        videosByNiche.set(n.niche, await fetchTopVideos(`${n.niche} template`, apiKey, fetchFn));
      }
    }
  }

  // Etsy top listings per niche — the platform where templates actually
  // sell (favorites + reviews + shop total sales). No key → skip.
  const etsyByNiche = new Map<string, string[]>();
  if (opts.includeEtsy !== false) {
    for (const n of top) {
      const r = await searchEtsyListings(`${n.niche} template`, etsyKey, { fetchFn });
      warnings.push(...r.warnings);
      etsyByNiche.set(n.niche, r.listings.map(etsyEvidenceLine));
    }
  }

  const styleInputs = top.map((n) => {
    const videoTitles = (videosByNiche.get(n.niche) ?? []).map((v) => v.title);
    const manual = (manualByNiche.get(n.niche) ?? []).map((c) => `${c.title}${c.source ? ` (${c.source})` : ""}${c.note ? ` — ${c.note}` : ""}`);
    const etsyLines = etsyByNiche.get(n.niche) ?? [];
    const evidence = [...n.evidence, ...videoTitles, ...etsyLines, ...manual].filter(Boolean);
    const { formats, styles, audience } = extractStyle(evidence);
    const styleProfile = [
      formats.length ? `formats: ${formats.join(", ")}` : "",
      styles.length ? `styles: ${styles.join(", ")}` : "",
      audience.length ? `audience: ${audience.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" | ") || "style signals nahi mile — generic premium look";
    return { niche: n.niche, evidence, formats, styles, audience, styleProfile, videoTitles, etsyLines, manual };
  });

  // Whats-missing + uniqueness-in-style: one AI call, bank fallback.
  let ai: Map<number, AiStyleOut> | null = null;
  if (opts.useAi !== false) {
    ai = await aiStyleAngles(
      styleInputs.map((s) => ({ niche: s.niche, styleProfile: s.styleProfile, evidence: s.evidence })),
      deps?.textGen ?? defaultTextGen
    );
    if (!ai) warnings.push("ai_style_fallback: whats-missing/uniqueness bank se liye gaye hain (AI call nahi hui)");
  }

  const results = styleInputs.map((s, i) => {
    const aiOut = ai?.get(i);
    const whatsMissing = (aiOut?.whatsMissing ?? []).filter((x) => !complianceHit(x)).slice(0, 2);
    if (whatsMissing.length < 2) {
      for (const b of MISSING_BANK) {
        if (whatsMissing.length >= 2) break;
        if (!whatsMissing.includes(b)) whatsMissing.push(b);
      }
    }
    const uniquenessInStyle = (aiOut?.uniquenessInStyle ?? []).filter((x) => !complianceHit(x)).slice(0, 2);
    if (uniquenessInStyle.length < 2) {
      for (const b of UNIQUENESS_BANK) {
        if (uniquenessInStyle.length >= 2) break;
        if (!uniquenessInStyle.includes(b)) uniquenessInStyle.push(b);
      }
    }
    return {
      niche: s.niche,
      styleProfile: s.styleProfile,
      formats: s.formats,
      styles: s.styles,
      audience: s.audience,
      bestsellerEvidence: [...s.videoTitles.map((t) => `YT: ${t}`), ...s.etsyLines, ...s.manual],
      whatsMissing,
      uniquenessInStyle,
    };
  });

  return { niches: results, warnings };
}

// ---------------------------------------------------------------------------
// Lekin Line (Utkarsh Gose, "How To Find A Winning Digital Product") —
// consolidated 2026-11-20 from lekin-line.ts per the
// consolidate-don't-duplicate rule. Gap extraction from reviews
// belongs with bestseller gap analysis (whatsMissing).
// Names and signatures are unchanged. Pure functions, no I/O.
// ---------------------------------------------------------------------------

export interface LekinLine {
  /** The gap clause, in the customer's exact words (after the marker). */
  gap: string;
  /** The contrast marker that was found (lowercased). */
  marker: string;
  stars: number;
}

export interface LekinGap extends LekinLine {
  /** The original review text (trimmed, capped). */
  review: string;
}

export interface ReviewInput {
  text: string;
  stars: number;
}

/** Contrast markers, longest first so "although" wins over "though". */
const ROMAN_MARKERS = ["however", "although", "though", "but", "lekin", "magar", "phir bhi", "par"];
const DEVANAGARI_MARKERS = ["हालांकि", "लेकिन", "मगर", "फिर भी", "पर"];

const ALL_MARKERS = [...ROMAN_MARKERS, ...DEVANAGARI_MARKERS].sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A marker must sit on a word boundary (Unicode-aware, so Devanagari
 * works too). The leading group is one non-letter char or start-of-text.
 */
const MARKER_RE = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${ALL_MARKERS.map(escapeRegExp).join("|")})(?=[^\\p{L}\\p{N}]|$)`,
  "iu"
);

/** Gap clauses are kept short enough to use in copy; cut at a word boundary. */
const MAX_GAP_CHARS = 280;
const MAX_REVIEW_CHARS = 300;

function capAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

function normalizeStars(stars: number): number {
  const s = Math.round(Number(stars));
  return s >= 1 && s <= 5 ? s : 3;
}

/**
 * Extract the "but" gap clause from one review, or null when the review
 * has no contrast marker (or nothing after it, e.g. "good, though").
 * The returned gap keeps the customer's exact words — never paraphrased.
 */
export function extractLekinLine(text: string, stars: number): LekinLine | null {
  const clean = (text ?? "").trim();
  if (!clean) return null;
  const m = MARKER_RE.exec(clean);
  if (!m) return null;
  const marker = m[2];
  const after = clean.slice(m.index + m[1].length + marker.length);
  let clause = after.replace(/^[\s,;:—–-]+/, "").trim();
  if (!clause) return null;
  // Sentence-initial "although/though" + comma: "Although useful, it is
  // too detailed" — the gap is the main clause AFTER the comma, not the
  // subordinate clause before it.
  const lower = marker.toLowerCase();
  if ((lower === "although" || lower === "though") && m.index === 0) {
    const comma = clause.indexOf(",");
    if (comma >= 0) {
      const main = clause.slice(comma + 1).replace(/^[\s,;:—–-]+/, "").trim();
      if (main) clause = main;
    }
  }
  return { gap: capAtWordBoundary(clause, MAX_GAP_CHARS), marker: lower, stars: normalizeStars(stars) };
}

/** 3-star reviews are gold; 2/4-star next; 1/5-star last. */
function starPriority(stars: number): number {
  if (stars === 3) return 0;
  if (stars === 2 || stars === 4) return 1;
  return 2;
}

function normalizeGap(gap: string): string {
  return gap.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * Collect the top gaps from a list of reviews: extract, prefer 3-star,
 * dedup (same gap in different words counts once), return the top
 * `limit` (default 5 — the video's number).
 */
export function collectGaps(reviews: ReviewInput[], limit = 5): LekinGap[] {
  const wanted = Math.min(10, Math.max(1, Math.floor(limit) || 5));
  const seen = new Set<string>();
  const found: Array<LekinGap & { priority: number; order: number }> = [];
  reviews.forEach((r, order) => {
    const line = extractLekinLine(r.text, r.stars);
    if (!line) return;
    const key = normalizeGap(line.gap);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push({
      ...line,
      review: capAtWordBoundary((r.text ?? "").trim(), MAX_REVIEW_CHARS),
      priority: starPriority(normalizeStars(r.stars)),
      order,
    });
  });
  found.sort((a, b) => a.priority - b.priority || a.order - b.order);
  return found
    .slice(0, wanted)
    .map((g) => ({ gap: g.gap, marker: g.marker, stars: g.stars, review: g.review }));
}
