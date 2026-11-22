/**
 * Customer Finder — evidence-backed first-customer / buyer prospecting.
 *
 * Synthesis of three MIT-licensed sources (see docs/customer-finding.md):
 * - first-customer-finder (Kappaemme-git): weighted qualification scoring,
 *   prospect stages, evidence ledger, feedback + local history model,
 *   report/CSV shape, URL validation. Ported, not copied verbatim.
 * - gosom/google-maps-scraper: the business-lead record (Entry fields).
 * - sellbird (AGPL-3.0 — DESIGN ONLY, no code): the buying-signal catalog,
 *   the discover → signals → enrich → verify pipeline, cohort-as-query,
 *   email-verification statuses, and the approval gate (drafts only).
 * - ECC lead-intelligence (MIT): one principle only — prefer a warm
 *   introduction path over a cold one.
 *
 * Hard rules (user's own): no outreach is ever SENT by this code — drafts
 * only, a human approves and sends. No private email/phone discovery, no
 * data brokers, no login-wall bypass. Scores are prioritisation, never a
 * promise that someone will buy. No fake claims, no invented results.
 */

export type FetchFn = typeof fetch;

/** 0–5 dimension scores for one prospect. */
export interface ProspectScores {
  /** Directness, severity, repetition, cost of the stated problem. */
  painStrength: number;
  /** How directly the product solves the evidenced job. */
  productFit: number;
  /** Freshness + presence of a current trigger. */
  timing: number;
  /** A natural, relevant public/professional contact path exists. */
  reachability: number;
  /** Specificity, source reliability, correct attribution. */
  evidenceQuality: number;
}

export const SCORE_WEIGHTS: Record<keyof ProspectScores, number> = {
  painStrength: 25,
  productFit: 25,
  timing: 20,
  reachability: 15,
  evidenceQuality: 15,
};

export type ScoreBand = "strong" | "promising" | "plausible" | "exclude";

/** Weighted 0–100 score + band. Caps are applied by the caller via applyScoreCaps. */
export function scoreProspect(scores: ProspectScores): { total: number; band: ScoreBand } {
  const clamp = (v: number) => Math.max(0, Math.min(5, v));
  const total =
    (clamp(scores.painStrength) / 5) * SCORE_WEIGHTS.painStrength +
    (clamp(scores.productFit) / 5) * SCORE_WEIGHTS.productFit +
    (clamp(scores.timing) / 5) * SCORE_WEIGHTS.timing +
    (clamp(scores.reachability) / 5) * SCORE_WEIGHTS.reachability +
    (clamp(scores.evidenceQuality) / 5) * SCORE_WEIGHTS.evidenceQuality;
  const rounded = Math.round(total * 10) / 10;
  const band: ScoreBand =
    rounded >= 80 ? "strong" : rounded >= 65 ? "promising" : rounded >= 50 ? "plausible" : "exclude";
  return { total: rounded, band };
}

/**
 * Framework caps (first-customer-finder): an unknown publication date caps
 * timing at 2/5; no verified suitable contact route caps reachability at 1/5.
 */
export function applyScoreCaps(
  scores: ProspectScores,
  opts: { signalDateKnown: boolean; contactRouteVerified: boolean },
): ProspectScores {
  return {
    ...scores,
    timing: opts.signalDateKnown ? scores.timing : Math.min(scores.timing, 2),
    reachability: opts.contactRouteVerified ? scores.reachability : Math.min(scores.reachability, 1),
  };
}

export type ProspectStage = "high_intent" | "problem_aware" | "trigger_present" | "potential_fit";
export type ProspectStatus = "new" | "contacted" | "replied" | "not_interested" | "customer";
export type ProspectFeedback = "keep" | "maybe" | "reject";
export type RoleBasis = "observed" | "inferred";
export type EvidenceStatus = "verified" | "unverified";
export type EmailVerification = "verified" | "risky" | "guess" | "invalid";

/** One piece of evidence behind a prospect. checkedAt is always separate from signalDate. */
export interface ProspectEvidence {
  sourceTitle: string;
  sourceUrl: string;
  /** Publication date, or null when the page shows none. */
  signalDate: string | null;
  /** When the source was actually opened and inspected (ISO). */
  checkedAt: string;
  sourceType: string;
  signal: string;
  status: EvidenceStatus;
}

export interface OutreachDraft {
  targetRole: string;
  roleBasis: RoleBasis;
  /** Concrete public route (thread, contact page, profile) — never a guessed address. */
  contactRoute: string | null;
  nextStep: string;
  cta: string;
  /** ≤90 words, in the buyer's problem language. */
  opener: string;
  caution: string;
}

export interface CustomerProspect {
  /** Stable id: hash of product slug + canonical entity URL (never a rank). */
  id: string;
  productSlug: string;
  entityName: string;
  entityUrl: string;
  stage: ProspectStage;
  scores: ProspectScores;
  total: number;
  band: ScoreBand;
  evidence: ProspectEvidence[];
  /** A mutual connection / warm introduction path, when one genuinely exists. */
  warmPath: string | null;
  draft: OutreachDraft | null;
  feedback: ProspectFeedback | null;
  feedbackReason: string | null;
  status: ProspectStatus;
  createdAt: string;
  updatedAt: string;
}

export function prospectId(productSlug: string, entityUrl: string): string {
  const key = `${productSlug}|${canonicalUrl(entityUrl)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `p-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Reject non-public, credential-bearing, or malformed URLs (upstream public_url). */
export function publicUrl(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected an absolute public HTTP(S) URL");
  const raw = value.trim();
  if ([...raw].some((c) => /\s/.test(c) || c.charCodeAt(0) < 32) || raw.includes("\\")) {
    throw new Error("URL contains whitespace, control characters, or backslashes");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid public URL: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Expected an absolute public HTTP(S) URL");
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Expected an absolute public HTTP(S) URL without credentials");
  }
  return raw;
}

/** Canonical form for dedup: lowercase host, strip www., twitter→x, drop default ports + tracking params. */
export function canonicalUrl(value: string): string {
  const parsed = new URL(publicUrl(value));
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (host === "twitter.com" || host === "mobile.twitter.com" || host === "mobile.x.com") host = "x.com";
  const port = parsed.port;
  const defaultPort = (parsed.protocol === "https:" && port === "443") || (parsed.protocol === "http:" && port === "80");
  const hostPort = port && !defaultPort ? `${host}:${port}` : host;
  const params = new URLSearchParams(parsed.search);
  for (const key of [...params.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid"].includes(key.toLowerCase())) params.delete(key);
  }
  const query = params.toString();
  return `${parsed.protocol}//${hostPort}${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`;
}

// ---------------------------------------------------------------------------
// Business leads (gosom/google-maps-scraper Entry record, MIT)
// ---------------------------------------------------------------------------

export interface BusinessLead {
  title: string;
  categories: string[];
  category: string;
  address: string;
  website: string;
  phone: string;
  reviewCount: number;
  reviewRating: number;
  latitude: number;
  longitude: number;
  plusCode: string;
  status: string;
  timezone: string;
  priceRange: string;
  dataId: string;
  link: string;
  /** Source of this record: "osm" (OpenStreetMap) or "maps" (a Google Maps export). */
  source: "osm" | "maps";
}

/** Normalize a gosom Entry JSON object (accepts both "longitude" and legacy "longtitude"). */
export function normalizeBusinessLead(raw: Record<string, unknown>): BusinessLead {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const cats = Array.isArray(raw.categories) ? raw.categories.filter((c): c is string => typeof c === "string") : [];
  return {
    title: str(raw.title),
    categories: cats,
    category: str(raw.category) || cats[0] || "",
    address: str(raw.address),
    website: str(raw.web_site),
    phone: str(raw.phone),
    reviewCount: num(raw.review_count),
    reviewRating: num(raw.review_rating),
    latitude: num(raw.latitude),
    longitude: num(raw.longitude ?? raw.longtitude),
    plusCode: str(raw.plus_code),
    status: str(raw.status),
    timezone: str(raw.timezone),
    priceRange: str(raw.price_range),
    dataId: str(raw.data_id),
    link: str(raw.link),
    source: "maps",
  };
}

// ---------------------------------------------------------------------------
// Buying signals (sellbird's 29-signal catalog, curated for this system;
// AGPL design only — no sellbird code. Every signal here is free to check.)
// ---------------------------------------------------------------------------

export interface BuyingSignal {
  id: string;
  group: "discovery" | "profile" | "people" | "contact";
  /** Plain-language meaning: what this tells you about the buyer. */
  meaning: string;
  cost: "free";
}

export const BUYING_SIGNALS: BuyingSignal[] = [
  { id: "NO_WEBSITE", group: "discovery", meaning: "Has a listing and a phone but no website — highest-intent signal if you sell websites/templates.", cost: "free" },
  { id: "UNCLAIMED_LISTING", group: "discovery", meaning: "Nobody claimed their Google Business Profile — owner not yet managing their presence.", cost: "free" },
  { id: "REVIEW_RATING", group: "discovery", meaning: "Good but invisible, or visible but struggling — rating with review count.", cost: "free" },
  { id: "REVIEW_COUNT", group: "discovery", meaning: "How many reviews they have; few reviews + decent rating = room to grow.", cost: "free" },
  { id: "IN_LOCAL_PACK", group: "discovery", meaning: "Holds one of the three map slots above the results — visible and competing.", cost: "free" },
  { id: "SERP_RANK", group: "discovery", meaning: "Where they rank for their own core search; positions 11–30 are the sweet spot — trying, and losing.", cost: "free" },
  { id: "RUNNING_GOOGLE_ADS", group: "profile", meaning: "Spending on acquisition today — the strongest budget signal available for free.", cost: "free" },
  { id: "RUNNING_META_ADS", group: "profile", meaning: "Running Meta ads now — paying to reach buyers.", cost: "free" },
  { id: "NO_ONLINE_BOOKING", group: "profile", meaning: "Leads must phone in, so after-hours demand is lost.", cost: "free" },
  { id: "NO_SCHEMA_MARKUP", group: "profile", meaning: "A concrete, checkable SEO gap you can name in a message.", cost: "free" },
  { id: "BLOG_STALE", group: "profile", meaning: "Content marketing started and abandoned.", cost: "free" },
  { id: "HIRING_ROLE", group: "profile", meaning: "Hiring for a role that means they are buying (from their own careers page).", cost: "free" },
  { id: "OPEN_ROLES", group: "profile", meaning: "How many roles are open — growth timing.", cost: "free" },
  { id: "INCUMBENT_AGENCY", group: "profile", meaning: "Who currently has the account, credited in their own footer.", cost: "free" },
  { id: "YC_BACKED", group: "profile", meaning: "Startup whose own site says it went through Y Combinator.", cost: "free" },
  { id: "ACCELERATOR", group: "profile", meaning: "Backed by an accelerator it names on its own site (Techstars, 500 Global, Antler…).", cost: "free" },
  { id: "FUNDING_ROUND", group: "profile", meaning: "Announced its own raise in the last 18 months (round, amount, date, from its own site).", cost: "free" },
  { id: "SITE_PAGE_COUNT", group: "profile", meaning: "Size of their site — a one-pager vs a real operation.", cost: "free" },
  { id: "TECH_STACK", group: "profile", meaning: "What platform they run on — fit for templates, tools, or services.", cost: "free" },
  { id: "CONTACT_FOUND", group: "people", meaning: "A named person on their own pages.", cost: "free" },
  { id: "DECISION_MAKER_TITLE", group: "people", meaning: "The named person's title shows they decide.", cost: "free" },
  { id: "LIKELY_OWNER", group: "people", meaning: "Evidence the contact owns the place.", cost: "free" },
  { id: "REGISTRY_VERIFIED", group: "people", meaning: "Ownership confirmed against a public registry.", cost: "free" },
  { id: "EMAIL_PATTERN", group: "contact", meaning: "The company's email pattern, learned from public addresses.", cost: "free" },
  { id: "EMAIL_STATUS", group: "contact", meaning: "One address verified as deliverable / risky / guess / invalid — only verified is ever used.", cost: "free" },
  { id: "CONTACT_FORM_URL", group: "contact", meaning: "A public contact form URL — a route that does not need an email address.", cost: "free" },
];

export function signalById(id: string): BuyingSignal | undefined {
  return BUYING_SIGNALS.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// Cohort-as-query (sellbird): a target set is a query, not a list.
// ---------------------------------------------------------------------------

export interface CohortQuery {
  /** Signal ids a prospect MUST carry. */
  mustHave: string[];
  /** Signal ids that DISQUALIFY a prospect. */
  mustNotHave: string[];
  /** Numeric ranges, e.g. { REVIEW_RATING: { min: 3, max: 4.2 } }. */
  ranges: Record<string, { min?: number; max?: number }>;
}

export interface ScoredLead {
  lead: BusinessLead;
  signals: string[];
  numeric: Record<string, number>;
}

export function matchCohort(item: ScoredLead, query: CohortQuery): boolean {
  const have = new Set(item.signals);
  if (query.mustHave.some((s) => !have.has(s))) return false;
  if (query.mustNotHave.some((s) => have.has(s))) return false;
  for (const [key, range] of Object.entries(query.ranges)) {
    const v = item.numeric[key];
    if (v === undefined) return false;
    if (range.min !== undefined && v < range.min) return false;
    if (range.max !== undefined && v > range.max) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// History + feedback (first-customer-finder state model, local only)
// ---------------------------------------------------------------------------

export interface ProspectHistory {
  productSlug: string;
  /** Explicit general criteria: e.g. prefer "owner-led small businesses". */
  prefer: string[];
  avoid: string[];
  prospects: Record<string, CustomerProspect>;
  updatedAt: string;
}

export function emptyHistory(productSlug: string, now = new Date()): ProspectHistory {
  return { productSlug, prefer: [], avoid: [], prospects: {}, updatedAt: now.toISOString() };
}

/** Save keep/maybe/reject feedback with a reason. A rejected COMPANY is not a rejected industry. */
export function applyFeedback(
  history: ProspectHistory,
  prospectIdValue: string,
  feedback: ProspectFeedback,
  reason: string,
  now = new Date(),
): ProspectHistory {
  const p = history.prospects[prospectIdValue];
  if (!p) return history;
  return {
    ...history,
    prospects: {
      ...history.prospects,
      [prospectIdValue]: { ...p, feedback, feedbackReason: reason, updatedAt: now.toISOString() },
    },
    updatedAt: now.toISOString(),
  };
}

/** Record a real outcome. Only the user supplies it — generating a draft is NOT contacting. */
export function recordOutcome(
  history: ProspectHistory,
  prospectIdValue: string,
  status: ProspectStatus,
  now = new Date(),
): ProspectHistory {
  const p = history.prospects[prospectIdValue];
  if (!p) return history;
  return {
    ...history,
    prospects: {
      ...history.prospects,
      [prospectIdValue]: { ...p, status, updatedAt: now.toISOString() },
    },
    updatedAt: now.toISOString(),
  };
}

/** Prospects eligible for a fresh search: never seen, never contacted, never rejected. */
export function unseenProspects(history: ProspectHistory): CustomerProspect[] {
  return Object.values(history.prospects).filter(
    (p) => p.feedback !== "reject" && p.status === "new" && !p.feedback,
  );
}

/** Drop candidates whose canonical entity URL was already seen (dedup across runs). */
export function excludeSeen<T extends { entityUrl: string }>(candidates: T[], history: ProspectHistory): T[] {
  const seen = new Set(Object.values(history.prospects).map((p) => canonicalUrl(p.entityUrl)));
  return candidates.filter((c) => {
    try {
      return !seen.has(canonicalUrl(c.entityUrl));
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// CSV export (spreadsheet-safe; formula-injection escaping like upstream)
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  let v = value;
  // Never let a cell execute as a formula: =, +, -, @, tab, CR at the start.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export const PROSPECT_CSV_HEADERS = [
  "id",
  "entity",
  "entity_url",
  "stage",
  "score",
  "band",
  "pain",
  "fit",
  "timing",
  "reachability",
  "evidence",
  "contact_route",
  "next_step",
  "cta",
  "status",
  "feedback",
] as const;

export function prospectToCsvRow(p: CustomerProspect): string {
  const cells = [
    p.id,
    p.entityName,
    p.entityUrl,
    p.stage,
    String(p.total),
    p.band,
    String(p.scores.painStrength),
    String(p.scores.productFit),
    String(p.scores.timing),
    String(p.scores.reachability),
    String(p.scores.evidenceQuality),
    p.draft?.contactRoute ?? "",
    p.draft?.nextStep ?? "",
    p.draft?.cta ?? "",
    p.status,
    p.feedback ?? "",
  ];
  return cells.map(csvCell).join(",");
}

export function prospectsToCsv(prospects: CustomerProspect[]): string {
  return [PROSPECT_CSV_HEADERS.join(","), ...prospects.map(prospectToCsvRow)].join("\n");
}
