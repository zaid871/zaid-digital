/**
 * Problem Miner v1 — free-automatable problem discovery.
 *
 * Sources (all keyless, no login, no scraping of login-walled pages):
 *  - Reddit public JSON API (scanReddit)
 *  - Google Suggest API + Amazon Suggest API (expandSuggest)
 *  - YouTube Suggest API (scanYouTubeSuggest) — video-search demand;
 *    same keyless suggest service, client=youtube
 *  - Google Trends via pytrends bridge (trendDirection; degrades to "unknown")
 *    + rising related queries (risingQueries; degrades to {})
 *  - Razorpay "Fix My Itch" (scanFixMyItch) — 10,000+ verified Indian
 *    problems with Itch Scores; live fetch + verified seed fallback
 *
 * Explicitly NOT built: Amazon/Udemy/Quora/FB/Discord/LinkedIn scrapers
 * (bot walls, ToS/ban risk), AnswerThePublic (no free API), TikTok comments
 * (no free API → manual). See docs/problem-miner-analysis.md.
 *
 * Scoring is deterministic (no AI quota spent). Output: top-10 ProblemCards
 * per run → review → pre-sell gate feed.
 *
 * Pure fetch-based; safe to import from App Routes (no provider imports).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export type ProblemSource = "reddit" | "google-suggest" | "amazon-suggest" | "youtube-suggest" | "fix-my-itch" | "fix-my-itch-seed";
export type TrendDirection = "rising" | "stable" | "falling" | "unknown";
export type DigitalFit = "ebook" | "template" | "both" | "none";

export interface ProblemCard {
  problem: string;
  niche: string;
  source: ProblemSource;
  evidence: string[];
  score: number;
  signals: string[];
  trend: TrendDirection;
  /** Itch Score from Fix My Itch (0-100); only for that source. */
  itchScore?: number;
  /** Deterministic digital-product fit (ebook/template/both/none). */
  digitalFit?: DigitalFit;
}

export interface MineOptions {
  niches: string[];
  /** Subreddits per niche; defaults to a small generic map + niche name. */
  subreddits?: string[];
  maxPerNiche?: number;
  /** Include the Fix My Itch source (default true). */
  includeFixMyItch?: boolean;
}

type FetchFn = typeof fetch;

const UA = "Mozilla/5.0 (X11; Linux x86_64) problem-miner/1.0 (free research tool)";

/** Pain patterns from the problem-research guides (gold: "How do I...",
 *  "I'm struggling...", "Is anyone else sick of...", "wish there was"). */
const PAIN_PATTERNS: Array<[RegExp, string]> = [
  [/\bhow do i\b/i, "how-do-i"],
  [/\bhow to\b/i, "how-to"],
  [/\bstruggl\w*\b/i, "struggling"],
  [/\bfrustrat\w*\b/i, "frustrated"],
  [/\bwish there w(as|ere)\b/i, "wish-there-was"],
  [/\bis anyone else\b/i, "anyone-else"],
  [/\bsick of\b/i, "sick-of"],
  [/\btired of\b/i, "tired-of"],
  [/\bcan'?t find\b/i, "cant-find"],
  [/\banyone know\b/i, "anyone-know"],
  [/\bhelp (me|with)\b/i, "help-plea"],
  [/\bproblem\b/i, "problem-word"],
  [/\bannoying\b/i, "annoying"],
  [/\btoo (hard|difficult|expensive|complicated)\b/i, "too-hard"],
];

function painSignals(text: string): string[] {
  const out: string[] = [];
  for (const [re, name] of PAIN_PATTERNS) if (re.test(text)) out.push(name);
  if (text.includes("?")) out.push("question");
  return out;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

interface RawHit {
  text: string;
  niche: string;
  source: ProblemSource;
  evidence: string;
  engagement: number; // reddit score or 0
  comments: number;   // reddit comments or 0
  createdUtc?: number;
  /** Fix My Itch score (0-100); drives the itch bonus in scoreProblems. */
  itchScore?: number;
}

async function getJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Scan Reddit: search top monthly posts per niche across subreddits.
 * Public JSON API, no key. Throws per-subreddit errors are collected, never fatal.
 */
export async function scanReddit(
  niche: string,
  subreddits: string[],
  fetchFn: FetchFn = fetch
): Promise<RawHit[]> {
  const hits: RawHit[] = [];
  const q = encodeURIComponent(niche);
  for (const sub of subreddits.slice(0, 5)) {
    try {
      const url =
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json` +
        `?q=${q}&restrict_sr=1&sort=top&t=month&limit=20`;
      const data = (await getJson(fetchFn, url)) as {
        data?: { children?: Array<{ data?: Record<string, unknown> }> };
      };
      for (const child of data?.data?.children ?? []) {
        const d = child.data ?? {};
        const title = String(d.title ?? "");
        const body = String(d.selftext ?? "");
        const text = `${title} ${body}`.trim();
        if (!text || painSignals(text).length === 0) continue;
        hits.push({
          text: title || text.slice(0, 140),
          niche,
          source: "reddit",
          evidence: `https://www.reddit.com${String(d.permalink ?? "")}`,
          engagement: Number(d.score ?? 0),
          comments: Number(d.num_comments ?? 0),
          createdUtc: Number(d.created_utc ?? 0),
        });
      }
    } catch {
      // per-subreddit failure → skip, keep going
    }
  }
  return hits;
}

const SUGGEST_SEEDS = (niche: string) => [
  `how to ${niche}`,
  `${niche} problem`,
  `best ${niche} for`,
  `${niche} vs`,
  `${niche} not working`,
];

/**
 * Expand via Google Suggest + Amazon Suggest (both keyless). Keeps only
 * suggestions carrying pain signals — real typed queries = real demand.
 */
export async function expandSuggest(
  niche: string,
  fetchFn: FetchFn = fetch
): Promise<RawHit[]> {
  const hits: RawHit[] = [];
  for (const seed of SUGGEST_SEEDS(niche)) {
    // Google
    try {
      const g = (await getJson(
        fetchFn,
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}`
      )) as unknown[];
      const suggestions = Array.isArray(g?.[1]) ? (g[1] as string[]) : [];
      for (const s of suggestions) {
        if (painSignals(s).length === 0) continue;
        hits.push({ text: s, niche, source: "google-suggest", evidence: `google suggest: "${seed}"`, engagement: 0, comments: 0 });
      }
    } catch { /* skip */ }
    // Amazon (POD long-tail phrases)
    try {
      const a = (await getJson(
        fetchFn,
        `https://completion.amazon.com/search/complete?search-alias=aps&client=amazon-search-ui&mkt=1&q=${encodeURIComponent(seed)}`
      )) as { suggestions?: Array<{ value?: string }> } | string[];
      const list = Array.isArray(a)
        ? ((a as unknown[])[1] as string[] | undefined) ?? []
        : (a.suggestions ?? []).map((s) => s.value ?? "");
      for (const s of list) {
        if (!s || painSignals(s).length === 0) continue;
        hits.push({ text: s, niche, source: "amazon-suggest", evidence: `amazon suggest: "${seed}"`, engagement: 0, comments: 0 });
      }
    } catch { /* skip */ }
  }
  return hits;
}

/**
 * YouTube Suggest (same keyless suggest service, dataset=yt).
 * Video-search demand — what people want explained/shown, not just read.
 * NOTE: client=youtube returns JSONP (window.google.ac.h(...)) which
 * res.json() cannot parse — client=chrome&ds=yt returns the same
 * YouTube dataset as plain JSON (live-verified 2026-11-08).
 * Same pain-signal filter as expandSuggest; failures never throw.
 */
export async function scanYouTubeSuggest(
  niche: string,
  fetchFn: FetchFn = fetch
): Promise<RawHit[]> {
  const hits: RawHit[] = [];
  for (const seed of SUGGEST_SEEDS(niche)) {
    try {
      const g = (await getJson(
        fetchFn,
        `https://suggestqueries.google.com/complete/search?client=chrome&ds=yt&q=${encodeURIComponent(seed)}`
      )) as unknown[];
      const suggestions = Array.isArray(g?.[1]) ? (g[1] as string[]) : [];
      for (const s of suggestions) {
        if (painSignals(s).length === 0) continue;
        hits.push({ text: s, niche, source: "youtube-suggest", evidence: `youtube suggest: "${seed}"`, engagement: 0, comments: 0 });
      }
    } catch { /* skip */ }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Fix My Itch (Razorpay) — 10,000+ verified Indian problems with Itch Scores.
// Page is Framer-rendered HTML; problem sentences + score + category appear
// in the server-rendered text, so a plain fetch + text parse works.
// Live fetch fails / parses 0 → verified SEED fallback (labeled
// "fix-my-itch-seed" so latest.json always shows live vs seed honestly).
// ---------------------------------------------------------------------------

export const FIX_MY_ITCH_URL = "https://razorpay.com/m/fix-my-itch/";

const FIX_MY_ITCH_CATEGORIES = [
  "B2B Services", "Beauty & Personal Care", "Consumer Services", "E-commerce",
  "EdTech", "FinTech", "Food & Beverage", "Home Services", "Logistics",
  "Payment Issues", "Real Estate", "SaaS", "Transportation", "Travel",
  "Healthtech", "Automotive", "Housing", "Healthcare", "Career", "Hardware",
  "Other",
];

/** Verified from the live page 2026-11-05 (top-10 have no score on page). */
export const FIX_MY_ITCH_SEED: Array<{ problem: string; category: string; itchScore: number | null }> = [
  { problem: "Why can't first time used car buyers verify car histories, conditions and future maintenance costs?", category: "Automotive", itchScore: null },
  { problem: "Why can't renters access verified mold, pests or hazards before signing leases?", category: "Housing", itchScore: null },
  { problem: "Why is caring for aging parents for sole earners across cities still fragmented & stressful?", category: "Healthcare", itchScore: null },
  { problem: "Why do teachers lack real time mental health support at work?", category: "Healthcare", itchScore: null },
  { problem: "Why do STEM students face education loan anxiety from unclear costs in 2026?", category: "Career", itchScore: null },
  { problem: "Why can't consumers see verified kitchen safety standards on food delivery apps?", category: "Consumer Services", itchScore: null },
  { problem: "Why is connecting specialized hardware to laptops still unreliable and frustrating?", category: "Hardware", itchScore: null },
  { problem: "Why is distinguishing sprains from fractures impossible without costly hospital visits?", category: "Healthcare", itchScore: null },
  { problem: "Why do people leaving formal education lack structure, mentorship and clear career guidance?", category: "Career", itchScore: null },
  { problem: "Why can't anxious people find trustworthy non-prescription sleep solutions easily?", category: "Healthcare", itchScore: null },
  { problem: "Why can't SMEs negotiate favorable payment terms with large buyers?", category: "B2B Services", itchScore: 82.8 },
  { problem: "Why can't manufacturers rely on guaranteed, accountable pickup logistics for outbound deliveries?", category: "B2B Services", itchScore: 79 },
  { problem: "Why do factory owners wait days for industrial repair technicians?", category: "B2B Services", itchScore: 78.5 },
  { problem: "Why do freelancers ghost projects after partial payments without accountability systems?", category: "B2B Services", itchScore: 76 },
  { problem: "Why can't businesses verify new suppliers before purchasing?", category: "B2B Services", itchScore: 76 },
  { problem: "Why do businesses struggle finding reliable contract manufacturers for small batches?", category: "B2B Services", itchScore: 75.2 },
  { problem: "Why can't small restaurants access wholesale ingredient pricing without large minimum orders?", category: "B2B Services", itchScore: 71.5 },
  { problem: "Why do micro-SMEs waste 10+ hours weekly on invoice management?", category: "B2B Services", itchScore: 67.5 },
  { problem: "Why can't shops see real-time supplier stock levels?", category: "B2B Services", itchScore: 67.5 },
  { problem: "Why are small retailers forced into distributor margins without direct brand access?", category: "B2B Services", itchScore: 68.5 },
];

/** Parse problem sentences + nearby score/category from page text. Exported for tests. */
export function parseFixMyItchHtml(html: string): Array<{ problem: string; category: string | null; itchScore: number | null }> {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  const out: Array<{ problem: string; category: string | null; itchScore: number | null }> = [];
  const seen = new Set<string>();
  const re = /\b(Why|How|What|When|Where)\b[^?]{15,220}\?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const problem = m[0].replace(/\s+/g, " ").trim();
    if (problem.length < 40) continue;
    if (/fix my itch|razorpay|india spoke|start building|all problems|top 10/i.test(problem)) continue;
    const key = norm(problem).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    // Score + category live in the ~250 chars AFTER the problem on the page.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 250);
    const scoreMatch = after.match(/\b(\d{1,2}(?:\.\d)?)\b/);
    const itchScore = scoreMatch ? Number(scoreMatch[1]) : null;
    const category = FIX_MY_ITCH_CATEGORIES.find((c) => after.toLowerCase().includes(c.toLowerCase())) ?? null;
    out.push({ problem, category, itchScore });
  }
  return out;
}

/**
 * Scan Fix My Itch: live fetch first; on ANY failure or empty parse,
 * fall back to the verified seed (labeled "fix-my-itch-seed").
 * Never throws, never returns fake live data.
 */
export async function scanFixMyItch(fetchFn: FetchFn = fetch): Promise<RawHit[]> {
  const toHit = (p: { problem: string; category: string | null; itchScore: number | null }, source: ProblemSource): RawHit => ({
    text: p.problem,
    niche: p.category ?? "general",
    source,
    evidence: FIX_MY_ITCH_URL,
    engagement: p.itchScore ?? 0,
    comments: 0,
    itchScore: p.itchScore ?? undefined,
  });
  try {
    const res = await fetchFn(FIX_MY_ITCH_URL, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseFixMyItchHtml(await res.text());
    if (parsed.length) return parsed.map((p) => toHit(p, "fix-my-itch"));
  } catch { /* fall through to seed */ }
  return FIX_MY_ITCH_SEED.map((p) => toHit(p, "fix-my-itch-seed"));
}

// --- Digital-fit classifier (deterministic, no AI quota) --------------------

const TEMPLATE_WORDS = [
  "invoice", "contract", "agreement", "freelancer", "milestone", "tracker",
  "checklist", "planner", "template", "spreadsheet", "supplier", "negotiat",
  "budget", "payment terms", "receipt", "quotation", "bookkeep",
];
const EBOOK_WORDS = [
  "loan", "career", "sleep", "anxiety", "guide", "learn", "roadmap",
  "education", "mental health", "skill", "exam", "interview", "savings",
  "tax", "invest", "fitness", "diet", "parenting",
];

/** Which of our digital products can solve this problem? */
export function classifyDigitalFit(problem: string): DigitalFit {
  const t = norm(problem);
  const isTemplate = TEMPLATE_WORDS.some((w) => t.includes(w));
  const isEbook = EBOOK_WORDS.some((w) => t.includes(w));
  if (isTemplate && isEbook) return "both";
  if (isTemplate) return "template";
  if (isEbook) return "ebook";
  return "none";
}

/**
 * Trend direction via pytrends bridge (scripts/trends_bridge.py).
 * ANY failure → "unknown" for all topics. Never faked.
 */
export async function trendDirection(topics: string[]): Promise<Record<string, TrendDirection>> {
  const fallback: Record<string, TrendDirection> = {};
  for (const t of topics) fallback[t] = "unknown";
  if (!topics.length) return fallback;
  try {
    const { join } = await import("path");
    const { stdout } = await execFileAsync(
      "python3",
      [join(process.cwd(), "scripts", "trends_bridge.py"), JSON.stringify(topics.slice(0, 10))],
      { timeout: 90000 }
    );
    const parsed = z.record(z.string(), z.enum(["rising", "stable", "falling", "unknown"])).safeParse(JSON.parse(stdout.trim().split("\n").pop()!));
    if (parsed.success) return { ...fallback, ...parsed.data };
  } catch { /* unknown */ }
  return fallback;
}

const TREND_BONUS: Record<TrendDirection, number> = { rising: 8, stable: 0, falling: -8, unknown: 0 };

/**
 * Rising related queries per topic (pytrends related_queries, "rising"
 * table, top 5). ANY failure → {} for all topics. Never faked.
 */
export async function risingQueries(topics: string[]): Promise<Record<string, string[]>> {
  const fallback: Record<string, string[]> = {};
  for (const t of topics) fallback[t] = [];
  if (!topics.length) return fallback;
  try {
    const { join } = await import("path");
    const { stdout } = await execFileAsync(
      "python3",
      [join(process.cwd(), "scripts", "trends_bridge.py"), "rising", JSON.stringify(topics.slice(0, 5))],
      { timeout: 90000 }
    );
    const parsed = z.record(z.string(), z.array(z.string())).safeParse(JSON.parse(stdout.trim().split("\n").pop()!));
    if (parsed.success) return { ...fallback, ...parsed.data };
  } catch { /* {} */ }
  return fallback;
}

/** Deterministic 0-100 score. No AI quota spent. */
export function scoreProblems(hits: RawHit[], trends: Record<string, TrendDirection> = {}): ProblemCard[] {
  const seen = new Set<string>();
  const cards: ProblemCard[] = [];
  for (const h of hits) {
    const key = norm(h.text).slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const signals = painSignals(h.text);
    let score = 10; // suggest/reddit hit base (real demand signal)
    score += Math.min(32, signals.length * 8);
    score += Math.min(20, 4 * Math.log10(h.engagement + 1));
    score += Math.min(16, 4 * Math.log10(h.comments + 1));
    if (h.createdUtc) {
      const days = (Date.now() / 1000 - h.createdUtc) / 86400;
      if (days <= 7) score += 6; else if (days <= 30) score += 3;
    }
    const trend = trends[h.niche] ?? "unknown";
    score += TREND_BONUS[trend];
    // Fix My Itch: itch score is a direct pain-intensity signal.
    if (h.itchScore) score += Math.min(30, h.itchScore / 3);
    cards.push({
      problem: h.text.slice(0, 200),
      niche: h.niche,
      source: h.source,
      evidence: [h.evidence],
      score: Math.max(0, Math.min(100, Math.round(score))),
      signals,
      trend,
      itchScore: h.itchScore,
      digitalFit: classifyDigitalFit(h.text),
    });
  }
  return cards.sort((a, b) => b.score - a.score);
}

/** Full mine: reddit + suggest + youtube + fix-my-itch → dedupe → trends → score → top 10. */
export async function mineProblems(
  opts: MineOptions,
  fetchFn: FetchFn = fetch
): Promise<{ problems: ProblemCard[]; risingQueries: Record<string, string[]>; scannedAt: string; niches: string[] }> {
  const all: RawHit[] = [];
  // Fix My Itch is niche-independent: fetch once, map each hit to the best
  // matching requested niche by keyword overlap, else "general".
  if (opts.includeFixMyItch !== false) {
    const itch = await scanFixMyItch(fetchFn);
    for (const hit of itch) {
      const hay = norm(`${hit.text} ${hit.niche}`);
      const match = opts.niches.find((n) => hay.includes(norm(n)));
      all.push({ ...hit, niche: match ?? "general" });
    }
  }
  for (const niche of opts.niches.slice(0, 5)) {
    const subs = opts.subreddits?.length
      ? opts.subreddits
      : [niche.replace(/\s+/g, ""), "selfimprovement", "productivity", "smallbusiness"];
    const [reddit, suggest, youtube] = await Promise.all([
      scanReddit(niche, subs, fetchFn),
      expandSuggest(niche, fetchFn),
      scanYouTubeSuggest(niche, fetchFn),
    ]);
    all.push(...reddit, ...suggest, ...youtube);
  }
  const [trends, rising] = await Promise.all([
    trendDirection(opts.niches.slice(0, 5)),
    risingQueries(opts.niches.slice(0, 5)),
  ]);
  const problems = scoreProblems(all, trends).slice(0, opts.maxPerNiche ?? 10);
  return { problems, risingQueries: rising, scannedAt: new Date().toISOString(), niches: opts.niches };
}
