/**
 * Buyer-psychology copy patterns (ethical edition).
 *
 * Source: Ayan Aarfi's psychological marketing (2026-11-12 analysis,
 * memory/people/ayan-aarfi.md) — buyer-psychology landing pages, DFY
 * psychological copywriting swipe file, nurture funnels. His techniques
 * are kept; his deceptions are NOT: earnings claims, fake urgency
 * ("price increases after midnight"), invented testimonials and fake
 * scarcity are banned here and scanned out below.
 *
 * Doctrine: psychology serves CLARITY and TRUST, never pressure.
 * Every pattern below works only on verified facts. A pattern that
 * needs an invented number, a fake deadline, or a fake crowd is not a
 * pattern — it is a lie, and the scanner drops it.
 *
 * Used by: sales-copy generator (new trustLine / objectionAnswers /
 * riskNote fields) and the video script prompt (all styles).
 */

export interface BuyerPsychologyPattern {
  id: string;
  name: string;
  /** What the pattern does, in one line. */
  what: string;
  /** Instruction line injected into generation prompts. */
  promptGuidance: string;
  appliesTo: ("sales_copy" | "script")[];
}

export const BUYER_PSYCHOLOGY_PATTERNS: BuyerPsychologyPattern[] = [
  {
    id: "value_first",
    name: "Value first",
    what: "Outcome/transformation before features — pehle fayda, phir feature.",
    promptGuidance:
      "Lead with the OUTCOME the buyer gets, then the feature that delivers it. Never open with a spec list.",
    appliesTo: ["sales_copy", "script"],
  },
  {
    id: "trust_verified_only",
    name: "Trust from verified facts only",
    what: "Trust comes from verifiable facts and honest process, never invented proof.",
    promptGuidance:
      "Build trust ONLY from the verified features above: what it does, what is inside, how it works. Never invent testimonials, ratings, buyer counts, or endorsements.",
    appliesTo: ["sales_copy", "script"],
  },
  {
    id: "objection_handling",
    name: "Objection handling",
    what: "Answer the buyer's likeliest doubt plainly, before they have to ask.",
    promptGuidance:
      "Answer ONE likeliest buyer doubt honestly and plainly (e.g. beginner ke liye hai? kaise use karenge? andar kya hai?). Never dodge with hype.",
    appliesTo: ["sales_copy", "script"],
  },
  {
    id: "risk_reversal_honest",
    name: "Honest risk reversal",
    what: "Lower perceived risk by being clear — never by guaranteeing outcomes.",
    promptGuidance:
      "Reduce risk honestly: say clearly what is included and what the product does NOT do. No 'guaranteed results', no '100% success', no promises about earnings or outcomes.",
    appliesTo: ["sales_copy", "script"],
  },
  {
    id: "clarity_10_seconds",
    name: "10-second clarity",
    what: "In 10 seconds the buyer must know: what it is, who it is for, what problem it solves.",
    promptGuidance:
      "Keep it so clear that in 10 seconds anyone knows: what this is, who it is for, and what problem it solves. Short plain sentences, no jargon.",
    appliesTo: ["sales_copy", "script"],
  },
  {
    id: "specificity_verified",
    name: "Verified specificity",
    what: "Concrete verified specifics beat vague superlatives.",
    promptGuidance:
      "Prefer concrete verified specifics over vague praise ('30 recipes, shopping lists included' beats 'amazing best guide'). Numbers ONLY if they come from the verified facts above — never invent a count.",
    appliesTo: ["sales_copy", "script"],
  },
];

/** Banned persuasion tricks — scanned out of generated copy, never softened. */
export interface BannedPsychologyPattern {
  id: string;
  label: string;
  pattern: RegExp;
}

export const BANNED_PSYCHOLOGY_PATTERNS: BannedPsychologyPattern[] = [
  {
    id: "fake_urgency",
    label: "Fake urgency (false deadline / pressure)",
    pattern:
      /\b(limited\s?(time|offer)|only\s?today|hurry|act\s?now|offer\s?ends|price\s?(goes\s?up|increases)|last\s?chance|before\s?midnight|ending\s?soon)\b/i,
  },
  {
    id: "fake_scarcity",
    label: "Fake scarcity (false stock / availability)",
    pattern:
      /\b(only\s?\d+\s?(left|remaining)|almost\s?(sold\s?out|gone)|selling\s?fast|few\s?left|hurry,?\s?stock)\b/i,
  },
  {
    id: "fake_social_proof",
    label: "Invented social proof (fake buyers / testimonials)",
    pattern:
      /\b(\d[\d,]*\+?\s?(happy\s+)?(customers|buyers|students|users)\b|loved\s+by\s+(thousands|lakhs|millions)\b|testimonials?\b)/i,
  },
  {
    id: "guaranteed_outcome",
    label: "Guaranteed outcome / earnings promise",
    pattern:
      /\b(guarantee[ds]?\s?(results?|success|income|earnings)|100%\s?(success|results?|guarantee)|earn\s?(₹|\$|rs\.?\s?\d)|get\s?rich|financial\s?freedom)\b/i,
  },
  {
    id: "false_superlative",
    label: "False superlative (#1 / best-in-the-world claim)",
    pattern:
      /#\s?1\b|\bnumber\s?one\b|\bbest\s+in\s+(india|the\s+world)\b|\bsab\s+se\s+best\b/i,
  },
];

/** Returns the ids of banned psychology patterns matched in `text`. */
export function scanPsychologyViolations(text: string): string[] {
  const hits: string[] = [];
  for (const banned of BANNED_PSYCHOLOGY_PATTERNS) {
    if (banned.pattern.test(text)) hits.push(banned.id);
  }
  return hits;
}

export function violatesPsychology(text: string): boolean {
  return scanPsychologyViolations(text).length > 0;
}

/** Prompt lines for the sales-page copy generator (all 6 patterns). */
export const SALES_COPY_PSYCHOLOGY_LINES: string[] = [
  "BUYER PSYCHOLOGY (ethical — clarity and trust, never pressure):",
  ...BUYER_PSYCHOLOGY_PATTERNS.map(
    (p) => `- ${p.name}: ${p.promptGuidance}`,
  ),
  "- NEVER use fake urgency ('limited time', 'only today', 'price increases'), fake scarcity ('only 3 left'), invented testimonials or buyer counts, guaranteed results, or '#1 / best in India' claims.",
];

/** Prompt lines for the video script prompt (compact — same doctrine). */
export const SCRIPT_PSYCHOLOGY_LINES: string[] = [
  "",
  "BUYER PSYCHOLOGY (ethical — clarity and trust, never pressure):",
  "- Hook with the VALUE first: the outcome the buyer gets, not a spec list.",
  "- Build trust ONLY from the verified facts above — never invent testimonials, ratings, buyer counts, or endorsements.",
  "- Answer ONE likeliest buyer doubt plainly in a middle scene (beginner ke liye hai? kaise use karenge?).",
  "- Keep the closing simple: what it is, who it is for, one honest line — no pressure, no fake urgency, no fake scarcity.",
];

export function psychologyPromptSection(
  kind: "sales_copy" | "script",
): string[] {
  return kind === "sales_copy"
    ? SALES_COPY_PSYCHOLOGY_LINES
    : SCRIPT_PSYCHOLOGY_LINES;
}
