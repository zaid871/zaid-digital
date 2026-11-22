/**
 * Auto-FAQ generator (failure-articles add #4 — Alva #5 support spiral:
 * 3.7 tickets/10 sales; top issue "can't download" 37%).
 *
 * One AI call generates 5-7 product-specific Q&As from verified facts, then
 * 3 fixed support Q&As are appended (delivery, format, help) — honest and
 * generic, no fake promises. Every AI field is compliance-scanned; violating
 * items are dropped with a warning, never replaced.
 *
 * Module + tests only (wires into the website catalogue / delivery page
 * when selling unparks). Worker-side (./ebook text failover).
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "./ebook";

export type FaqTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface FaqInput {
  productName: string;
  productType: "ebook" | "template_pack" | "pod";
  /** Verified facts about what's inside (chapter titles, template kinds...). */
  about?: string[];
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqResult {
  items: FaqItem[];
  warnings: string[];
}

const faqSchema = z.object({
  faqs: z.array(z.object({ q: z.string().max(160), a: z.string().max(400) })).max(8),
});

function violates(text: string): boolean {
  return PRICE_PATTERN.test(text) || BANNED_CLAIM_PATTERN.test(text);
}

const FORMAT_ANSWER: Record<FaqInput["productType"], string> = {
  ebook: "PDF format me milega — phone, tablet aur computer par khulta hai.",
  template_pack: "Editable SVG files + PNG previews + ZIP pack me milega.",
  pod: "Ye physical t-shirt hai — Printify se tumhare address par print hokar bheji jayegi.",
};

function supportFaqs(productType: FaqInput["productType"]): FaqItem[] {
  return [
    {
      q: "Download kaise karun?",
      a: "Kharidne ke baad tumhe download link milega. Link kaam na kare ya file na khule to support se contact karo — hum madad karenge.",
    },
    { q: "Kis format me milega?", a: FORMAT_ANSWER[productType] },
    {
      q: "Koi issue ho to?",
      a: "Support se contact karo — order details ke saath. Hum jald se jald hal nikalenge.",
    },
  ];
}

export async function generateFaq(
  input: FaqInput,
  textGen: FaqTextGen = ebookTextGen
): Promise<FaqResult> {
  const name = input.productName.trim();
  if (name.length < 2) throw new DigitalError("validation_error", "productName is required.");
  const warnings: string[] = [];
  const about = (input.about ?? []).filter((a) => a.trim().length > 0).slice(0, 10);

  const prompt = `Write 5-7 frequently asked questions with short helpful answers in natural Hinglish (Roman script, Indian audience) for this digital product.
RULES (strict):
- Questions buyers ACTUALLY ask: what's inside, how to use, who is it for, how long it takes, what they need.
- Use ONLY these verified facts, never invent: ${about.length ? about.join(" | ") : "(none provided — keep answers general and honest)"}
- NO prices, NO discounts, NO fake urgency, NO guaranteed results, NO fake testimonials.
- Do NOT write delivery/download/refund Q&As (handled separately).
- Return ONLY valid JSON, no markdown fences.
Product: ${name} (${input.productType})
JSON shape: {"faqs":[{"q":"...","a":"..."}]}`;

  let raw: string;
  try {
    raw = await textGen(prompt, 900);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `FAQ generation failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "FAQ model returned unparseable output.");
  }
  let parsed: z.infer<typeof faqSchema>;
  try {
    parsed = faqSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "FAQ model returned invalid JSON shape.");
  }

  const items: FaqItem[] = [];
  for (const f of parsed.faqs) {
    if (violates(f.q) || violates(f.a)) {
      warnings.push("faq item dropped: price/claim pattern matched.");
      continue;
    }
    items.push({ q: f.q, a: f.a });
  }
  // Fixed support Q&As appended (never AI-generated, always honest).
  items.push(...supportFaqs(input.productType));
  return { items, warnings };
}
