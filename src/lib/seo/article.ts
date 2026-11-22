/**
 * SEO article generator (Marketing Machine channel #3).
 *
 * pSEO-style buyer-intent articles: keyword front-loaded, scannable headings,
 * FAQ section (featured-snippet bait), honest soft CTA. Two LLM calls
 * (outline → sections) to save quota; every field compliance-scanned.
 *
 * Module + tests + endpoint. Publishing into the website catalogue is
 * wiring (user decision) — the article markdown is ready to drop in.
 * Worker-side (direct text failover).
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "../digital/ebook";

export type SeoArticleTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface SeoArticleInput {
  topic: string;
  keywords: string[];
  audience?: string;
  productName?: string;
  productLink?: string;
}

export interface SeoArticle {
  title: string | null;
  slug: string;
  metaDescription: string | null;
  headings: string[];
  bodyMarkdown: string | null;
  faq: Array<{ q: string; a: string }>;
  warnings: string[];
}

const outlineSchema = z.object({
  title: z.string().max(70),
  metaDescription: z.string().max(160),
  headings: z.array(z.string().max(80)).min(3).max(6),
});

const bodySchema = z.object({
  intro: z.string().max(800),
  sections: z.array(z.object({ heading: z.string().max(80), body: z.string().max(1200) })).min(3).max(6),
  faq: z.array(z.object({ q: z.string().max(160), a: z.string().max(400) })).min(3).max(5),
  closing: z.string().max(400),
});

function clean(text: string): boolean {
  return !PRICE_PATTERN.test(text) && !BANNED_CLAIM_PATTERN.test(text);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";
}

async function callJson<T>(textGen: SeoArticleTextGen, prompt: string, maxTokens: number, schema: z.ZodType<T>, label: string): Promise<T> {
  let raw: string;
  try {
    raw = await textGen(prompt, maxTokens);
  } catch (err) {
    throw new DigitalError("provider_unavailable", `${label} failed: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`);
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new DigitalError("generation_failed", `${label}: unparseable output.`);
  try {
    return schema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", `${label}: invalid JSON shape.`);
  }
}

export async function buildSeoArticle(
  input: SeoArticleInput,
  textGen: SeoArticleTextGen = ebookTextGen
): Promise<SeoArticle> {
  const warnings: string[] = [];
  const topic = input.topic.trim();
  if (topic.length < 3) throw new DigitalError("validation_error", "topic is required.");
  const keywords = input.keywords.filter((k) => k.trim().length > 1).slice(0, 8);
  if (!keywords.length) throw new DigitalError("validation_error", "at least one keyword is required.");
  const primary = keywords[0];

  // Call 1: outline
  const outline = await callJson(textGen, `You are an SEO content strategist. Build an article outline in Hinglish (Roman script, Indian audience).
Topic: ${topic}
Primary keyword (MUST appear in title, front-loaded): ${primary}
Secondary keywords: ${keywords.slice(1).join(", ") || "none"}
Audience: ${input.audience ?? "general Indian audience"}
RULES: title ≤70 chars (primary keyword first, curiosity, no clickbait lies); metaDescription ≤160 chars (keyword + outcome + soft CTA); 4-5 H2 headings (scannable, keyword variants). NO prices, NO fake claims, NO "#1".
Return ONLY valid JSON: {"title":"...","metaDescription":"...","headings":["..."]}`, 500, outlineSchema, "SEO outline");

  // Call 2: body
  const body = await callJson(textGen, `Write the full article body in Hinglish (Roman script) for these headings. Practical, specific, honest — real tips, no fluff.
Title: ${outline.title}
Headings: ${outline.headings.join(" | ")}
Primary keyword "${primary}" naturally 3-5 times total. Each section 150-250 words.
FAQ: 3-4 real questions buyers ask (with genuinely helpful answers).
Closing: 2-3 lines + ONE soft CTA${input.productName ? ` mentioning ${input.productName}` : ""} (no pressure, no fake urgency).
NO prices, NO discounts, NO guaranteed results, NO fake testimonials, NO "#1" claims.
Return ONLY valid JSON: {"intro":"...","sections":[{"heading":"...","body":"..."}],"faq":[{"q":"...","a":"..."}],"closing":"..."}`, 2500, bodySchema, "SEO body");

  // Compliance gate: violating fields dropped, never replaced
  let title: string | null = outline.title;
  if (!clean(title)) { warnings.push("title dropped: price/claim pattern matched."); title = null; }
  let metaDescription: string | null = outline.metaDescription;
  if (!clean(metaDescription)) { warnings.push("metaDescription dropped: price/claim pattern matched."); metaDescription = null; }

  const sections: string[] = [];
  sections.push(body.intro);
  const usedHeadings = new Set<string>();
  for (const s of body.sections) {
    if (!clean(s.heading) || !clean(s.body)) { warnings.push(`section "${s.heading}" dropped: price/claim pattern matched.`); continue; }
    if (usedHeadings.has(s.heading.toLowerCase())) continue;
    usedHeadings.add(s.heading.toLowerCase());
    sections.push(`## ${s.heading}\n\n${s.body}`);
  }
  const faq: Array<{ q: string; a: string }> = [];
  for (const f of body.faq) {
    if (!clean(f.q) || !clean(f.a)) { warnings.push("faq item dropped: price/claim pattern matched."); continue; }
    faq.push(f);
  }
  let closing: string | null = body.closing;
  if (!clean(closing)) { warnings.push("closing dropped: price/claim pattern matched."); closing = null; }

  const md = [`# ${title ?? topic}`, "", ...sections];
  if (faq.length) {
    md.push("", "## Aksar puche jaane wale sawal", "");
    for (const f of faq) md.push(`**${f.q}**\n\n${f.a}`, "");
  }
  if (closing) md.push(closing, "");
  if (input.productLink) md.push(`[Product dekho](${input.productLink})`);

  return {
    title,
    slug: slugify(title ?? topic),
    metaDescription,
    headings: outline.headings,
    bodyMarkdown: md.join("\n"),
    faq,
    warnings,
  };
}
