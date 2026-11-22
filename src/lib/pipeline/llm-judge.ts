/**
 * LLM-as-judge eval gate (chat-ads-eval item, adapted to our rules).
 *
 * Runs ONLY on jobs QA already parked as NEEDS_REVIEW, and only as a
 * second opinion attached to the review — it NEVER changes the outcome:
 *  - "confirm_flag": the QA flag looks right; the judge adds a readable
 *    rationale + a suggested fix for the human reviewer.
 *  - "escalate_reject": the judge found a clear violation (e.g. a hidden
 *    claim or offer) — the note is stronger, but the job still waits for
 *    a human; the judge cannot fail or approve a job on its own.
 *  - "unavailable": provider/parse failure — the original QA verdict
 *    stands unchanged, no silent downgrade.
 *
 * This honours the compliance doctrine: AI review can only escalate
 * scrutiny, never approve. One short call per flagged job, and only when
 * QA_LLM_JUDGE is not "off".
 */
import { attemptWithFallback } from "@/lib/providers/fallback";
import * as gemini from "@/lib/providers/gemini";
import * as groq from "@/lib/providers/groq";
import * as hfInference from "@/lib/providers/hf-inference";
import * as pollinations from "@/lib/providers/pollinations";

export type JudgeOpinion = "confirm_flag" | "escalate_reject" | "unavailable";

export interface JudgeInput {
  failedChecks: { name: string; detail: string }[];
  narrations: string[];
  productCategory: string | null;
}

export interface JudgeResult {
  opinion: JudgeOpinion;
  rationale: string;
  suggestedFix: string | null;
}

export type JudgeTextGen = (prompt: string, maxTokens: number) => Promise<string>;

const defaultTextGen: JudgeTextGen = async (prompt, maxTokens) => {
  const res = await attemptWithFallback("script", (provider) => {
    switch (provider.key) {
      case "hf":
        return hfInference.generateText({ prompt, params: { max_new_tokens: maxTokens, temperature: 0.3 } });
      case "groq":
        return groq.generateText({ prompt, maxTokens, temperature: 0.3 });
      case "gemini":
        return gemini.generateText({ prompt, maxTokens, temperature: 0.3 });
      default:
        return pollinations.generateText({ prompt, maxTokens, temperature: 0.3 });
    }
  });
  if (!res.ok || typeof res.data !== "string") {
    throw new Error(`Judge provider failed after trying: ${res.attempted.join(", ") || "none"}.`);
  }
  return res.data;
};

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in judge output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Second-opinion review of a NEEDS_REVIEW job. Never returns "approve":
 * the type system itself forbids it.
 */
export async function judgeNeedsReview(
  input: JudgeInput,
  textGen: JudgeTextGen = defaultTextGen
): Promise<JudgeResult> {
  const checks = input.failedChecks.map((c) => `- ${c.name}: ${c.detail}`).join("\n") || "(no failed checks listed)";
  const narration = input.narrations.join("\n") || "(no narration available)";
  const prompt = [
    "You are a strict advertising-compliance reviewer for short product videos.",
    "A video job was ALREADY flagged NEEDS_REVIEW by deterministic checks. Give a second opinion.",
    "",
    "RULES: No music, no prices, no discounts, no offers, no invented reviews/testimonials/ratings/guarantees,",
    "no unsupported health/financial/safety/comparative claims. You may NOT approve this job.",
    "",
    "Flagged checks:",
    checks,
    "",
    "Narration:",
    narration,
    "",
    input.productCategory ? `Product category: ${input.productCategory}` : "",
    "Reply with ONLY a JSON object, no other text:",
    '{"opinion":"confirm_flag"|"escalate_reject","rationale":"at most 3 sentences, plain words","suggestedFix":"one concrete fix for the human reviewer, or null"}',
    "Use escalate_reject ONLY when you find a clear rule violation in the narration itself;",
    "otherwise confirm_flag.",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const raw = await textGen(prompt, 600);
    const parsed = extractJsonObject(raw) as Partial<JudgeResult>;
    if (parsed.opinion !== "confirm_flag" && parsed.opinion !== "escalate_reject") {
      return {
        opinion: "unavailable",
        rationale: "Judge output did not contain a valid opinion.",
        suggestedFix: null,
      };
    }
    return {
      opinion: parsed.opinion,
      rationale:
        typeof parsed.rationale === "string" && parsed.rationale.trim()
          ? parsed.rationale.trim().slice(0, 600)
          : "No rationale supplied.",
      suggestedFix:
        typeof parsed.suggestedFix === "string" && parsed.suggestedFix.trim()
          ? parsed.suggestedFix.trim().slice(0, 300)
          : null,
    };
  } catch (err) {
    return {
      opinion: "unavailable",
      rationale: `Judge unavailable: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      suggestedFix: null,
    };
  }
}
