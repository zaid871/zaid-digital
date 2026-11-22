/**
 * Storyboard chain (Raj Photo Editing, 2026-11-10 analysis,
 * docs/aminul-raj-styles.md): generate 5 ad concepts first, pick the
 * best, then build the script + 9-scene storyboard on the winner —
 * instead of committing to the first idea the model produces.
 *
 * One LLM call returns 5 concepts + a ranked best pick. Compliance
 * drop-doctrine (src/lib/compliance.ts): a concept that trips the price
 * or banned-claim scan is DROPPED with a warning, never replaced with
 * fallback copy. If the ranked best is dropped, the best surviving
 * concept wins. If every concept is dropped, this throws — a chain
 * with no clean concept must fail honestly, never invent one.
 *
 * Worker-side module: text generation goes through the digital
 * module's direct failover (groq → gemini → pollinations → hf) with
 * an injectable textGen for tests — never through providers/fallback.ts
 * (Turbopack lesson, AGENTS.md).
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { defaultTextGen as ebookTextGen } from "../digital/ebook";

/** One ad concept: a distinct angle for the same product. */
export interface AdConcept {
  /** Short name for the idea, e.g. "Subah ki taazgi". */
  title: string;
  /** The opening hook line the video starts with. */
  hook: string;
  /** What makes this angle different, in one or two lines. */
  angle: string;
}

export interface ConceptChainInput {
  productName: string;
  brand?: string | null;
  category?: string | null;
  verifiedFeatures: string[];
  audience?: string | null;
}

export interface ConceptChainResult {
  /** Surviving concepts, in the model's original ranked order. */
  concepts: AdConcept[];
  /** The winning concept — best surviving rank. */
  best: AdConcept;
  /** Why it won (the model's reason when it survived, else a note). */
  bestReason: string;
  warnings: string[];
  /** How many of the 5 generated concepts were dropped by compliance. */
  droppedCount: number;
}

export type ConceptTextGen = (prompt: string, maxTokens: number) => Promise<string>;

const RawConceptsSchema = z.object({
  concepts: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        hook: z.string().min(1).max(120),
        angle: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(5),
  bestIndex: z.number().int().min(0).max(4),
  bestReason: z.string().min(1).max(200),
});

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in ad-concept output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function violates(text: string): boolean {
  return PRICE_PATTERN.test(text) || BANNED_CLAIM_PATTERN.test(text);
}

function buildConceptsPrompt(input: ConceptChainInput): string {
  const feats =
    input.verifiedFeatures.length > 0
      ? input.verifiedFeatures.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "(no verified features supplied — keep the ideas generic to the product type)";
  return [
    "You are a Hinglish advertising strategist for an Indian audience.",
    "Generate 5 DISTINCT ad concepts for the product below — different angles, different hooks, different moods.",
    "Then rank them and pick the single best one for a short vertical product video.",
    "",
    `Product: ${input.productName}`,
    `Brand: ${input.brand ?? "not specified"}`,
    `Category: ${input.category ?? "not specified"}`,
    `Audience: ${input.audience ?? "Indian online shoppers watching Instagram Reels / YouTube Shorts"}`,
    "Verified features (use ONLY these — never invent anything else):",
    feats,
    "",
    "STRICT RULES:",
    "- Each concept: title (max 10 words), hook (one bold opening line, max 20 words), angle (one or two lines on what makes it different).",
    "- NEVER mention any price, discount, offer, or deal in any field.",
    "- NEVER invent reviews, testimonials, ratings, certifications, or guarantees.",
    "- NEVER make health, financial, safety, or comparative claims.",
    "- The 5 concepts must be genuinely different from each other — not the same idea reworded.",
    "- bestIndex is the 0-based index of the best concept; bestReason is one line on why it wins (strongest hook + best fit to the verified features).",
    "",
    "OUTPUT — valid JSON ONLY, no markdown fences, exactly this shape:",
    '{"concepts":[{"title":"...","hook":"...","angle":"..."}],"bestIndex":0,"bestReason":"..."}',
  ].join("\n");
}

/**
 * Generate 5 ad concepts and pick the best. Throws on unparseable
 * output, on all concepts failing compliance, or on provider failure.
 */
export async function generateAdConcepts(
  input: ConceptChainInput,
  textGen: ConceptTextGen = ebookTextGen
): Promise<ConceptChainResult> {
  const prompt = buildConceptsPrompt(input);
  const raw = await textGen(prompt, 1024);
  let parsed: unknown;
  try {
    parsed = RawConceptsSchema.parse(extractJsonObject(raw));
  } catch (err) {
    throw new Error(
      `Ad-concept output could not be structured: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`
    );
  }
  const { concepts, bestIndex, bestReason } = parsed as z.infer<typeof RawConceptsSchema>;

  // Compliance drop-doctrine: a violating concept is dropped with a
  // warning, never replaced with fallback copy.
  const warnings: string[] = [];
  const survivors: AdConcept[] = [];
  concepts.forEach((c, i) => {
    const joined = `${c.title} ${c.hook} ${c.angle}`;
    if (violates(joined)) {
      warnings.push(`Concept ${i + 1} ("${c.title}") dropped: price/claim pattern matched.`);
    } else {
      survivors.push(c);
    }
  });
  if (survivors.length === 0) {
    throw new Error(
      "All 5 ad concepts failed the compliance scan (price or banned-claim pattern) — chain stopped, no concept invented."
    );
  }
  // bestIndex is a rank over the ORIGINAL list; the best survivor is
  // the first survivor at or after that rank, else the first survivor.
  const rankedBest = concepts[bestIndex];
  const bestSurvived = !!rankedBest && survivors.includes(rankedBest);
  const best = bestSurvived
    ? rankedBest
    : (survivors.find((c) => concepts.indexOf(c) >= bestIndex) ?? survivors[0]);
  return {
    concepts: survivors,
    best,
    bestReason: bestSurvived
      ? bestReason
      : "Top surviving concept after compliance drops or an out-of-range pick (the ranked best did not survive).",
    warnings,
    droppedCount: concepts.length - survivors.length,
  };
}
