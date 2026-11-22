/**
 * Idea Briefs — Problem Miner ke top problems se sellable product briefs.
 *
 * Pipeline: miner latest.json (problems + rising queries) → niche ranking
 * (demand score + trend) → BESTSELLER STYLE ANALYSIS (top videos by
 * views + manual competitors → style profile + whats-missing) →
 * deterministic kind/theme mapping → catalog gap check
 * (storage/digital mein kya bana hua hai) → uniqueness angles IN THAT
 * STYLE (ek LLM call, bank fallback) → briefs queue (latest.json,
 * human pick).
 *
 * Professional/premium way: har brief mein demand evidence + trend +
 * gap + uniqueness hota hai — idea "acha laga" par nahi, data par banta
 * hai. Generation yahan se NAHI hoti: briefs sirf queue hain; user pick
 * kare to generation workflows (template/ebook/planner/spreadsheets)
 * chalte hain.
 *
 * Honest limits:
 *  - Trend direction miner se aati hai (pytrends; "unknown" ho sakta hai).
 *  - Gap check sirf APNI catalog (storage/digital) se hota hai — poori
 *    market (Etsy/Gumroad) ka supply data hamare paas nahi hai.
 *  - Uniqueness angles LLM se aate hain ya bank se; dono compliance-
 *    scanned hain (price/banned claim wala angle drop hota hai).
 */
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { defaultTextGen, type TextGen } from "./ebook";
import { analyzeBestsellers, type CompetitorInput } from "./bestsellers";
import { digitalRoot, slugify } from "./package";

// ---------------------------------------------------------------------------
// Winning-product validation (Utkarsh Gose, "How To Find A Winning Digital
// Product") — consolidated 2026-11-20 from three-signal.ts +
// four-d-filter.ts per the consolidate-don't-duplicate rule. Pure
// functions, no I/O. Names and signatures are unchanged.
// ---------------------------------------------------------------------------

// --- Three Signal Test ---
// Time / Versions / Crowd on the ads sellers already run (Meta Ad
// Library adapter: src/lib/discovery/meta-ad-library.ts).

export type SignalStatus = "pass" | "partial" | "fail";
export type ThreeSignalVerdict = "strong" | "moderate" | "weak" | "saturated";

export interface SignalResult {
  signal: "time" | "versions" | "crowd";
  status: SignalStatus;
  /** The raw input value behind this signal. */
  value: number;
  /** One line of evidence, in plain words. */
  evidence: string;
}

export interface ThreeSignalInput {
  /** Age in days of the OLDEST ad for this product (how long it has run). */
  adAgeDays: number;
  /** How many DIFFERENT ad creatives run for the same product. */
  versionCount: number;
  /** How many DIFFERENT unrelated pages sell the same kind of product. */
  sellerCount: number;
  /** Crowd at/above this = too late (saturated). Default 500 — the video's number. */
  saturationCap?: number;
}

export interface ThreeSignalResult {
  verdict: ThreeSignalVerdict;
  /** 0–6: pass = 2, partial = 1, fail = 0, summed over the three signals. */
  score: number;
  signals: SignalResult[];
  summary: string;
}

/** Ad running a month or more = likely working. */
export const TIME_PASS_DAYS = 30;
/** Ad running a week or more = running, but still early. */
export const TIME_PARTIAL_DAYS = 7;
/** This many different creatives = actively testing and improving. */
export const VERSIONS_PASS = 10;
/** A few creatives = some iteration. */
export const VERSIONS_PARTIAL = 3;
/** Fewer sellers than this = no demand signal (nobody else sells it). */
export const CROWD_MIN = 2;
/** Up to this many sellers = healthy demand. */
export const CROWD_HEALTHY_MAX = 20;
/** The video's saturation number: 500 sellers = too late. */
export const DEFAULT_SATURATION_CAP = 500;

function clampNonNegative(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function scoreTime(adAgeDays: number): SignalResult {
  const value = clampNonNegative(adAgeDays);
  if (value >= TIME_PASS_DAYS) {
    return { signal: "time", status: "pass", value, evidence: `ad running ${value} days — a month or more, likely working` };
  }
  if (value >= TIME_PARTIAL_DAYS) {
    return { signal: "time", status: "partial", value, evidence: `ad running ${value} days — running, but still early` };
  }
  return { signal: "time", status: "fail", value, evidence: `ad running ${value} days — too new to judge` };
}

function scoreVersions(versionCount: number): SignalResult {
  const value = clampNonNegative(versionCount);
  if (value >= VERSIONS_PASS) {
    return { signal: "versions", status: "pass", value, evidence: `${value} different ad creatives — seller is actively testing and improving` };
  }
  if (value >= VERSIONS_PARTIAL) {
    return { signal: "versions", status: "partial", value, evidence: `${value} different ad creatives — some iteration, not heavy testing` };
  }
  return { signal: "versions", status: "fail", value, evidence: `${value} ad creative(s) — no iteration signal` };
}

function scoreCrowd(sellerCount: number, saturationCap: number): SignalResult {
  const value = clampNonNegative(sellerCount);
  if (value >= saturationCap) {
    return { signal: "crowd", status: "fail", value, evidence: `${value} sellers — saturated, too late (cap ${saturationCap})` };
  }
  if (value >= CROWD_MIN && value <= CROWD_HEALTHY_MAX) {
    return { signal: "crowd", status: "pass", value, evidence: `${value} different sellers — real demand, not yet crowded` };
  }
  if (value > CROWD_HEALTHY_MAX) {
    return { signal: "crowd", status: "partial", value, evidence: `${value} sellers — demand, but crowded` };
  }
  return { signal: "crowd", status: "fail", value, evidence: `${value} seller(s) — no demand signal, nobody else sells it` };
}

/** Score one product idea on the Three Signal Test. */
export function scoreThreeSignals(input: ThreeSignalInput): ThreeSignalResult {
  const cap =
    typeof input.saturationCap === "number" && Number.isFinite(input.saturationCap) && input.saturationCap >= 2
      ? Math.floor(input.saturationCap)
      : DEFAULT_SATURATION_CAP;
  const signals = [scoreTime(input.adAgeDays), scoreVersions(input.versionCount), scoreCrowd(input.sellerCount, cap)];
  const points: Record<SignalStatus, number> = { pass: 2, partial: 1, fail: 0 };
  const score = signals.reduce((a, s) => a + points[s.status], 0);
  const saturated = clampNonNegative(input.sellerCount) >= cap;
  const verdict: ThreeSignalVerdict = saturated ? "saturated" : score === 6 ? "strong" : score >= 4 ? "moderate" : "weak";
  const summary = saturated
    ? `saturated — ${clampNonNegative(input.sellerCount)} sellers, too late`
    : verdict === "strong"
      ? "strong — all three signals pass"
      : verdict === "moderate"
        ? `moderate — ${score}/6, check the weak signal before investing`
        : `weak — ${score}/6, demand signal is thin`;
  return { verdict, score, signals, summary };
}

/**
 * Build a Three Signal input from a Meta Ad Library summary
 * (src/lib/discovery/meta-ad-library.ts `summarizeAds()`).
 * Returns null when there are no ads to score (no oldest ad).
 */
export function adSummaryToInput(summary: {
  oldestAdAgeDays: number | null;
  versionCount: number;
  sellerCount: number;
}): ThreeSignalInput | null {
  if (summary.oldestAdAgeDays === null) return null;
  return {
    adAgeDays: summary.oldestAdAgeDays,
    versionCount: summary.versionCount,
    sellerCount: summary.sellerCount,
  };
}

/**
 * Format a Proof List: up to 10 ideas with their signal evidence.
 * The video's rule — 10 ideas, each backed by market evidence, not guesses.
 */
export function formatProofList(items: Array<{ idea: string; result: ThreeSignalResult }>): string {
  const top = items.slice(0, 10);
  const lines: string[] = ["PROOF LIST — ideas with market evidence (Three Signal Test)", ""];
  top.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.idea} — ${item.result.verdict.toUpperCase()} (${item.result.score}/6)`);
    for (const s of item.result.signals) {
      lines.push(`   ${s.signal}: ${s.status} — ${s.evidence}`);
    }
  });
  return lines.join("\n");
}

// --- 4D Filter ---
// Dard / Demo / Daam / Delivery gate: 4/4 proceed, 3/4 fix weak,
// <=2/4 reconsider.

export type FourDKey = "dard" | "demo" | "daam" | "delivery";
export type FourDVerdict = "proceed" | "fix_weak" | "reconsider";

export interface FourDScore {
  /** 0–1: 0 = no, 1 = yes (graded values allowed). */
  score: number;
  /** One short line: why this score. */
  reason: string;
}

export interface FourDInput {
  dard: FourDScore;
  demo: FourDScore;
  daam: FourDScore;
  delivery: FourDScore;
  /** Score at/above this counts as a "yes". Default 0.5. */
  passThreshold?: number;
}

export interface FourDResult {
  verdict: FourDVerdict;
  /** How many of the four Ds passed (0–4). */
  passes: number;
  /** The lowest-scoring D (first in Dard → Demo → Daam → Delivery order on ties). */
  weakest: FourDKey;
  weakestScore: number;
  perD: Array<{ key: FourDKey; label: string; score: number; pass: boolean; reason: string }>;
  /** What to do next, aimed at the weakest D. */
  guidance: string;
}

export const FOUR_D_LABELS: Record<FourDKey, string> = {
  dard: "Dard (Pain — is it hurting right now?)",
  demo: "Demo (can the result be shown in 5 seconds?)",
  daam: "Daam (does the full price math work?)",
  delivery: "Delivery (can you build it in one week?)",
};

const FOUR_D_GUIDANCE: Record<FourDKey, string> = {
  dard: "Dard is weakest — go back to Shikayat Mining: is this problem bothering the customer RIGHT NOW, or is it a 'someday' problem? If it is not urgent, change the angle or drop the idea.",
  demo: "Demo is weakest — can the result be shown in 5 seconds? If not, change the format (Angle Shift: a checklist or ready-made template shows the result faster than a long ebook) or pick a product whose result is visible.",
  daam: "Daam is weakest — redo the FULL math: ad cost + ad GST + gateway fees + refunds. If the margin is thin, add a useful second product (bundle/upsell) to improve total earnings per customer instead of competing on price.",
  delivery: "Delivery is weakest — can you build this in ONE WEEK with your current skills, good enough for real benefit? Shrink the scope; the first version must be useful, not perfect.",
};

const FOUR_D_ORDER: FourDKey[] = ["dard", "demo", "daam", "delivery"];

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Run the 4D Filter on four scored Ds. */
export function runFourDFilter(input: FourDInput): FourDResult {
  const threshold =
    typeof input.passThreshold === "number" && Number.isFinite(input.passThreshold)
      ? Math.min(1, Math.max(0, input.passThreshold))
      : 0.5;
  const perD = FOUR_D_ORDER.map((key) => {
    const score = clampScore(input[key].score);
    return {
      key,
      label: FOUR_D_LABELS[key],
      score,
      pass: score >= threshold,
      reason: (input[key].reason ?? "").trim().slice(0, 200),
    };
  });
  const passes = perD.filter((d) => d.pass).length;
  const weakest = perD.reduce((a, b) => (b.score < a.score ? b : a), perD[0]);
  const verdict: FourDVerdict = passes === 4 ? "proceed" : passes === 3 ? "fix_weak" : "reconsider";
  const guidance =
    verdict === "proceed"
      ? "All four Ds pass — proceed with this idea."
      : verdict === "fix_weak"
        ? FOUR_D_GUIDANCE[weakest.key]
        : `Only ${passes}/4 pass — reconsider before investing. Weakest is ${FOUR_D_LABELS[weakest.key]}. ${FOUR_D_GUIDANCE[weakest.key]}`;
  return { verdict, passes, weakest: weakest.key, weakestScore: weakest.score, perD, guidance };
}

export type BriefProductType = "template" | "ebook" | "planner" | "spreadsheet";
export type BriefTrend = "rising" | "stable" | "falling" | "unknown";

export interface Brief {
  id: string;
  productType: BriefProductType;
  niche: string;
  title: string;
  kinds?: string[];
  theme?: string;
  formats?: string[];
  audience: string;
  angle: string;
  demandEvidence: string[];
  demandScore: number;
  trend: BriefTrend;
  gap: string;
  /** Market gap: bestsellers mein kya kami hai (bestseller analysis se). */
  marketGap?: string;
  /** Bestseller style: formats + styles + audience (signals se). */
  styleProfile?: string;
  /** Top bestseller evidence: YT video titles / manual competitor entries. */
  bestsellerEvidence?: string[];
  uniqueness: string[];
  ebookOutline?: string[];
  /** Three Signal Test result (Utkarsh Gose validation) — attached after scoring, never auto-generated. */
  threeSignal?: ThreeSignalResult;
  /** 4D Filter result — attached after scoring. */
  fourD?: FourDResult;
  status: "queued";
}

export interface BriefsAnalysis {
  topKinds: Array<{ kind: string; demand: number; trend: BriefTrend }>;
  topNiches: Array<{ niche: string; demand: number; trend: BriefTrend }>;
  gaps: string[];
  risingQueries: string[];
}

export interface BriefsResult {
  briefs: Brief[];
  analysis: BriefsAnalysis;
  minedAt: string | null;
  warnings: string[];
}

export interface BriefsRequest {
  productTypes?: BriefProductType[];
  maxBriefs?: number;
  useAi?: boolean;
  /** Manual competitors (user ki apni browsing se): bestseller titles/notes. */
  competitors?: CompetitorInput[];
  /** YouTube top-videos step (needs YOUTUBE_API_KEY; na ho to skip + warning). */
  includeYouTube?: boolean;
  /** Etsy top-listings step (needs ETSY_API_KEY; na ho to skip + warning). */
  includeEtsy?: boolean;
}

/**
 * Attach validation scores to a brief (pure — returns a new brief, no
 * I/O). The brief generation flow does NOT score anything itself:
 * scores come from the Three Signal Test (Meta Ad Library data) and
 * the 4D Filter, run separately and attached here for the human pick.
 */
export function attachValidation(
  brief: Brief,
  scores: { threeSignal?: ThreeSignalResult; fourD?: FourDResult }
): Brief {
  return {
    ...brief,
    ...(scores.threeSignal ? { threeSignal: scores.threeSignal } : {}),
    ...(scores.fourD ? { fourD: scores.fourD } : {}),
  };
}

interface MinerProblem {
  text?: string;
  problem?: string;
  score?: number | null;
  niche?: string;
  source?: string;
  trend?: BriefTrend;
}

interface MinerLatest {
  minedAt?: string | null;
  scannedAt?: string | null;
  problems?: MinerProblem[];
  risingQueries?: Record<string, string[]>;
}

/** Deterministic niche → kind/theme/product mapping (evidence-based defaults). */
const NICHE_MAP: Array<{ match: RegExp; kinds: string[]; theme: string; productTypes: BriefProductType[] }> = [
  { match: /budget|money|finance|expense|saving|paisa/i, kinds: ["chart", "table"], theme: "forest", productTypes: ["template", "spreadsheet"] },
  { match: /wedding|invit|event|birthday|eid|ramadan/i, kinds: ["event"], theme: "wine", productTypes: ["template"] },
  { match: /study|exam|student|learn|padhai/i, kinds: ["tips", "checklist"], theme: "dark", productTypes: ["template", "ebook"] },
  { match: /fitness|health|workout|diet|meal|food/i, kinds: ["checklist", "tips"], theme: "forest", productTypes: ["template", "planner"] },
  { match: /business|sales|freelanc|client|shop/i, kinds: ["promo", "sale"], theme: "dark", productTypes: ["template", "ebook"] },
  { match: /social|instagram|content|creator|reel/i, kinds: ["quote", "promo"], theme: "dark", productTypes: ["template"] },
  { match: /resume|cv|job|career|interview/i, kinds: ["announcement", "tips"], theme: "sand", productTypes: ["template", "ebook"] },
  { match: /planner|plan|organ|routine|habit/i, kinds: ["checklist", "table"], theme: "sand", productTypes: ["planner", "template"] },
];

const DEFAULT_MAP = { kinds: ["quote", "tips"], theme: "dark", productTypes: ["template", "ebook"] as BriefProductType[] };

/** Uniqueness angle bank (fallback when the LLM call fails). */
const UNIQUENESS_BANK: Record<string, string[]> = {
  chart: ["Hinglish labels — English charts ki bheed mein alag", "Print + XLSX bundle — ek pack mein dono format"],
  table: ["Hinglish rows — local audience ke liye", "Printable + XLSX bundle — paper aur screen dono"],
  event: ["Hinglish + Roman text — desi events ke liye tayyar", "Photo background option — plain cards se alag"],
  tips: ["Hinglish tips — English packs se alag", "Numbered style — padhne mein aasan"],
  checklist: ["Printable checklist — fridge/locker par lagane layak", "Hinglish copy — local audience"],
  promo: ["No fake urgency — imaandaar copy", "Photo background option"],
  sale: ["No fake discount — imaandaar offer copy", "Festival-specific version"],
  quote: ["Hinglish quotes — desi audience", "Dark premium look"],
  default: ["Hinglish copy — English packs se alag", "Photo background option — plain text packs se alag", "Printable + digital bundle"],
};

const EBOOK_OUTLINE_BANK = (niche: string): string[] => [
  `${niche} — shuruaat kahan se karein`,
  `${niche} ki buniyaadi baatein`,
  `${niche} step-by-step`,
  `${niche} mein aam galtiyan`,
  `${niche} action plan`,
];

function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function complianceHit(text: string): string | null {
  const price = text.match(PRICE_PATTERN);
  if (price) return `price/offer pattern: "${price[0]}"`;
  const banned = text.match(BANNED_CLAIM_PATTERN);
  if (banned) return `banned claim pattern: "${banned[0]}"`;
  return null;
}

function mapNiche(niche: string): { kinds: string[]; theme: string; productTypes: BriefProductType[] } {
  for (const m of NICHE_MAP) {
    if (m.match.test(niche)) return { kinds: m.kinds, theme: m.theme, productTypes: m.productTypes };
  }
  return DEFAULT_MAP;
}

async function readMinerLatest(): Promise<MinerLatest | null> {
  try {
    const raw = await readFile(join(process.cwd(), "storage", "problem-miner", "latest.json"), "utf-8");
    return JSON.parse(raw) as MinerLatest;
  } catch {
    return null;
  }
}

async function readCatalog(): Promise<string[]> {
  try {
    return await readdir(digitalRoot());
  } catch {
    return [];
  }
}

function gapFor(niche: string, catalog: string[]): string {
  const words = niche.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const matches = catalog.filter((dir) => words.some((w) => dir.toLowerCase().includes(w)));
  if (matches.length === 0) return "Is niche par abhi koi pack nahi bana — pehla mover advantage.";
  return `${matches.length} pack(s) is niche par bane hue hain — naya angle (uniqueness) chahiye.`;
}

interface AiBriefAngles {
  uniqueness: string[];
  outline?: string[];
}

/** One LLM call for ALL briefs: 2 uniqueness angles each (+ ebook outline). */
async function aiAngles(
  briefs: Array<{ niche: string; productType: BriefProductType; kinds?: string[]; theme?: string; styleProfile?: string; marketGap?: string }>,
  textGen: TextGen
): Promise<Map<number, AiBriefAngles> | null> {
  const items = briefs
    .map(
      (b, i) =>
        `${i + 1}. niche="${b.niche}", product=${b.productType}${b.kinds ? `, kinds=${b.kinds.join("/")}` : ""}${b.theme ? `, theme=${b.theme}` : ""}${b.styleProfile ? `, bestseller style="${b.styleProfile}"` : ""}${b.marketGap ? `, market gap="${b.marketGap}"` : ""}`
    )
    .join("\n");
  const prompt = [
    "For each product idea below, write 2 short uniqueness angles in Roman-script Hinglish.",
    "Angles must be IN THE SAME STYLE as the bestsellers (same look/feel) with our twist filling the market gap — not generic.",
    "For ebook ideas also write a 5-chapter outline (short chapter titles).",
    "Reply with ONLY a JSON array, one object per idea in the same order.",
    'Each object: {"uniqueness": ["angle 1 (max 14 words)", "angle 2"], "outline": ["chapter 1", "chapter 2", "chapter 3", "chapter 4", "chapter 5"]} — omit "outline" for non-ebook ideas.',
    "No prices, no discounts, no income or result promises, no fake claims.",
    items,
  ].join("\n");
  try {
    const raw = await textGen(prompt, 1600);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(raw.slice(start, end + 1)) as AiBriefAngles[];
    if (!Array.isArray(arr) || arr.length !== briefs.length) return null;
    const map = new Map<number, AiBriefAngles>();
    arr.forEach((a, i) => {
      if (!a || !Array.isArray(a.uniqueness)) return;
      map.set(i, {
        uniqueness: a.uniqueness.filter((u) => typeof u === "string" && u.trim()).map((u) => cleanText(u, 200)).slice(0, 2),
        outline: Array.isArray(a.outline)
          ? a.outline.filter((o) => typeof o === "string" && o.trim()).map((o) => cleanText(o, 120)).slice(0, 5)
          : undefined,
      });
    });
    return map;
  } catch {
    return null;
  }
}

export async function generateBriefs(
  req: BriefsRequest,
  deps?: { textGen?: TextGen; fetchFn?: typeof fetch }
): Promise<BriefsResult> {
  const productTypes = (req.productTypes ?? ["template", "ebook"]).filter((t) =>
    ["template", "ebook", "planner", "spreadsheet"].includes(t)
  ) as BriefProductType[];
  const maxBriefs = Math.min(10, Math.max(1, Math.floor(req.maxBriefs ?? 6)));
  const warnings: string[] = [];

  const latest = await readMinerLatest();
  const minedAt = latest?.minedAt ?? latest?.scannedAt ?? null;
  const problems = (latest?.problems ?? []).filter((p) => String(p.text ?? p.problem ?? "").trim());
  if (!problems.length) {
    return {
      briefs: [],
      analysis: { topKinds: [], topNiches: [], gaps: [], risingQueries: [] },
      minedAt,
      warnings: ["not_mined_yet: Problem Miner abhi tak nahi chala — pehle Monday 07:00 IST run ya manual mine karo."],
    };
  }

  // Rank niches by total demand score.
  const byNiche = new Map<string, { score: number; trend: BriefTrend; evidence: string[]; topScore: number }>();
  for (const p of problems) {
    const niche = cleanText(String(p.niche ?? "general"), 80) || "general";
    const score = typeof p.score === "number" ? p.score : 10;
    const trend = (p.trend ?? "unknown") as BriefTrend;
    const cur = byNiche.get(niche) ?? { score: 0, trend, evidence: [], topScore: 0 };
    cur.score += score;
    cur.topScore = Math.max(cur.topScore, score);
    if (cur.evidence.length < 3) cur.evidence.push(cleanText(String(p.text ?? p.problem ?? ""), 200));
    if (trend === "rising") cur.trend = "rising";
    else if (cur.trend !== "rising" && trend === "stable") cur.trend = "stable";
    byNiche.set(niche, cur);
  }
  const rankedNiches = [...byNiche.entries()]
    .map(([niche, v]) => ({ niche, ...v }))
    .sort((a, b) => b.score - a.score);

  const catalog = await readCatalog();

  // Bestseller style analysis (top 3 niches): bestseller ka style kya
  // hai, usme kya kami hai, usi style mein hamara twist kya ho.
  const textGen = deps?.textGen ?? defaultTextGen;
  const best = await analyzeBestsellers(
    rankedNiches.slice(0, 3).map((n) => ({ niche: n.niche, evidence: n.evidence })),
    { competitors: req.competitors, includeYouTube: req.includeYouTube, includeEtsy: req.includeEtsy, useAi: req.useAi },
    { textGen, fetchFn: deps?.fetchFn }
  );
  warnings.push(...best.warnings);
  const bestByNiche = new Map(best.niches.map((b) => [b.niche, b]));

  // Build (niche, productType) pairs in demand order until maxBriefs.
  const pairs: Array<{ niche: string; productType: BriefProductType; score: number; trend: BriefTrend; evidence: string[] }> = [];
  for (const n of rankedNiches) {
    const map = mapNiche(n.niche);
    for (const pt of map.productTypes) {
      if (!productTypes.includes(pt)) continue;
      pairs.push({ niche: n.niche, productType: pt, score: n.topScore, trend: n.trend, evidence: n.evidence });
      if (pairs.length >= maxBriefs) break;
    }
    if (pairs.length >= maxBriefs) break;
  }

  // Uniqueness angles: one AI call, bank fallback. Bestseller style +
  // market gap prompt mein jate hain — angles usi style mein twist hote hain.
  let ai: Map<number, AiBriefAngles> | null = null;
  if (req.useAi !== false) {
    ai = await aiAngles(
      pairs.map((p) => {
        const map = mapNiche(p.niche);
        const b = bestByNiche.get(p.niche);
        return {
          niche: p.niche,
          productType: p.productType,
          kinds: p.productType === "template" ? map.kinds : undefined,
          theme: p.productType === "template" ? map.theme : undefined,
          styleProfile: b?.styleProfile,
          marketGap: b?.whatsMissing.join("; "),
        };
      }),
      textGen
    );
    if (!ai) warnings.push("ai_angles_fallback: uniqueness angles bank se liye gaye hain (AI call nahi hui)");
  }

  const briefs: Brief[] = pairs.map((p, i) => {
    const map = mapNiche(p.niche);
    const title =
      p.productType === "template"
        ? `${p.niche} Template Pack`
        : p.productType === "ebook"
          ? `${p.niche} Guide`
          : p.productType === "planner"
            ? `${p.niche} Planner`
            : `${p.niche} Tracker`;
    const bankAngles = [...(UNIQUENESS_BANK[map.kinds[0]] ?? []), ...UNIQUENESS_BANK.default].slice(0, 2);
    const bestFor = bestByNiche.get(p.niche);
    // Uniqueness: brief-level AI angles first (full context: kind/theme/
    // style/gap), bestseller angles top-up, then bank.
    let uniqueness = [...(ai?.get(i)?.uniqueness ?? []), ...(bestFor?.uniquenessInStyle ?? [])];
    if (!uniqueness.length) uniqueness = bankAngles;
    uniqueness = uniqueness.filter((u) => !complianceHit(u)).slice(0, 2);
    if (uniqueness.length < 2) {
      for (const b of bankAngles) {
        if (uniqueness.length >= 2) break;
        if (!uniqueness.includes(b)) uniqueness.push(b);
      }
    }
    if (!uniqueness.length) uniqueness = UNIQUENESS_BANK.default.slice(0, 2);
    const brief: Brief = {
      id: slugify(`${p.productType}-${p.niche}`),
      productType: p.productType,
      niche: p.niche,
      title: cleanText(title, 200),
      audience: p.niche,
      angle: p.evidence[0] ?? p.niche,
      demandEvidence: p.evidence,
      demandScore: p.score,
      trend: p.trend,
      gap: gapFor(p.niche, catalog),
      marketGap: bestFor?.whatsMissing.join("; "),
      styleProfile: bestFor?.styleProfile,
      bestsellerEvidence: bestFor?.bestsellerEvidence.length ? bestFor.bestsellerEvidence : undefined,
      uniqueness,
      status: "queued",
    };
    if (p.productType === "template") {
      brief.kinds = map.kinds;
      brief.theme = map.theme;
      brief.formats = ["svg", "png"];
    } else if (p.productType === "ebook") {
      brief.formats = ["pdf", "docx", "epub"];
      const outline = ai?.get(i)?.outline?.filter((o) => !complianceHit(o));
      brief.ebookOutline = outline && outline.length >= 3 ? outline : EBOOK_OUTLINE_BANK(p.niche);
    } else if (p.productType === "planner") {
      brief.formats = ["pdf"];
    } else {
      brief.formats = ["xlsx"];
    }
    return brief;
  });

  // Analysis summary: which kinds/niches people like + gaps + rising queries.
  const kindDemand = new Map<string, { demand: number; trend: BriefTrend }>();
  for (const b of briefs) {
    for (const k of b.kinds ?? []) {
      const cur = kindDemand.get(k) ?? { demand: 0, trend: b.trend };
      cur.demand += b.demandScore;
      if (b.trend === "rising") cur.trend = "rising";
      kindDemand.set(k, cur);
    }
  }
  const risingQueries = [...new Set(Object.values(latest?.risingQueries ?? {}).flat())].slice(0, 10);
  const analysis: BriefsAnalysis = {
    topKinds: [...kindDemand.entries()]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => b.demand - a.demand),
    topNiches: rankedNiches.slice(0, 5).map((n) => ({ niche: n.niche, demand: n.score, trend: n.trend })),
    gaps: [...new Set(briefs.map((b) => b.gap))],
    risingQueries,
  };

  // Queue: latest briefs for human pick (generation is NOT auto-started).
  const dir = join(digitalRoot(), "briefs");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "latest.json"),
    JSON.stringify({ briefs, analysis, generatedAt: new Date().toISOString(), minedAt }, null, 2),
    "utf-8"
  );

  return { briefs, analysis, minedAt, warnings };
}

/** Read the briefs queue (latest run) — for human pick, never auto-generated. */
export async function readLatestBriefs(): Promise<{ briefs: Brief[]; generatedAt: string | null; minedAt: string | null }> {
  try {
    const raw = await readFile(join(digitalRoot(), "briefs", "latest.json"), "utf-8");
    const parsed = JSON.parse(raw) as { briefs?: Brief[]; generatedAt?: string; minedAt?: string };
    return {
      briefs: Array.isArray(parsed.briefs) ? parsed.briefs : [],
      generatedAt: parsed.generatedAt ?? null,
      minedAt: parsed.minedAt ?? null,
    };
  } catch {
    return { briefs: [], generatedAt: null, minedAt: null };
  }
}
