/**
 * Meta Ad Library adapter — data source for the Three Signal Test
 * (Utkarsh Gose, "How To Find A Winning Digital Product").
 *
 * The Ad Library is FREE and official: `GET /ads_archive` on Meta's
 * Graph API. Search the words sellers use in their ads ("e-book",
 * "templates", "bundle", "instant download" — English AND Hindi) and
 * it returns matching ads. It does NOT show sales — spend and
 * impressions exist only for political ads, never for commercial ones.
 * That is exactly why the Three Signal Test infers demand from Time /
 * Versions / Crowd instead of sales numbers.
 *
 * Time: `ad_delivery_start_time` is when the ad started running
 * (preferred); `ad_creation_time` is the fallback. Versions: distinct
 * creative bodies for the same product. Crowd: distinct pages.
 *
 * Auth: an access token in env `META_AD_LIBRARY_TOKEN` (a Meta Graph
 * API token — NOT the Cloudflare token, NOT an IG/FB publishing
 * token). No token → skipped with a warning, never an exception.
 *
 * HONEST LIMIT: this adapter is code-complete but NOT live-tested —
 * no token exists yet. Do NOT claim it works live until a token is
 * installed and a real search returns ads. Do NOT auto-create a token.
 *
 * Never throws. 401 → auth warning, 429 → rate-limit warning (stop,
 * no retry loop), bad JSON → warning. Same pattern as Etsy (digital/etsy.ts).
 */

type FetchFn = typeof fetch;

const GRAPH_BASE = "https://graph.facebook.com/v21.0/ads_archive";

/** Fields requested — only what the Three Signal Test needs. */
const FIELDS = [
  "id",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_snapshot_url",
  "page_id",
  "page_name",
].join(",");

export interface AdLibraryAd {
  adId: string;
  pageId: string;
  pageName: string;
  /**
   * When the ad started running (ad_delivery_start_time preferred,
   * ad_creation_time fallback). Null when the API gave neither.
   */
  startedAt: string | null;
  /** First creative body text — tells ads for the same product apart. */
  creativeBody: string;
  creativeTitle: string;
  snapshotUrl: string;
  /** True while the ad is still running (no stop time). */
  active: boolean;
}

export interface AdLibrarySearchResult {
  ads: AdLibraryAd[];
  warnings: string[];
  /** Paging cursor for the next page (null when there are no more pages). */
  nextCursor: string | null;
}

export interface AdLibrarySummary {
  adCount: number;
  /** Age in days of the OLDEST ad (Time signal input). Null when no ads. */
  oldestAdAgeDays: number | null;
  /** Distinct creative bodies (Versions signal input). */
  versionCount: number;
  /** Distinct pages (Crowd signal input). */
  sellerCount: number;
  /** Ads still running. */
  activeCount: number;
  /** Distinct page names (Crowd evidence). */
  sellers: string[];
}

export interface AdLibrarySearchOptions {
  /** "ALL" = every ad type (the video's use). */
  adType?: string;
  /** Max ads per page. Default 25, clamped 1–100. */
  limit?: number;
  /** Paging cursor from a previous result's `nextCursor`. */
  cursor?: string | null;
  /** Overrides env META_AD_LIBRARY_TOKEN (tests pass a fake token). */
  token?: string;
  fetchFn?: FetchFn;
}

/**
 * Seller-language search terms from the video ("e-book", "templates",
 * "bundle", "instant download") plus generic product words. No prices
 * and no currency amounts — the list stays locale-agnostic; the
 * video's "₹199" example is a seller-language search term, not a
 * product price, and belongs in per-market keyword lists, not here.
 */
export const SELLER_KEYWORDS: string[] = [
  "e-book",
  "ebook",
  "templates",
  "template",
  "bundle",
  "instant download",
  "planner",
  "checklist",
  "workbook",
  "preset",
  "digital product",
  "hindi ebook",
];

function firstString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseAd(raw: unknown): AdLibraryAd | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const adId = firstString(r.id);
  const pageId = firstString(r.page_id);
  const pageName = firstString(r.page_name);
  if (!adId || !pageId) return null;
  const bodies = Array.isArray(r.ad_creative_bodies) ? r.ad_creative_bodies.map(firstString).filter(Boolean) : [];
  const titles = Array.isArray(r.ad_creative_link_titles)
    ? r.ad_creative_link_titles.map(firstString).filter(Boolean)
    : [];
  const startedAt = firstString(r.ad_delivery_start_time) || firstString(r.ad_creation_time) || null;
  return {
    adId,
    pageId,
    pageName: pageName || pageId,
    startedAt,
    creativeBody: bodies[0] ?? "",
    creativeTitle: titles[0] ?? "",
    snapshotUrl: firstString(r.ad_snapshot_url),
    active: !firstString(r.ad_delivery_stop_time),
  };
}

/**
 * Search the Ad Library for seller ads.
 * `keywords` are joined into one `search_terms` string (Meta caps it at
 * 100 characters — longer lists are truncated with a warning; call once
 * per keyword for precise per-term counts). `country` is an ISO code
 * ("IN") or a list (["IN", "US", "GB"]).
 */
export async function searchAds(
  keywords: string[],
  country: string | string[] = "IN",
  opts: AdLibrarySearchOptions = {}
): Promise<AdLibrarySearchResult> {
  const token = (opts.token ?? process.env.META_AD_LIBRARY_TOKEN ?? "").trim();
  if (!token) {
    return {
      ads: [],
      warnings: [
        "meta_ad_library_no_token: META_AD_LIBRARY_TOKEN is not set — Ad Library search skipped. Add a Meta Graph API token to the VM .env (file method, never chat).",
      ],
      nextCursor: null,
    };
  }
  const terms = (keywords ?? []).map((k) => (k ?? "").trim()).filter(Boolean);
  if (!terms.length) {
    return { ads: [], warnings: ["meta_ad_library_no_keywords: no search terms given"], nextCursor: null };
  }
  const countries = (Array.isArray(country) ? country : [country])
    .map((c) => (c ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (!countries.length) {
    return { ads: [], warnings: ["meta_ad_library_no_country: ad_reached_countries is required by the API"], nextCursor: null };
  }
  let searchTerms = terms.join(" ");
  const warnings: string[] = [];
  if (searchTerms.length > 100) {
    searchTerms = searchTerms.slice(0, 100);
    warnings.push("meta_ad_library_terms_truncated: search_terms is capped at 100 characters by the API");
  }
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 25)));
  const params = new URLSearchParams({
    access_token: token,
    search_terms: searchTerms,
    ad_type: (opts.adType ?? "ALL").trim().toUpperCase() || "ALL",
    ad_reached_countries: JSON.stringify(countries),
    fields: FIELDS,
    limit: String(limit),
  });
  if (opts.cursor) params.set("after", opts.cursor);
  const fetchFn: FetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(`${GRAPH_BASE}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return {
      ads: [],
      warnings: [`meta_ad_library_fetch_failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`],
      nextCursor: null,
    };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    return { ads: [], warnings: ["meta_ad_library_bad_json: API returned a non-JSON body"], nextCursor: null };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ads: [],
      warnings: [`meta_ad_library_auth: Meta rejected the token (HTTP ${res.status}) — check META_AD_LIBRARY_TOKEN`],
      nextCursor: null,
    };
  }
  if (res.status === 429) {
    return {
      ads: [],
      warnings: ["meta_ad_library_rate_limited: Meta rate-limited the search (HTTP 429) — stop, do not retry in a loop"],
      nextCursor: null,
    };
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? JSON.stringify((data as { error: unknown }).error).slice(0, 160)
        : `HTTP ${res.status}`;
    return { ads: [], warnings: [`meta_ad_library_error: ${msg}`], nextCursor: null };
  }
  const d = (data ?? {}) as { data?: unknown[]; paging?: { cursors?: { after?: string } } };
  const ads = (Array.isArray(d.data) ? d.data : []).map(parseAd).filter((a): a is AdLibraryAd => a !== null);
  return {
    ads,
    warnings,
    nextCursor: d.paging?.cursors?.after ?? null,
  };
}

/**
 * Aggregate ads into the three numbers the Three Signal Test needs.
 * `now` defaults to the current time; pass a fixed date in tests.
 * Time uses the OLDEST ad (how long this product has been advertised).
 */
export function summarizeAds(ads: AdLibraryAd[], now: Date = new Date()): AdLibrarySummary {
  const nowMs = now.getTime();
  let oldestMs: number | null = null;
  const bodies = new Set<string>();
  const pages = new Map<string, string>();
  let activeCount = 0;
  for (const ad of ads) {
    if (ad.active) activeCount++;
    if (ad.creativeBody) bodies.add(ad.creativeBody.trim().toLowerCase());
    if (ad.pageId) pages.set(ad.pageId, ad.pageName);
    if (ad.startedAt) {
      const t = Date.parse(ad.startedAt);
      if (Number.isFinite(t) && (oldestMs === null || t < oldestMs)) oldestMs = t;
    }
  }
  return {
    adCount: ads.length,
    oldestAdAgeDays:
      oldestMs === null ? null : Math.max(0, Math.floor((nowMs - oldestMs) / (24 * 60 * 60 * 1000))),
    versionCount: bodies.size,
    sellerCount: pages.size,
    activeCount,
    sellers: [...pages.values()].sort(),
  };
}
