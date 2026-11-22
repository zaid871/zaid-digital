/**
 * Etsy listing optimizer (7-point plan #5).
 *
 * Competitor-verified Etsy SEO: 13 tags (long-tail, ≤20 chars each),
 * front-loaded titles (≤140 chars, keywords first), conversion-focused
 * descriptions. Bundles convert better than singles — flags bundle
 * opportunity when features allow.
 *
 * Module + tests (+ endpoint). Upload to Etsy stays manual/API at deploy.
 * Worker-side (direct text failover). Compliance-scanned; violating fields
 * dropped with warnings, never replaced.
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "../digital/ebook";

export type EtsyTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface EtsyInput {
  title: string;
  niche: string;
  features?: string[];
  description?: string;
}

export interface EtsyListing {
  title: string | null;
  tags: string[];
  description: string | null;
  bundleSuggestion: string | null;
  warnings: string[];
}

const etsySchema = z.object({
  title: z.string().max(140),
  tags: z.array(z.string().max(20)).max(13),
  description: z.string().max(2000),
  bundleSuggestion: z.string().max(200),
});

function clean(text: string): boolean {
  return !PRICE_PATTERN.test(text) && !BANNED_CLAIM_PATTERN.test(text);
}

export async function optimizeEtsyListing(
  input: EtsyInput,
  textGen: EtsyTextGen = ebookTextGen
): Promise<EtsyListing> {
  const warnings: string[] = [];
  const features = (input.features ?? []).filter(Boolean).slice(0, 8);
  const prompt = `You are an Etsy SEO expert. Optimize this listing in English (Etsy buyers search in English; keep it clean and honest).
Current title: ${input.title}
Niche: ${input.niche}
Verified features (only these, never invent): ${features.join(" | ") || "none — keep general"}
RULES:
- title: ≤140 chars, LONG-TAIL KEYWORDS FIRST (what buyers type), no keyword stuffing.
- tags: exactly 13, each ≤20 chars, long-tail phrases buyers search.
- description: first 2 lines = outcome/benefit (what shows in search), then features, then what's included. Honest, no hype.
- bundleSuggestion: one bundle idea (e.g. "pack of 3", "ebook + templates combo") or empty string if none fits.
- NO prices, NO discounts, NO fake urgency, NO "#1"/"best seller" claims, NO fake reviews.
Return ONLY valid JSON, no markdown fences: {"title":"...","tags":["..."],"description":"...","bundleSuggestion":"..."}`;

  let raw: string;
  try {
    raw = await textGen(prompt, 1200);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `Etsy optimization failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "Etsy model returned unparseable output.");
  }
  let parsed: z.infer<typeof etsySchema>;
  try {
    parsed = etsySchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "Etsy model returned invalid JSON shape.");
  }

  const tags: string[] = [];
  for (const t of parsed.tags.slice(0, 13)) {
    if (!clean(t)) { warnings.push(`tag "${t}" dropped: price/claim pattern matched.`); continue; }
    tags.push(t);
  }
  let title: string | null = parsed.title;
  if (!clean(title)) { warnings.push("title dropped: price/claim pattern matched."); title = null; }
  let description: string | null = parsed.description;
  if (!clean(description)) { warnings.push("description dropped: price/claim pattern matched."); description = null; }
  const bundleSuggestion = parsed.bundleSuggestion.trim() && clean(parsed.bundleSuggestion)
    ? parsed.bundleSuggestion.trim()
    : null;
  if (parsed.bundleSuggestion.trim() && !bundleSuggestion) {
    warnings.push("bundleSuggestion dropped: price/claim pattern matched.");
  }
  return { title, tags, description, bundleSuggestion, warnings };
}
