/**
 * Etsy Open API v3 — analysis from the platform where templates actually sell.
 *
 * Verified against Etsy's own OpenAPI spec (2026-11-08, fetched live):
 *  - Base: https://openapi.etsy.com/v3/application
 *  - Public listing search (findAllListingsActive) needs API KEY ONLY —
 *    no OAuth user token. Header: x-api-key: `keystring:shared_secret`
 *    (both from https://www.etsy.com/developers/your-apps, free app).
 *  - Listing fields: title, url, price {amount, divisor, currency},
 *    num_favorers, tags, shop_id. NO num_sold on listings — per-listing
 *    sales count does not exist in the API.
 *  - Shop fields: transaction_sold_count (shop's TOTAL sales — the
 *    closest real sales number the API gives).
 *  - Reviews endpoint (api_key-only): count + average rating.
 *
 * So "kya bik raha hai" is measured by real platform signals, not
 * guesses: num_favorers (Etsy popularity) + review count/rating +
 * shop total sales. Exact per-listing sales koi free API nahi deta —
 * ye limit hai, feature nahi.
 *
 * Creative Market: koi public API nahi. Gumroad: API sirf apni khud ki
 * sales ke liye (OAuth, own account) — competitors ke liye nahi. Unke
 * liye lane: manual competitors (already built) + one-off browser read
 * on user request — scheduled scrape nahi (ToS/ban risk).
 *
 * Never throws. No key → skipped with a warning. 401 → auth warning,
 * 429 → rate-limit warning (stop, no retry loop).
 */
type FetchFn = typeof fetch;

const BASE = "https://openapi.etsy.com/v3/application";

export interface EtsyListing {
  listingId: number;
  title: string;
  url: string;
  price: number | null;
  currency: string;
  favorers: number;
  tags: string[];
  shopId: number;
  /** Shop's TOTAL sales (transaction_sold_count) — closest real sales number. */
  shopSales?: number;
  reviewCount?: number;
  reviewAvg?: number | null;
}

export interface EtsySearchResult {
  listings: EtsyListing[];
  warnings: string[];
}

function cleanTitle(t: string): string {
  return t.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

async function getJson(
  url: string,
  apiKey: string,
  fetchFn: FetchFn
): Promise<{ status: number; data: unknown; parseOk: boolean }> {
  const res = await fetchFn(url, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  let data: unknown = null;
  let parseOk = true;
  try {
    data = await res.json();
  } catch {
    parseOk = false; // bot-wall HTML / empty body with HTTP 200
  }
  return { status: res.status, data, parseOk };
}

/**
 * Search Etsy's active listings for a query, ranked by num_favorers.
 * Enriches the top 5 with shop total sales + review count/rating.
 */
export async function searchEtsyListings(
  query: string,
  apiKey: string | undefined,
  opts?: { fetchFn?: FetchFn; limit?: number }
): Promise<EtsySearchResult> {
  if (!apiKey) return { listings: [], warnings: ["etsy_skipped_no_key: ETSY_API_KEY nahi hai — Etsy analysis ke bina chal raha hai (free key: developers.etsy.com)"] };
  const fetchFn = opts?.fetchFn ?? fetch;
  const limit = Math.min(25, Math.max(1, opts?.limit ?? 10));
  try {
    const { status, data, parseOk } = await getJson(
      `${BASE}/listings/active?keywords=${encodeURIComponent(query)}&limit=${limit}&sort_on=score&sort_order=desc`,
      apiKey,
      fetchFn
    );
    if (status === 401 || status === 403) {
      return { listings: [], warnings: ["etsy_auth_failed: key galat ya approve nahi — developers.etsy.com par app/key check karo"] };
    }
    if (status === 429) {
      return { listings: [], warnings: ["etsy_rate_limited: Etsy ne rok diya — is run mein Etsy skip, agle run mein phir try hoga"] };
    }
    if (status !== 200) {
      return { listings: [], warnings: [`etsy_search_failed: HTTP ${status}`] };
    }
    if (!parseOk) {
      return { listings: [], warnings: ["etsy_bad_response: Etsy se JSON nahi aaya (bot-wall ya proxy) — is run mein Etsy skip"] };
    }
    const results = (data as { results?: Array<Record<string, unknown>> }).results ?? [];
    const parsed: EtsyListing[] = results
      .map((r) => {
        const price = r.price as { amount?: number; divisor?: number; currency_code?: string } | undefined;
        return {
          listingId: Number(r.listing_id ?? 0),
          title: cleanTitle(String(r.title ?? "")),
          url: String(r.url ?? ""),
          price: price?.amount != null && price?.divisor ? price.amount / price.divisor : null,
          currency: price?.currency_code ?? "USD",
          favorers: Number(r.num_favorers ?? 0),
          tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
          shopId: Number(r.shop_id ?? 0),
        };
      })
      .filter((l) => l.listingId > 0 && l.title)
      .sort((a, b) => b.favorers - a.favorers)
      .slice(0, 5);
    if (!parsed.length) return { listings: [], warnings: [] };

    // Enrich top 5: shop total sales + review count/rating (best effort).
    const shopIds = [...new Set(parsed.map((l) => l.shopId).filter((id) => id > 0))];
    const shopSales = new Map<number, number>();
    for (const shopId of shopIds) {
      try {
        const { status: s, data: d } = await getJson(`${BASE}/shops/${shopId}`, apiKey, fetchFn);
        if (s === 200) {
          const n = Number((d as { transaction_sold_count?: number }).transaction_sold_count ?? NaN);
          if (Number.isFinite(n)) shopSales.set(shopId, n);
        }
      } catch {
        /* skip */
      }
    }
    for (const l of parsed) {
      l.shopSales = shopSales.get(l.shopId);
      try {
        const { status: s, data: d } = await getJson(
          `${BASE}/listings/${l.listingId}/reviews?limit=1`,
          apiKey,
          fetchFn
        );
        if (s === 200) {
          l.reviewCount = Number((d as { count?: number }).count ?? 0);
          const results2 = (d as { results?: Array<{ rating?: number }> }).results ?? [];
          l.reviewAvg = results2.length ? results2[0].rating ?? null : null;
        }
      } catch {
        /* skip */
      }
    }
    return { listings: parsed, warnings: [] };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { listings: [], warnings: ["etsy_timeout: Etsy ne 20s mein jawab nahi diya — is run mein Etsy skip"] };
    }
    return { listings: [], warnings: ["etsy_search_failed: network ya parse error — is run mein Etsy skip"] };
  }
}

/** Evidence line for one listing (used by the bestseller analyzer). */
export function etsyEvidenceLine(l: EtsyListing): string {
  const parts = [`Etsy: ${l.title}`, `${l.favorers} favorites`];
  if (l.reviewCount != null) parts.push(`${l.reviewCount} reviews${l.reviewAvg != null ? ` (${l.reviewAvg}★)` : ""}`);
  if (l.shopSales != null) parts.push(`shop ${l.shopSales} sales`);
  if (l.url) parts.push(l.url);
  return parts.join(" — ");
}
