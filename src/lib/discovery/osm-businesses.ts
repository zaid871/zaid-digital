/**
 * OpenStreetMap business discovery (free, legal, no key).
 *
 * This is the "discover" leg of the customer-finder pipeline, using the
 * source sellbird defaults to: OpenStreetMap via the public Overpass API.
 * It replaces the Google Maps scraper for discovery — no Google scraping,
 * no proxy, no paid source — at the cost of thinner coverage: OSM maps
 * premises, so whole trades are barely present (sellbird's own warning:
 * under 2,000 roofers and under 2,300 plumbers in the entire US). The
 * function reports that honestly instead of quietly under-delivering:
 * it returns the count it found, and the caller decides whether that is
 * enough for the niche.
 *
 * Overpass usage policy: one query at a time, keep it small (default 50),
 * identify the client. Never throws on HTTP/API failure — returns
 * `{ leads: [], error }` so the caller can show the gap, never a fake list.
 */

import type { BusinessLead } from "@/lib/marketing/customer-finder";

export type FetchFn = typeof fetch;

export interface OsmSearchInput {
  /** Business kind, e.g. "dentist", "roofer", "restaurant", "gym". */
  category: string;
  /** [south, west, north, east] in degrees. */
  bbox: [number, number, number, number];
  maxResults?: number;
}

export interface OsmSearchResult {
  leads: BusinessLead[];
  /** Non-empty when the lookup failed or returned nothing usable. */
  error?: string;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** OSM tag sets per business kind. Unknown kinds fall back to a name search. */
const CATEGORY_TAGS: Record<string, string[]> = {
  dentist: ['amenity="dentist"', 'healthcare="dentist"'],
  doctor: ['amenity="doctors"', 'amenity="clinic"', 'healthcare="doctor"'],
  clinic: ['amenity="clinic"', 'healthcare="clinic"'],
  pharmacy: ['amenity="pharmacy"'],
  restaurant: ['amenity="restaurant"', 'amenity="fast_food"', 'amenity="cafe"'],
  cafe: ['amenity="cafe"'],
  gym: ['leisure="fitness_centre"'],
  salon: ['shop="hairdresser"', 'shop="beauty"'],
  roofer: ['craft="roofer"'],
  plumber: ['craft="plumber"'],
  electrician: ['craft="electrician"'],
  hotel: ['tourism="hotel"', 'tourism="guest_house"'],
  school: ['amenity="school"'],
  bank: ['amenity="bank"'],
};

function buildOverpassQuery(input: OsmSearchInput): string {
  const [s, w, n, e] = input.bbox;
  const bbox = `${s},${w},${n},${e}`;
  const limit = Math.max(1, Math.min(200, input.maxResults ?? 50));
  const tags = CATEGORY_TAGS[input.category.toLowerCase()];
  const clauses = tags
    ? tags.map((t) => `  nwr[${t}](${bbox});`)
    : [`  nwr["name"~"${input.category.replace(/"/g, "")}",i](${bbox});`];
  return `[out:json][timeout:25];(\n${clauses.join("\n")}\n);out body ${limit};`;
}

function addressFromTags(tags: Record<string, string>): string {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return parts.join(", ");
}

function osmElementToLead(el: {
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  id?: number;
  type?: string;
}): BusinessLead | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat ?? 0;
  const lon = el.lon ?? el.center?.lon ?? 0;
  const categories = [
    tags.amenity,
    tags.shop,
    tags.craft,
    tags.healthcare,
    tags.leisure,
    tags.tourism,
  ].filter((c): c is string => Boolean(c));
  return {
    title: name,
    categories,
    category: categories[0] ?? "",
    address: addressFromTags(tags),
    website: tags.website ?? tags["contact:website"] ?? "",
    phone: tags.phone ?? tags["contact:phone"] ?? "",
    reviewCount: 0,
    reviewRating: 0,
    latitude: lat,
    longitude: lon,
    plusCode: "",
    status: "",
    timezone: "",
    priceRange: "",
    dataId: el.type && el.id !== undefined ? `${el.type}/${el.id}` : "",
    link: "",
    source: "osm",
  };
}

export async function searchOsmBusinesses(
  input: OsmSearchInput,
  fetchFn: FetchFn = fetch,
): Promise<OsmSearchResult> {
  const query = buildOverpassQuery(input);
  let res: Response;
  try {
    res = await fetchFn(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { leads: [], error: `Overpass request failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
  if (!res.ok) return { leads: [], error: `Overpass HTTP ${res.status}` };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { leads: [], error: "Overpass returned invalid JSON" };
  }
  const elements = (data as { elements?: unknown[] })?.elements;
  if (!Array.isArray(elements)) return { leads: [], error: "Overpass returned no elements" };
  const leads = elements
    .map((el) => osmElementToLead(el as Parameters<typeof osmElementToLead>[0]))
    .filter((l): l is BusinessLead => l !== null);
  if (leads.length === 0) {
    return { leads: [], error: "No named businesses found in this area — OSM coverage here is thin; try a bigger area or a different kind." };
  }
  return { leads };
}
