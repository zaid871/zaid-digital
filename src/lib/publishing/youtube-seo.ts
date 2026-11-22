/**
 * YouTube SEO package generator (7-point plan #3).
 *
 * YouTube = second-largest search engine; tutorial videos drive sales for
 * YEARS. This module builds the SEO package: keyword-front-loaded title,
 * description with chapters + links, tags within the 500-char limit.
 *
 * Module + tests ONLY (like caption-pack). Upload stays manual or via
 * YouTube Data API (free quota) at deploy — API OAuth wiring is deploy work.
 * Worker-side (direct text failover). Compliance-scanned.
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "../digital/ebook";

export type YoutubeSeoTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface YoutubeSeoInput {
  topic: string;
  keywords?: string[];
  /** Free resource linked in description (lead magnet). */
  freebieName?: string;
  chapters?: string[];
}

export interface YoutubeSeo {
  title: string | null;
  description: string | null;
  tags: string[];
  warnings: string[];
}

const seoSchema = z.object({
  title: z.string().max(100),
  description: z.string().max(4000),
  tags: z.array(z.string().max(40)).max(20),
});

function clean(text: string): boolean {
  return !PRICE_PATTERN.test(text) && !BANNED_CLAIM_PATTERN.test(text);
}

export async function buildYoutubeSeo(
  input: YoutubeSeoInput,
  textGen: YoutubeSeoTextGen = ebookTextGen
): Promise<YoutubeSeo> {
  const warnings: string[] = [];
  const topic = input.topic.trim();
  if (topic.length < 3) throw new DigitalError("validation_error", "topic is required.");
  const prompt = `You are a YouTube SEO expert. Build the SEO package for a tutorial video in Hinglish (Roman script, Indian audience).
Topic: ${topic}
Target keywords: ${(input.keywords ?? []).join(", ") || "derive from topic"}
Free resource to mention: ${input.freebieName ?? "none"}
Chapters: ${(input.chapters ?? []).join(" | ") || "intro, main tutorial, recap"}
RULES:
- title ≤100 chars: exact keyword phrase FRONT-LOADED + curiosity (no clickbait lies).
- description: first 2 lines = what they'll learn + outcome; then chapters with timestamps (00:00 format); then free resource mention; then 2-3 honest lines about the channel. NO fake claims.
- tags: ≤15, mix of exact + long-tail, each ≤40 chars.
- NO prices, NO fake urgency, NO guaranteed results, NO "#1" claims.
Return ONLY valid JSON, no markdown fences: {"title":"...","description":"...","tags":["..."]}`;

  let raw: string;
  try {
    raw = await textGen(prompt, 1200);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `YouTube SEO generation failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "YouTube SEO model returned unparseable output.");
  }
  let parsed: z.infer<typeof seoSchema>;
  try {
    parsed = seoSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "YouTube SEO model returned invalid JSON shape.");
  }

  let title: string | null = parsed.title;
  if (!clean(title)) { warnings.push("title dropped: price/claim pattern matched."); title = null; }
  let description: string | null = parsed.description;
  if (!clean(description)) { warnings.push("description dropped: price/claim pattern matched."); description = null; }
  const tags: string[] = [];
  let charCount = 0;
  for (const t of parsed.tags) {
    if (!clean(t)) { warnings.push(`tag "${t}" dropped: price/claim pattern matched.`); continue; }
    if (charCount + t.length + 1 > 500) break; // YouTube 500-char tag limit
    tags.push(t);
    charCount += t.length + 1;
  }
  return { title, description, tags, warnings };
}
