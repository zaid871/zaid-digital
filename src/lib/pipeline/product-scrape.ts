/**
 * Live product-page scraping (AdGen item 1, adapted to our rules).
 *
 * Given a public product URL, fetch the page and extract structured facts
 * the video pipeline can use: title, description, images, features, brand.
 * Deliberately NOT a price scraper: the output type has no price field,
 * and any price-like text found in titles/descriptions is stripped at
 * extraction — prices must never reach scripts, captions, or video.
 *
 * Safety: same SSRF posture as the job schema — http(s) only, loopback /
 * private / link-local / cloud-metadata hosts are rejected before any
 * fetch. Pages are capped at 2 MB of HTML; the parser is regex-based
 * (no DOM dependency) and only reads OpenGraph tags, <title>, meta
 * description, JSON-LD Product blocks, and <img> sources.
 */
import { PipelineError } from "./types";

export interface ScrapedProductFacts {
  title: string;
  description: string;
  images: string[];
  features: string[];
  brand: string | null;
  sourceUrl: string;
  warnings: string[];
}

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
];

/** Reject non-public URLs before any network access. Throws PipelineError. */
export function assertPublicUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new PipelineError("validation_failed", "product_research", "Product URL is not a valid URL.", false);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new PipelineError("validation_failed", "product_research", "Product URL must be http(s).", false);
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || PRIVATE_PATTERNS.some((p) => p.test(host))) {
    throw new PipelineError(
      "validation_failed",
      "product_research",
      "Product URL points to a blocked host (private/internal addresses are not allowed).",
      false
    );
  }
  return u;
}

/** Remove price/offer mentions from scraped text (never let prices through). */
export function stripPriceMentions(text: string): string {
  return text
    .replace(/(₹|rs\.?|inr|\$)\s?[\d,]+(\.\d{1,2})?/gi, "")
    .replace(/\b\d+\s?%\s?off\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function metaContent(html: string, attr: string, value: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${attr}:${value}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${attr}:${value}["']`,
    "i"
  );
  const m = html.match(re);
  return (m?.[1] ?? m?.[2] ?? null)?.trim() || null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1].trim() || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

interface JsonLdProduct {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  brand?: unknown;
  additionalProperty?: unknown;
}

function jsonLdProducts(html: string): JsonLdProduct[] {
  const out: JsonLdProduct[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const o = item as Record<string, unknown>;
        if (!o || typeof o !== "object") continue;
        const types = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]];
        if (types.includes("Product")) out.push(o as JsonLdProduct);
        const graph = o["@graph"];
        if (Array.isArray(graph)) {
          for (const g of graph) {
            const go = g as Record<string, unknown>;
            if (go && (go["@type"] === "Product" || (Array.isArray(go["@type"]) && go["@type"].includes("Product")))) {
              out.push(go as JsonLdProduct);
            }
          }
        }
      }
    } catch {
      // Malformed JSON-LD is common; skip it, never crash on it.
    }
  }
  return out;
}

function asStringList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function asBrand(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string") {
    return (v as { name: string }).name;
  }
  return null;
}

function resolveImages(html: string, base: URL): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const src = raw.trim();
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
    if (/pixel|tracker|1x1|beacon/i.test(src)) return;
    try {
      const abs = new URL(src, base).toString();
      if (!seen.has(abs) && out.length < 10) {
        seen.add(abs);
        out.push(abs);
      }
    } catch {
      // ignore unresolvable src
    }
  };
  push(metaContent(html, "og", "image"));
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) push(m[1]);
  return out;
}

function listFeatures(html: string): string[] {
  const re = /<ul[^>]*>([\s\S]*?)<\/ul>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const items = [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((x) => decodeEntities(x[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter((x) => x.length >= 3 && x.length <= 200);
    if (items.length >= 3) return items.slice(0, 8);
  }
  return [];
}

/** Pure parser: HTML + base URL -> facts. No network, fully testable. */
export function extractProductFacts(html: string, baseUrl: string): ScrapedProductFacts {
  const base = new URL(baseUrl);
  const warnings: string[] = [];
  const ld = jsonLdProducts(html);
  const first = ld[0];

  const titleRaw =
    (first && typeof first.name === "string" && first.name) ||
    metaContent(html, "og", "title") ||
    titleTag(html) ||
    "";
  const descRaw =
    (first && typeof first.description === "string" && first.description) ||
    metaContent(html, "og", "description") ||
    (() => {
      const mm = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i);
      return mm?.[1] ?? "";
    })();

  const title = stripPriceMentions(decodeEntities(titleRaw).replace(/\s+/g, " ").trim());
  const description = stripPriceMentions(decodeEntities(descRaw).replace(/\s+/g, " ").trim());

  let images: string[] = [];
  if (first) {
    for (const img of asStringList(first.image)) {
      try {
        images.push(new URL(img, base).toString());
      } catch {
        // skip
      }
    }
  }
  for (const img of resolveImages(html, base)) {
    if (!images.includes(img)) images.push(img);
  }
  images = images.slice(0, 10);

  let features: string[] = [];
  if (first?.additionalProperty) {
    const props = Array.isArray(first.additionalProperty) ? first.additionalProperty : [first.additionalProperty];
    features = props
      .map((p) => {
        const o = p as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name : "";
        const value = typeof o.value === "string" ? o.value : "";
        return name && value ? `${name}: ${value}` : value || name;
      })
      .filter(Boolean)
      .slice(0, 8);
  }
  if (features.length === 0) features = listFeatures(html);
  features = features.map((f) => stripPriceMentions(f)).filter(Boolean);

  if (!title) warnings.push("no title found on page");
  if (images.length === 0) warnings.push("no product images found on page");

  return {
    title,
    description,
    images,
    features,
    brand: first ? asBrand(first.brand) : null,
    sourceUrl: base.toString(),
    warnings,
  };
}

export type FetchFn = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** Fetch a public product page (15s timeout, 2 MB cap) and extract facts. */
export async function scrapeProductPage(
  rawUrl: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn
): Promise<ScrapedProductFacts> {
  const url = assertPublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ProductVideoBot/1.0; +https://example.com)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-IN,en;q=0.9",
      },
    });
    if (!res.ok) {
      throw new PipelineError(
        "provider_unavailable",
        "product_research",
        `Product page returned HTTP ${res.status}.`,
        res.status >= 500
      );
    }
    const text = await res.text();
    return extractProductFacts(text.slice(0, 2_000_000), url.toString());
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    throw new PipelineError(
      "provider_unavailable",
      "product_research",
      `Could not fetch product page: ${err instanceof Error ? err.message : String(err)}`,
      false
    );
  } finally {
    clearTimeout(timer);
  }
}
