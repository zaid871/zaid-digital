/**
 * Platform caption/copy pack (AdCraftAI pattern, adapted to our rules).
 *
 * One AI call turns verified product facts into the copy a publish needs:
 * an Instagram caption, a Facebook post, 3 headline angles, an SEO
 * description + keywords, and hashtags. It feeds the IG/FB publishing
 * captions and the website catalogue's SEO fields.
 *
 * Compliance is enforced, not requested: every string field is scanned
 * with PRICE_PATTERN + BANNED_CLAIM_PATTERN from lib/compliance, and a
 * violating field is DROPPED (null / removed from its list) with a
 * warning. AdCraftAI's approach of silent per-field fallback copy is
 * deliberately NOT copied — a generic marketing fallback ("#1 Choice",
 * "Something incredible just dropped") would be fabricated content.
 * Unparseable model output is a hard error, never a quiet fallback.
 *
 * Worker-side module (uses attemptWithFallback like script.ts); do not
 * import it from a Next.js App Route.
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { attemptWithFallback } from "@/lib/providers/fallback";
import * as gemini from "@/lib/providers/gemini";
import * as groq from "@/lib/providers/groq";
import * as hfInference from "@/lib/providers/hf-inference";
import * as pollinations from "@/lib/providers/pollinations";

export interface CaptionPackInput {
  productName: string;
  features?: string[];
  productCategory?: string | null;
  tone?: "friendly" | "premium" | "informative";
  /**
   * Auto-DM CTA line (from the script's dmCta). When present, the
   * Instagram caption MUST end with this line so every post drives
   * comment-to-DM. Compliance-scanned like every other field.
   */
  dmCtaLine?: string | null;
}

export interface CaptionPack {
  instagram: string | null;
  facebook: string | null;
  headlines: string[];
  seoDescription: string | null;
  seoKeywords: string[];
  hashtags: string[];
  warnings: string[];
}

export type CaptionTextGen = (prompt: string, maxTokens: number) => Promise<string>;

const defaultTextGen: CaptionTextGen = async (prompt, maxTokens) => {
  const res = await attemptWithFallback("script", (provider) => {
    switch (provider.key) {
      case "hf":
        return hfInference.generateText({ prompt, params: { max_new_tokens: maxTokens, temperature: 0.7 } });
      case "groq":
        return groq.generateText({ prompt, maxTokens, temperature: 0.7 });
      case "gemini":
        return gemini.generateText({ prompt, maxTokens, temperature: 0.7 });
      default:
        return pollinations.generateText({ prompt, maxTokens, temperature: 0.7 });
    }
  });
  if (!res.ok || typeof res.data !== "string") {
    throw new Error(`Caption pack provider failed after trying: ${res.attempted.join(", ") || "none"}.`);
  }
  return res.data;
};

const RawPackSchema = z.object({
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  headlines: z.array(z.string()).optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
});

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in caption pack output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function violates(text: string): boolean {
  return PRICE_PATTERN.test(text) || BANNED_CLAIM_PATTERN.test(text);
}

/**
 * Guarantee the auto-DM CTA line closes the Instagram caption: if the
 * model ignored the prompt rule, append the (compliance-scanned) line
 * ourselves. A violating line is dropped with a warning, never forced in.
 */
function ensureDmCta(
  caption: string | null,
  dmCtaLine: string | null | undefined,
  warnings: string[]
): string | null {
  const line = dmCtaLine?.trim();
  if (!line) return caption;
  if (violates(line)) {
    warnings.push("dmCtaLine dropped: price/claim pattern matched.");
    return caption;
  }
  if (!caption) return line;
  if (caption.includes(line)) return caption;
  return `${caption}\n\n${line}`;
}

/**
 * Generate the pack. Throws on unparseable output; drops (never
 * replaces) any field that trips the compliance scan.
 */
export async function generateCaptionPack(
  input: CaptionPackInput,
  textGen: CaptionTextGen = defaultTextGen
): Promise<CaptionPack> {
  const features = (input.features ?? []).filter(Boolean).slice(0, 8);
  const prompt = [
    "You write short ad copy for a product video. Language: Hinglish (Romanized Hindi-English mix for an Indian audience).",
    `Product: ${input.productName}`,
    input.productCategory ? `Category: ${input.productCategory}` : "",
    features.length > 0 ? `Verified features (use ONLY these, never invent others): ${features.join("; ")}` : "No verified features supplied — keep copy generic about the product type, never invent specs.",
    `Tone: ${input.tone ?? "friendly"}.`,
    "",
    "HARD RULES (violating text will be discarded, so do not write it):",
    "- No prices, discounts, offers, deals, percentages off, or currency amounts.",
    "- No guarantees, warranties, rankings (#1, best seller), fake reviews/ratings/testimonials,",
    "  'limited time', 'buy now', 'act now', or earnings claims.",
    "- No superlatives that rank the product above others.",
    input.dmCtaLine?.trim()
      ? `AUTO-DM CTA (MANDATORY for the instagram caption): end the instagram caption with this exact line on its own: "${input.dmCtaLine.trim().slice(0, 160)}"`
      : "",
    "",
    "Reply with ONLY a JSON object, no other text:",
    "{",
    '  "instagram": "2-3 sentence caption, max 5 emojis, micro-CTA like \'link in bio\' (never \'buy now\')",',
    '  "facebook": "short paragraph post, conversational",',
    '  "headlines": ["benefit-driven angle", "curiosity-driven angle", "quality-driven angle (no superlatives)"] (exactly 3, max 10 words each),',
    '  "seoDescription": "1-2 sentence search-friendly description",',
    '  "seoKeywords": ["5-10 short phrases"],',
    '  "hashtags": ["5-10 hashtags, with # prefix"]',
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await textGen(prompt, 1200);
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    throw new Error("Caption pack output was not valid JSON — no fallback copy was substituted.");
  }
  const checked = RawPackSchema.safeParse(parsed);
  if (!checked.success) {
    throw new Error("Caption pack output did not match the expected shape — no fallback copy was substituted.");
  }
  const data = checked.data;
  const warnings: string[] = [];

  const cleanField = (field: string, value: string | undefined): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    if (violates(value)) {
      warnings.push(`${field} dropped: price/claim pattern matched.`);
      return null;
    }
    return value.trim();
  };
  const cleanList = (field: string, values: string[] | undefined, max: number): string[] => {
    const kept: string[] = [];
    for (const v of values ?? []) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (violates(v)) {
        warnings.push(`${field} item dropped: price/claim pattern matched.`);
        continue;
      }
      kept.push(v.trim());
      if (kept.length >= max) break;
    }
    return kept;
  };

  return {
    instagram: ensureDmCta(cleanField("instagram", data.instagram), input.dmCtaLine, warnings),
    facebook: cleanField("facebook", data.facebook),
    headlines: cleanList("headlines", data.headlines, 3),
    seoDescription: cleanField("seoDescription", data.seoDescription),
    seoKeywords: cleanList("seoKeywords", data.seoKeywords, 10),
    hashtags: cleanList("hashtags", data.hashtags, 10),
    warnings,
  };
}
