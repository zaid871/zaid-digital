/**
 * Beat-the-#1 loop — marketing workflow that tracks the top performer in
 * every field (ebook / template / POD) on every platform (KDP, Etsy,
 * YouTube, Reddit, Instagram, Facebook, X, Pinterest) and measures the
 * gap to our own numbers, so the next cycle can close it.
 *
 * Automation doctrine (user: "koi cheez manual na rakho"):
 *  - #1 is AUTO-DISCOVERED wherever a free source exists: YouTube Data
 *    API (top video by views), Etsy API (top listing by favorites),
 *    Reddit public JSON (top weekly post), Amazon public pages (category
 *    #1 ASIN + Best Sellers Rank).
 *  - Instagram / Facebook / X / Pinterest have NO free competitor API,
 *    so the loop reads their PUBLIC profile pages (og:description:
 *    "12.3K Followers...") with a browser User-Agent — the same numbers
 *    any logged-out visitor sees. If a platform serves a login wall, a
 *    bot wall or a 429, the run records `competitor_blocked_*` + keeps
 *    the last-known value and retries next week. It NEVER asks the user
 *    to do it by hand, and NEVER uses session tokens, unofficial APIs or
 *    login bypasses to force the number (same standard as the Meta AI
 *    WebSocket refusal).
 *  - Social handles for IG/FB/X/Pinterest are derived from the YouTube
 *    winner's channel description (creators link their socials there);
 *    a registry entry (set once via the competitors endpoint) wins over
 *    auto-discovery when both exist.
 *  - Every fetch failure is a warning, never a throw — the sweep always
 *    produces a plan with what it could measure.
 *
 * Gap math: score = lowerIsBetter ? their/ours : ours/their (ours>0).
 * beating >= 1, closing >= 0.7, else behind. The #1's metric becomes the
 * goal-loop NORTH STAR for that productKey::channel (prescriptive stretch
 * target — exactly what northStar is for), so the existing Sunday
 * goal-loop sweep flags the gap automatically.
 *
 * Worker-side module — do NOT import from Next.js App Routes.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { z } from "zod";
import { GoalStore } from "./goal-loop";
import { searchEtsyListings } from "../digital/etsy";
import { analyzeBestsellers } from "../digital/bestsellers";
import { defaultTextGen as ebookTextGen } from "../digital/ebook";

export type BeatField = "ebook" | "template" | "pod";
export type BeatPlatform =
  | "kdp" | "etsy" | "youtube" | "reddit"
  | "instagram" | "facebook" | "x" | "pinterest";

export const BEAT_FIELDS: BeatField[] = ["ebook", "template", "pod"];
export const BEAT_PLATFORMS: BeatPlatform[] = [
  "kdp", "etsy", "youtube", "reddit", "instagram", "facebook", "x", "pinterest",
];

export type FetchFn = typeof fetch;
export type BeatTextGen = (prompt: string, maxTokens: number) => Promise<string>;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15000;
/** Niches per field per collect run (same cap as the bestseller analyzer). */
export const MAX_NICHES_PER_FIELD = 3;

export interface CompetitorTarget {
  field: BeatField;
  platform: BeatPlatform;
  niche: string;
  handle?: string;
  url?: string;
  asin?: string;
  subreddit?: string;
  displayName?: string;
  source: "auto" | "registry";
}

export interface Benchmark {
  field: BeatField;
  platform: BeatPlatform;
  niche: string;
  metric: string;
  value: number;
  lowerIsBetter: boolean;
  evidence: string;
  ourValue: number | null;
  fetchedAt: string;
}

export interface BeatGap {
  field: BeatField;
  platform: BeatPlatform;
  niche: string;
  metric: string;
  theirValue: number;
  ourValue: number | null;
  gapPct: number;
  status: "beating" | "closing" | "behind" | "unknown";
  evidence: string;
  actions: string[];
}

export interface BeatPlan {
  generatedAt: string;
  targetsChecked: number;
  beating: number;
  gaps: BeatGap[];
  warnings: string[];
  benchmarks: Benchmark[];
}

const targetSchema = z.object({
  field: z.enum(["ebook", "template", "pod"]),
  platform: z.enum(["kdp", "etsy", "youtube", "reddit", "instagram", "facebook", "x", "pinterest"]),
  niche: z.string().min(1).max(100),
  handle: z.string().max(100).optional(),
  url: z.string().max(500).optional(),
  asin: z.string().max(20).optional(),
  subreddit: z.string().max(50).optional(),
  displayName: z.string().max(120).optional(),
  source: z.enum(["auto", "registry"]).optional(),
});

export const competitorsBodySchema = z.object({
  targets: z.array(targetSchema).max(64),
});

export const collectBodySchema = z.object({
  fields: z
    .array(z.object({
      field: z.enum(["ebook", "template", "pod"]),
      niches: z.array(z.string().min(1).max(100)).max(5),
    }))
    .max(3)
    .optional(),
});

export const analyzeBodySchema = z.object({
  benchmarks: z.array(z.object({
    field: z.enum(["ebook", "template", "pod"]),
    platform: z.enum(["kdp", "etsy", "youtube", "reddit", "instagram", "facebook", "x", "pinterest"]),
    niche: z.string().min(1).max(100),
    metric: z.string().min(1).max(60),
    value: z.number().finite().min(0),
    lowerIsBetter: z.boolean(),
    evidence: z.string().max(500),
    ourValue: z.number().finite().min(0).nullable(),
    fetchedAt: z.string().max(40),
  })).max(64),
});

function competitorsPath(): string {
  if (process.env.BEAT_COMPETITORS_PATH) return process.env.BEAT_COMPETITORS_PATH;
  return join(process.cwd(), "storage", "marketing", "competitors.json");
}

function planPath(): string {
  if (process.env.BEAT_PLAN_PATH) return process.env.BEAT_PLAN_PATH;
  return join(process.cwd(), "storage", "marketing", "beat", "latest.json");
}

export async function loadTargets(): Promise<CompetitorTarget[]> {
  try {
    const raw = await readFile(competitorsPath(), "utf-8");
    const data = JSON.parse(raw) as CompetitorTarget[];
    if (!Array.isArray(data)) return [];
    return data.filter(
      (t) => t && BEAT_FIELDS.includes(t.field) && BEAT_PLATFORMS.includes(t.platform) && typeof t.niche === "string"
    );
  } catch {
    return [];
  }
}

export async function saveTargets(targets: CompetitorTarget[]): Promise<void> {
  const path = competitorsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(targets, null, 2));
  await import("fs/promises").then((m) => m.rename(tmp, path));
}

export async function loadPlan(): Promise<BeatPlan | null> {
  try {
    const raw = await readFile(planPath(), "utf-8");
    const data = JSON.parse(raw) as BeatPlan;
    if (!data || !Array.isArray(data.benchmarks)) return null;
    return data;
  } catch {
    return null;
  }
}

async function savePlan(plan: BeatPlan): Promise<void> {
  const path = planPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(plan, null, 2));
  await import("fs/promises").then((m) => m.rename(tmp, path));
}

/** "12.3K" -> 12300, "1.2M" -> 1200000, "45,678" -> 45678. */
export function parseCount(raw: string): number | null {
  const m = raw.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] : 1;
  return Math.round(n * mult);
}

/** Amazon product page HTML -> Best Sellers Rank number (lower = better). */
export function parseBsr(html: string): number | null {
  if (/Enter the characters you see|automated access|To discuss automated access/i.test(html)) return null;
  const m = html.match(/Best Sellers Rank\s*:?\s*#([\d,]+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** First /dp/<ASIN> link on an Amazon search page. */
export function parseFirstAsin(html: string): string | null {
  const m = html.match(/\/dp\/(B0[A-Z0-9]{8,})/);
  return m ? m[1] : null;
}

/** og:description content of a public profile page, or null (login wall). */
export function parseOgDescription(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  return m ? m[1] : null;
}

/** Followers from a public profile's og:description ("12.3K Followers, ..."). */
export function parseFollowers(ogDescription: string): number | null {
  const m = ogDescription.match(/([\d.,]+\s*[KMB]?)\s*(?:Followers|followers)/);
  if (m) return parseCount(m[1]);
  // Facebook pages report likes first: "12,345 likes · 13,000 followers".
  const likes = ogDescription.match(/([\d.,]+\s*[KMB]?)\s*likes/i);
  if (likes) return parseCount(likes[1]);
  return null;
}

/** Social handles a creator links in their YouTube channel description. */
export function parseSocialHandles(description: string): Partial<Record<"instagram" | "facebook" | "x" | "pinterest", string>> {
  const out: Partial<Record<"instagram" | "facebook" | "x" | "pinterest", string>> = {};
  const ig = description.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (ig) out.instagram = ig[1].replace(/\/$/, "");
  const fb = description.match(/facebook\.com\/([A-Za-z0-9._]+)/i);
  if (fb) out.facebook = fb[1].replace(/\/$/, "");
  const x = description.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i);
  if (x) out.x = x[1].replace(/\/$/, "");
  const pin = description.match(/pinterest\.com\/([A-Za-z0-9_]+)/i);
  if (pin) out.pinterest = pin[1].replace(/\/$/, "");
  return out;
}

async function fetchJson(fetchFn: FetchFn, url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", ...(headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(fetchFn: FetchFn, url: string): Promise<string> {
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface YouTubeTop {
  videoTitle: string;
  videoUrl: string;
  views: number;
  channelTitle: string;
  channelId: string;
  subscribers: number;
  description: string;
}

/** YouTube #1 for a niche: top video by views + its channel stats. */
export async function fetchYouTubeTop(
  niche: string,
  apiKey: string | undefined,
  fetchFn: FetchFn = fetch
): Promise<YouTubeTop | null> {
  if (!apiKey) return null;
  const sData = (await fetchJson(
    fetchFn,
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=1&q=${encodeURIComponent(niche)}&key=${apiKey}`
  )) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; channelId?: string } }> };
  const item = (sData.items ?? [])[0];
  const videoId = item?.id?.videoId;
  if (!videoId || !item.snippet?.title) return null;
  const [vData, cData] = await Promise.all([
    fetchJson(
      fetchFn,
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${apiKey}`
    ) as Promise<{ items?: Array<{ statistics?: { viewCount?: string } }> }>,
    item.snippet.channelId
      ? (fetchJson(
          fetchFn,
          `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${item.snippet.channelId}&key=${apiKey}`
        ) as Promise<{ items?: Array<{ statistics?: { subscriberCount?: string }; snippet?: { description?: string } }> }>)
      : Promise.resolve({ items: [] }),
  ]);
  return {
    videoTitle: item.snippet.title,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    views: Number(vData.items?.[0]?.statistics?.viewCount ?? 0),
    channelTitle: item.snippet.channelTitle ?? "",
    channelId: item.snippet.channelId ?? "",
    subscribers: Number(cData.items?.[0]?.statistics?.subscriberCount ?? 0),
    description: cData.items?.[0]?.snippet?.description ?? "",
  };
}

/** KDP: a known ASIN's Best Sellers Rank straight from its product page. */
export async function fetchKdpByAsin(asin: string, fetchFn: FetchFn = fetch): Promise<KdpTop | null> {
  const pageHtml = await fetchText(fetchFn, `https://www.amazon.com/dp/${asin}`);
  const rank = parseBsr(pageHtml);
  if (rank === null) return null;
  const titleMatch = pageHtml.match(/<title>([^<]{1,200})<\/title>/i);
  return {
    asin,
    title: (titleMatch?.[1] ?? asin).replace(/\s*:?\s*Amazon\.[a-z.]+.*$/i, "").trim(),
    rank,
    url: `https://www.amazon.com/dp/${asin}`,
  };
}

interface RedditTop {
  title: string;
  url: string;
  upvotes: number;
  comments: number;
}

/** Reddit #1 for a subreddit: top weekly post by score (public JSON, no key). */
export async function fetchRedditTop(subreddit: string, fetchFn: FetchFn = fetch): Promise<RedditTop | null> {
  const data = (await fetchJson(fetchFn, `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?t=week&limit=5`, {
    "User-Agent": BROWSER_UA,
  })) as { data?: { children?: Array<{ data?: { title?: string; score?: number; num_comments?: number; permalink?: string } }> } };
  const posts = (data.data?.children ?? [])
    .map((c) => c.data ?? {})
    .filter((d) => d.title)
    .sort((a, b) => (Number(b.score ?? 0) - Number(a.score ?? 0)));
  const top = posts[0];
  if (!top) return null;
  return {
    title: String(top.title),
    url: `https://www.reddit.com${String(top.permalink ?? "")}`,
    upvotes: Number(top.score ?? 0),
    comments: Number(top.num_comments ?? 0),
  };
}

interface KdpTop {
  asin: string;
  title: string;
  rank: number;
  url: string;
}

/** KDP #1 for a niche: Amazon Kindle search -> first ASIN -> product page BSR. */
export async function fetchKdpTop(niche: string, fetchFn: FetchFn = fetch): Promise<KdpTop | null> {
  const searchHtml = await fetchText(
    fetchFn,
    `https://www.amazon.com/s?k=${encodeURIComponent(niche)}&i=digital-text`
  );
  const asin = parseFirstAsin(searchHtml);
  if (!asin) return null;
  const pageHtml = await fetchText(fetchFn, `https://www.amazon.com/dp/${asin}`);
  const rank = parseBsr(pageHtml);
  if (rank === null) return null;
  const titleMatch = pageHtml.match(/<title>([^<]{1,200})<\/title>/i);
  return {
    asin,
    title: (titleMatch?.[1] ?? asin).replace(/\s*:?\s*Amazon\.[a-z.]+.*$/i, "").trim(),
    rank,
    url: `https://www.amazon.com/dp/${asin}`,
  };
}

/** Public profile followers (IG/FB/X/Pinterest) from og:description. */
export async function fetchPublicFollowers(
  platform: "instagram" | "facebook" | "x" | "pinterest",
  handle: string,
  fetchFn: FetchFn = fetch
): Promise<number | null> {
  const base = {
    instagram: "https://www.instagram.com",
    facebook: "https://www.facebook.com",
    x: "https://x.com",
    pinterest: "https://www.pinterest.com",
  }[platform];
  const html = await fetchText(fetchFn, `${base}/${encodeURIComponent(handle)}/`);
  const og = parseOgDescription(html);
  if (!og) return null;
  return parseFollowers(og);
}

function ourValueFromStore(store: GoalStore | null, field: BeatField, platform: BeatPlatform, metric: string): number | null {
  if (!store) return null;
  const goal = store.get(field, platform);
  const latest = goal?.history[goal.history.length - 1];
  const v = latest?.metrics[metric];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function keyOf(field: BeatField, platform: BeatPlatform, niche: string): string {
  return `${field}::${platform}::${niche}`;
}

export interface CollectResult {
  targets: CompetitorTarget[];
  benchmarks: Benchmark[];
  warnings: string[];
}

/**
 * One collect pass: auto-discover #1 per field x niche x platform (YT,
 * Etsy, Reddit, KDP + social handles from the YT winner's description),
 * merge registry entries (registry wins on conflict), fetch every
 * benchmark. Never throws — failures become warnings + last-known values.
 */
export async function collectBeat(
  fields: Array<{ field: BeatField; niches: string[] }>,
  deps?: { fetchFn?: FetchFn; store?: GoalStore | null }
): Promise<CollectResult> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const store = deps?.store ?? null;
  const ytKey = process.env.YOUTUBE_API_KEY || undefined;
  const etsyKey = process.env.ETSY_API_KEY || undefined;
  const targets: CompetitorTarget[] = [];
  const benchmarks: Benchmark[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const prevPlan = await loadPlan();
  const lastKnown = new Map<string, Benchmark>();
  for (const b of prevPlan?.benchmarks ?? []) lastKnown.set(keyOf(b.field, b.platform, b.niche), b);

  const pushTarget = (t: CompetitorTarget) => {
    const k = keyOf(t.field, t.platform, t.niche);
    if (seen.has(k)) return;
    seen.add(k);
    targets.push(t);
  };
  const pushBenchmark = (b: Benchmark) => {
    benchmarks.push({ ...b, ourValue: ourValueFromStore(store, b.field, b.platform, b.metric) });
  };
  const useLastKnown = (field: BeatField, platform: BeatPlatform, niche: string, reason: string) => {
    const prev = lastKnown.get(keyOf(field, platform, niche));
    if (prev) {
      pushBenchmark({ ...prev, fetchedAt: new Date().toISOString() });
      warnings.push(`${field}/${platform}/${niche}: ${reason} — last-known value use ho rahi hai (${prev.value})`);
    } else {
      warnings.push(`${field}/${platform}/${niche}: ${reason} — pehle kabhi measure nahi hua, is run mein skip`);
    }
  };

  // Registry entries first (they win on conflict via `seen`).
  const registry = await loadTargets();
  const registryByKey = new Map<string, CompetitorTarget>();
  for (const t of registry) registryByKey.set(keyOf(t.field, t.platform, t.niche), t);

  for (const { field, niches } of fields) {
    for (const niche of niches.slice(0, MAX_NICHES_PER_FIELD)) {
      // YouTube — top video by views (+ channel stats for social handles).
      // YT/Etsy are always auto: the #1 IS whoever tops the search.
      let ytTop: YouTubeTop | null = null;
      if (ytKey) {
        try {
          const top = await fetchYouTubeTop(niche, ytKey, fetchFn);
          if (top && top.views > 0) {
            ytTop = top;
            pushTarget({ field, platform: "youtube", niche, displayName: top.channelTitle, url: top.videoUrl, source: "auto" });
            pushBenchmark({
              field, platform: "youtube", niche, metric: "topVideoViews", value: top.views, lowerIsBetter: false,
              evidence: `${top.videoTitle} — ${top.channelTitle} (${top.subscribers.toLocaleString("en-IN")} subs)`, ourValue: null, fetchedAt: new Date().toISOString(),
            });
          } else {
            warnings.push(`${field}/youtube/${niche}: top video nahi mila`);
          }
        } catch (err) {
          useLastKnown(field, "youtube", niche, `YouTube fetch fail (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
        }
      } else {
        warnings.push(`${field}/youtube/${niche}: youtube_skipped_no_key — YOUTUBE_API_KEY nahi hai (free key .env mein daalo)`);
      }

      // Social (IG/FB/X/Pinterest) — registry handle wins; else the YT
      // winner's channel description (creators link their socials there).
      // Runs even without a YT key when the registry has a handle.
      const socialHandles = ytTop ? parseSocialHandles(ytTop.description) : {};
      for (const platform of ["instagram", "facebook", "x", "pinterest"] as const) {
        const reg = registryByKey.get(keyOf(field, platform, niche));
        const handle = reg?.handle ?? socialHandles[platform];
        if (!handle) continue;
        const source = reg ? "registry" as const : "auto" as const;
        pushTarget({ field, platform, niche, handle, displayName: reg?.displayName ?? ytTop?.channelTitle, source });
        try {
          const followers = await fetchPublicFollowers(platform, handle, fetchFn);
          if (followers !== null && followers > 0) {
            pushBenchmark({
              field, platform, niche, metric: "followers", value: followers, lowerIsBetter: false,
              evidence: `@${handle} on ${platform}${reg ? " (registry)" : ` (via ${ytTop?.channelTitle ?? "YouTube winner"}'s YouTube description)`}`, ourValue: null, fetchedAt: new Date().toISOString(),
            });
          } else {
            warnings.push(`${field}/${platform}/${niche}: @${handle} ka public page login wall de raha hai — followers nahi mile`);
          }
        } catch (err) {
          useLastKnown(field, platform, niche, `${platform} fetch fail (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
        }
      }

      // Etsy — top listing by favorites (templates + POD via Etsy).
      if (etsyKey) {
        try {
          const query = field === "ebook" ? `${niche} ebook` : field === "pod" ? niche : `${niche} template`;
          const r = await searchEtsyListings(query, etsyKey, { fetchFn });
          warnings.push(...r.warnings.map((w) => `${field}/etsy/${niche}: ${w}`));
          const top = r.listings[0];
          if (top) {
            pushTarget({ field, platform: "etsy", niche, displayName: top.title, url: top.url, source: "auto" });
            pushBenchmark({
              field, platform: "etsy", niche, metric: "topFavorers", value: top.favorers, lowerIsBetter: false,
              evidence: `${top.title} — ${top.favorers} favorites, ${top.reviewCount ?? 0} reviews, shop sales ${top.shopSales ?? "?"}`,
              ourValue: null, fetchedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          useLastKnown(field, "etsy", niche, `Etsy fetch fail (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
        }
      } else {
        warnings.push(`${field}/etsy/${niche}: etsy_skipped_no_key — ETSY_API_KEY nahi hai (free key developers.etsy.com se)`);
      }

      // Reddit — top weekly post. Subreddit: registry wins, else the
      // niche name with spaces removed (same default as the miner).
      const subreddit = registryByKey.get(keyOf(field, "reddit", niche))?.subreddit ?? niche.replace(/\s+/g, "");
      try {
        const top = await fetchRedditTop(subreddit, fetchFn);
        if (top && top.upvotes > 0) {
          pushTarget({ field, platform: "reddit", niche, subreddit, displayName: `r/${subreddit}`, url: top.url, source: registryByKey.has(keyOf(field, "reddit", niche)) ? "registry" : "auto" });
          pushBenchmark({
            field, platform: "reddit", niche, metric: "topPostUpvotes", value: top.upvotes, lowerIsBetter: false,
            evidence: `${top.title} — ${top.upvotes} upvotes, ${top.comments} comments`, ourValue: null, fetchedAt: new Date().toISOString(),
          });
        } else {
          warnings.push(`${field}/reddit/${niche}: r/${subreddit} mein top post nahi mila (subreddit shayad hai hi nahi)`);
        }
      } catch (err) {
        useLastKnown(field, "reddit", niche, `Reddit fetch fail (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
      }

      // KDP — registry ASIN wins; else Amazon Kindle search -> #1 ASIN.
      const kdpReg = registryByKey.get(keyOf(field, "kdp", niche));
      try {
        const top = kdpReg?.asin
          ? await fetchKdpByAsin(kdpReg.asin, fetchFn)
          : await fetchKdpTop(niche, fetchFn);
        if (top) {
          pushTarget({ field, platform: "kdp", niche, asin: top.asin, displayName: top.title, url: top.url, source: kdpReg?.asin ? "registry" : "auto" });
          pushBenchmark({
            field, platform: "kdp", niche, metric: "bestSellersRank", value: top.rank, lowerIsBetter: true,
            evidence: `${top.title} — BSR #${top.rank.toLocaleString("en-IN")}`, ourValue: null, fetchedAt: new Date().toISOString(),
          });
        } else {
          warnings.push(`${field}/kdp/${niche}: Amazon se BSR nahi mila (bot-wall ya page structure badla)`);
        }
      } catch (err) {
        useLastKnown(field, "kdp", niche, `KDP fetch fail (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
      }
    }
  }

  return { targets, benchmarks, warnings };
}

function gapScore(b: Benchmark): number {
  if (b.ourValue === null || b.ourValue <= 0) return 0;
  return b.lowerIsBetter ? b.value / b.ourValue : b.ourValue / b.value;
}

export function gapStatus(score: number, ourValue: number | null): BeatGap["status"] {
  if (ourValue === null) return "unknown";
  if (score >= 1) return "beating";
  if (score >= 0.7) return "closing";
  return "behind";
}

/**
 * Analyze benchmarks into a beat plan: gap per target + the actions that
 * close it (bestseller style angles for the niche) + the #1's metric as
 * the goal-loop north star for that productKey::channel.
 */
export async function analyzeBeat(
  benchmarks: Benchmark[],
  store: GoalStore,
  deps?: { textGen?: BeatTextGen }
): Promise<BeatPlan> {
  const warnings: string[] = [];
  const gaps: BeatGap[] = [];

  // Style angles per niche (one analyzer call per niche group, bank fallback).
  const byNiche = new Map<string, Benchmark[]>();
  for (const b of benchmarks) {
    const list = byNiche.get(b.niche) ?? [];
    list.push(b);
    byNiche.set(b.niche, list);
  }
  const actionsByNiche = new Map<string, string[]>();
  for (const [niche, list] of byNiche) {
    try {
      const r = await analyzeBestsellers(
        [{ niche, evidence: list.map((b) => `${b.platform}: ${b.evidence}`) }],
        { includeYouTube: false, includeEtsy: false, useAi: true },
        { textGen: deps?.textGen ?? ebookTextGen }
      );
      warnings.push(...r.warnings.map((w) => `${niche}: ${w}`));
      const n0 = r.niches[0];
      actionsByNiche.set(niche, [...(n0?.uniquenessInStyle ?? []), ...(n0?.whatsMissing ?? [])].slice(0, 3));
    } catch (err) {
      warnings.push(`${niche}: style angles nahi bane (${err instanceof Error ? err.message.slice(0, 80) : String(err)})`);
      actionsByNiche.set(niche, []);
    }
  }

  for (const b of benchmarks) {
    const score = gapScore(b);
    const status = gapStatus(score, b.ourValue);
    gaps.push({
      field: b.field, platform: b.platform, niche: b.niche, metric: b.metric,
      theirValue: b.value, ourValue: b.ourValue,
      gapPct: b.ourValue === null ? 0 : Math.max(0, Math.round((1 - score) * 100)),
      status, evidence: b.evidence,
      actions: actionsByNiche.get(b.niche) ?? [],
    });
    // #1's metric = north star for this product+channel (dynamic target).
    if (b.value > 0) {
      store.setNorthStar(b.field, b.platform, b.metric, b.value);
    }
  }
  await store.save();

  const plan: BeatPlan = {
    generatedAt: new Date().toISOString(),
    targetsChecked: benchmarks.length,
    beating: gaps.filter((g) => g.status === "beating").length,
    gaps,
    warnings,
    benchmarks,
  };
  await savePlan(plan);
  return plan;
}

/** Default collect fields: all three fields over the miner niches. */
export function defaultFields(): Array<{ field: BeatField; niches: string[] }> {
  const niches = (process.env.DIGITAL_MINER_NICHES ?? "budget planner")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_NICHES_PER_FIELD);
  return BEAT_FIELDS.map((field) => ({ field, niches }));
}
