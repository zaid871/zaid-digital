/**
 * Sales-page copy generator (failure-articles add #3 — Medium #5 "weak sales
 * copy" gap). One AI call turns verified product facts into outcome-based,
 * long-form sales copy: headline, subheadline, problem agitation, outcome
 * bullets, what's-inside, who-it's-for, CTA.
 *
 * Doctrine (same as caption-pack): every field is compliance-scanned with
 * PRICE_PATTERN + BANNED_CLAIM_PATTERN + the buyer-psychology scanner
 * (./buyer-psychology: fake urgency/scarcity, invented social proof,
 * guaranteed outcomes, false superlatives) — a violating field is DROPPED
 * (null/removed) with a warning, NEVER replaced with fallback copy.
 * Unparseable output is a hard error. No prices, no fake urgency, no
 * fabricated testimonials — transformation becho, topic nahi.
 *
 * Buyer-psychology fields (2026-11-12, Ayan Aarfi patterns, ethical
 * edition): trustLine (verified-facts trust only), objectionAnswers
 * (plain honest answers), riskNote (what is included / NOT included).
 *
 * Module + tests only (not wired into the website catalogue yet).
 * Worker-side: uses ./ebook's direct text failover (Turbopack-safe).
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "./ebook";
import {
  SALES_COPY_PSYCHOLOGY_LINES,
  violatesPsychology,
} from "./buyer-psychology";

export type SalesCopyTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface SalesCopyInput {
  productName: string;
  productType: "ebook" | "template_pack" | "pod";
  /** Verified features only — never invented. */
  features?: string[];
  audience?: string;
  /** Desired outcomes the buyer gets (verified, not promised miracles). */
  outcomes?: string[];
}

export interface SalesCopy {
  headline: string | null;
  subheadline: string | null;
  problemSection: string | null;
  outcomeBullets: string[];
  insideList: string[];
  whoIsItFor: string | null;
  ctaLine: string | null;
  /** Buyer-psychology fields (Ayan Aarfi patterns, ethical edition). */
  trustLine: string | null;
  objectionAnswers: string[];
  riskNote: string | null;
  warnings: string[];
}

const copySchema = z.object({
  headline: z.string().max(120),
  subheadline: z.string().max(200),
  problemSection: z.string().max(600),
  outcomeBullets: z.array(z.string().max(120)).max(6),
  insideList: z.array(z.string().max(120)).max(8),
  whoIsItFor: z.string().max(200),
  ctaLine: z.string().max(120),
  // Buyer-psychology fields: optional so older model outputs still parse.
  trustLine: z.string().max(200).optional(),
  objectionAnswers: z.array(z.string().max(200)).max(4).optional(),
  riskNote: z.string().max(200).optional(),
});

function violates(text: string): boolean {
  return (
    PRICE_PATTERN.test(text) ||
    BANNED_CLAIM_PATTERN.test(text) ||
    violatesPsychology(text)
  );
}

function cleanField(text: string, field: string, warnings: string[]): string | null {
  if (violates(text)) {
    warnings.push(`${field} dropped: price/claim pattern matched.`);
    return null;
  }
  return text;
}

function cleanList(items: string[], field: string, warnings: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (violates(item)) {
      warnings.push(`${field} item dropped: price/claim pattern matched.`);
      continue;
    }
    out.push(item);
  }
  return out;
}

export async function generateSalesCopy(
  input: SalesCopyInput,
  textGen: SalesCopyTextGen = ebookTextGen
): Promise<SalesCopy> {
  const name = input.productName.trim();
  if (name.length < 2) throw new DigitalError("validation_error", "productName is required.");
  const warnings: string[] = [];
  const features = (input.features ?? []).filter((f) => f.trim().length > 0).slice(0, 8);

  const prompt = `Write sales-page copy in natural Hinglish (Roman script, Indian audience) for this digital product.
RULES (strict):
- Outcome-based: sell the TRANSFORMATION, not the topic. "What is this? Who is it for? What problem does it solve? Why care?" must be obvious in 10 seconds.
- Use ONLY these verified features, never invent specs: ${features.length ? features.join(" | ") : "(none provided — keep claims general and honest)"}
- NO prices, NO discounts, NO fake urgency ("limited offer", "only today"), NO "guaranteed results", NO fake testimonials/reviews, NO "#1" claims.
- CTA line must be a simple action ("Abhi download karo"), no pressure tactics.
${SALES_COPY_PSYCHOLOGY_LINES.join("\n")}
- Return ONLY valid JSON, no markdown fences.

Product: ${name}
Type: ${input.productType}
Audience: ${input.audience ?? "general Indian audience"}
Desired outcomes: ${(input.outcomes ?? []).join(" | ") || "not specified"}

JSON shape:
{"headline":"...","subheadline":"...","problemSection":"...","outcomeBullets":["..."],"insideList":["..."],"whoIsItFor":"...","ctaLine":"...","trustLine":"one trust line from verified facts only","objectionAnswers":["Q: ... A: ..."],"riskNote":"what is included and what it does NOT do, honestly"}`;

  let raw: string;
  try {
    raw = await textGen(prompt, 1200);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `Sales copy generation failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "Sales copy model returned unparseable output.");
  }
  let parsed: z.infer<typeof copySchema>;
  try {
    parsed = copySchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "Sales copy model returned invalid JSON shape.");
  }

  return {
    headline: cleanField(parsed.headline, "headline", warnings),
    subheadline: cleanField(parsed.subheadline, "subheadline", warnings),
    problemSection: cleanField(parsed.problemSection, "problemSection", warnings),
    outcomeBullets: cleanList(parsed.outcomeBullets, "outcomeBullets", warnings),
    insideList: cleanList(parsed.insideList, "insideList", warnings),
    whoIsItFor: cleanField(parsed.whoIsItFor, "whoIsItFor", warnings),
    ctaLine: cleanField(parsed.ctaLine, "ctaLine", warnings),
    trustLine:
      parsed.trustLine === undefined
        ? null
        : cleanField(parsed.trustLine, "trustLine", warnings),
    objectionAnswers: cleanList(
      parsed.objectionAnswers ?? [],
      "objectionAnswers",
      warnings,
    ),
    riskNote:
      parsed.riskNote === undefined
        ? null
        : cleanField(parsed.riskNote, "riskNote", warnings),
    warnings,
  };
}
