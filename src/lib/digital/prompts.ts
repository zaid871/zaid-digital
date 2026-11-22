/**
 * Prompt-library generator — topic in, sellable prompt pack out.
 *
 * A prompt library is a set of ready-to-use AI prompts on one topic:
 * each item has a title, the prompt text, a category, and a one-line
 * "how to use". AI drafts them from the topic (one JSON call over the
 * free text chain, same pattern as the template copy draft); when AI
 * fails, a deterministic bank of topic-parameterised prompt templates
 * fills in (warning recorded — the bank items are labelled as samples
 * in the manifest, never presented as AI-written).
 *
 * Every prompt passes the compliance scan (price / banned-claim
 * patterns). A violating prompt is DROPPED with a warning, never
 * shipped; if all are dropped the whole request fails honestly.
 *
 * Output: prompts.md (formatted) + prompts.txt (plain) + prompts.json
 * + manifest + zip via ./package.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError, type TextGen } from "./ebook";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

export interface PromptItem {
  title: string;
  prompt: string;
  category: string;
  howToUse: string;
}

export interface PromptLibraryRequest {
  topic: string;
  count?: number;
  category?: string;
  useAi?: boolean;
}

export interface PromptLibraryResult {
  title: string;
  slug: string;
  dir: string;
  prompts: PromptItem[];
  files: { manifest: string; zip: string | null; markdown: string; text: string; json: string };
  warnings: string[];
}

const CATEGORIES = ["writing", "marketing", "learning", "business", "social", "general"] as const;

/** Deterministic bank — generic prompt templates with a {topic} slot. */
function bankPrompts(topic: string, count: number): PromptItem[] {
  const t = topic.trim();
  const bank: Array<Omit<PromptItem, "category"> & { category: string }> = [
    { title: "Quick explainer", category: "learning", prompt: `Explain ${t} in simple words, as if teaching a curious beginner. Use one everyday example and end with a one-line summary.`, howToUse: "Paste into any chatbot for a plain-language intro." },
    { title: "Social post draft", category: "social", prompt: `Write a short, honest social-media post about ${t}. Hook in the first line, 3 short points, end with a question. No hype, no fake claims.`, howToUse: "Edit the hook to match your voice, then post." },
    { title: "10 ideas list", category: "marketing", prompt: `Give me 10 practical content ideas about ${t}, each one line, each different — tips, stories, mistakes, and questions.`, howToUse: "Pick 3 and turn each into a post." },
    { title: "Beginner roadmap", category: "learning", prompt: `Make a 7-day beginner roadmap to learn ${t}. Each day: one small task (under 30 minutes) and what "done" looks like.`, howToUse: "Follow day by day; tick off each task." },
    { title: "Sales page outline", category: "business", prompt: `Outline a sales page for a product about ${t}: headline, 3 benefits, who it is for, who it is NOT for, and a simple FAQ of 3 questions. Honest tone only — no hype.`, howToUse: "Fill in your real product details." },
    { title: "Email sequence", category: "marketing", prompt: `Write a 3-email welcome sequence about ${t}. Email 1: welcome + one useful tip. Email 2: a common mistake to avoid. Email 3: a simple next step. Friendly tone, short paragraphs.`, howToUse: "Send one email per day after signup." },
    { title: "FAQ builder", category: "business", prompt: `List the 8 most common questions people ask about ${t}, with a short honest answer for each. If something depends on the situation, say so.`, howToUse: "Paste into your website FAQ or product page." },
    { title: "Caption pack", category: "social", prompt: `Write 5 different captions about ${t}: one funny, one serious, one story-style, one tip-style, one question. Each under 25 words.`, howToUse: "Rotate one caption per post." },
    { title: "Mistakes to avoid", category: "learning", prompt: `What are the 5 biggest mistakes beginners make with ${t}? For each: the mistake, why it happens, and the fix in one line.`, howToUse: "Turn into a checklist or a reel script." },
    { title: "Product description", category: "business", prompt: `Write a product description for a beginner-friendly guide about ${t}: what it covers, who it helps, what is inside (3 items), and what it does NOT promise. Honest tone only.`, howToUse: "Use on your store or Gumroad page." },
    { title: "Hook generator", category: "marketing", prompt: `Write 10 opening hooks about ${t} for short videos. Each under 10 words. Mix questions, bold statements, and "stop doing X" style hooks.`, howToUse: "Test one hook per video; keep the winners." },
    { title: "Weekly planner", category: "general", prompt: `Plan one focused week around ${t}: one theme per day, one small output per day, and a 15-minute Friday check-in. Keep it realistic for a busy person.`, howToUse: "Print or copy into your planner." },
  ];
  return bank.slice(0, count).map((b) => ({ ...b }));
}

async function aiPrompts(
  req: PromptLibraryRequest,
  count: number,
  textGen: TextGen
): Promise<PromptItem[] | null> {
  const cat = req.category ? ` in the category "${req.category}"` : "";
  const prompt = [
    `Write a prompt library about the topic: "${req.topic}"${cat}.`,
    `Reply with ONLY a JSON array of ${count} objects, no other text.`,
    `Each object: {"title": "short name (max 6 words)", "prompt": "the full usable AI prompt (2-4 sentences, specific and practical)", "category": "one of: ${CATEGORIES.join(", ")}", "howToUse": "one short sentence on how to use it"}.`,
    `Make the prompts varied — different angles, not the same idea reworded. Write in Roman-script Hinglish where natural. Practical, specific content — NO prices, NO discounts, NO income or result promises, NO fake claims.`,
  ].join("\n");
  try {
    const raw = await textGen(prompt, 2000);
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(raw.slice(start, end + 1)) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length < 1) return null;
    const items: PromptItem[] = [];
    for (const it of arr.slice(0, count)) {
      if (!it || typeof it !== "object") continue;
      const title = String(it.title ?? "").trim();
      const text = String(it.prompt ?? "").trim();
      if (title.length < 3 || text.length < 20) continue;
      const category = CATEGORIES.includes(String(it.category ?? "") as (typeof CATEGORIES)[number])
        ? String(it.category)
        : "general";
      items.push({
        title,
        prompt: text,
        category,
        howToUse: String(it.howToUse ?? "").trim() || "Paste into your favourite AI chat and edit the details.",
      });
    }
    return items.length >= Math.min(4, count) ? items : null;
  } catch {
    return null;
  }
}

function scanPrompt(item: PromptItem): string | null {
  const text = `${item.title} ${item.prompt}`;
  const price = text.match(PRICE_PATTERN);
  if (price) return `price/offer pattern: "${price[0]}"`;
  const banned = text.match(BANNED_CLAIM_PATTERN);
  if (banned) return `banned claim pattern: "${banned[0]}"`;
  return null;
}

export async function generatePromptLibrary(
  req: PromptLibraryRequest,
  deps?: { textGen?: TextGen; outRoot?: string }
): Promise<PromptLibraryResult> {
  const topic = req.topic.trim();
  if (topic.length < 3) throw new DigitalError("validation_error", "Prompt library needs a topic (min 3 chars).");
  const count = Math.min(20, Math.max(4, req.count ?? 10));
  const warnings: string[] = [];

  let items: PromptItem[] | null = null;
  if (req.useAi !== false && deps?.textGen) {
    items = await aiPrompts(req, count, deps.textGen);
    if (!items) warnings.push("ai_draft_fallback: AI draft nahi bana — built-in prompt bank use hua hai");
  }
  if (!items) {
    items = bankPrompts(topic, count);
    if (req.useAi !== false && !deps?.textGen) {
      warnings.push("ai_draft_fallback: no textGen supplied — built-in prompt bank use hua hai");
    }
  }

  // Compliance: drop violators, never ship them.
  const kept: PromptItem[] = [];
  let dropped = 0;
  for (const item of items) {
    const hit = scanPrompt(item);
    if (hit) {
      dropped++;
      warnings.push(`compliance_dropped: prompt "${item.title}" dropped (${hit})`);
    } else {
      kept.push(item);
    }
  }
  if (kept.length === 0) {
    throw new DigitalError("compliance_rejected", "All prompts failed the compliance scan — nothing to ship.");
  }

  const title = `${topic} Prompt Library`;
  const slug = slugify(title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  const md = [
    `# ${title}`,
    ``,
    `${kept.length} ready-to-use prompts about ${topic}. Copy any prompt, paste it into your favourite AI chat, and edit the details to fit your work.`,
    ``,
    ...kept.flatMap((p, i) => [
      `## ${i + 1}. ${p.title} (${p.category})`,
      ``,
      `\`\`\``,
      p.prompt,
      `\`\`\``,
      ``,
      `*How to use: ${p.howToUse}*`,
      ``,
    ]),
  ].join("\n");
  const txt = kept.map((p, i) => `${i + 1}. ${p.title} [${p.category}]\n${p.prompt}\nHow to use: ${p.howToUse}\n`).join("\n");
  const json = JSON.stringify({ title, topic, count: kept.length, prompts: kept }, null, 2);

  const mdPath = join(dir, "prompts.md");
  const txtPath = join(dir, "prompts.txt");
  const jsonPath = join(dir, "prompts.json");
  await writeFile(mdPath, md, "utf-8");
  await writeFile(txtPath, txt, "utf-8");
  await writeFile(jsonPath, json, "utf-8");

  const manifestPath = await writeManifest(dir, {
    type: "prompt_library",
    title,
    topic,
    count: kept.length,
    dropped,
    categories: [...new Set(kept.map((p) => p.category))],
    files: { markdown: "prompts.md", text: "prompts.txt", json: "prompts.json" },
    deliveryNotes: [
      "Har prompt copy-paste ke liye tayyar hai — apne details bhar kar istemal karein.",
      "Bank prompts sample templates hain; AI-drafted prompts topic ke liye likhe gaye hain.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    title,
    slug,
    dir,
    prompts: kept,
    files: { manifest: manifestPath, zip: zipPath, markdown: mdPath, text: txtPath, json: jsonPath },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Angle Shift (Utkarsh Gose, "How To Find A Winning Digital Product") —
// consolidated 2026-11-20 from angle-shift.ts per the
// consolidate-don't-duplicate rule. The angle's output is prompt
// lines used by ebook/template generation prompts. Names and
// signatures are unchanged. Pure functions, no I/O.
// ---------------------------------------------------------------------------

export type AngleShift = "narrow_audience" | "language_examples" | "format_change";

export interface AngleShiftInfo {
  angle: AngleShift;
  title: string;
  description: string;
  example: string;
  /** Short instruction line injected into generation prompts when this angle is set. */
  promptLine: string;
}

export const ANGLE_SHIFTS: Record<AngleShift, AngleShiftInfo> = {
  narrow_audience: {
    angle: "narrow_audience",
    title: "Narrow the audience",
    description: "Serve one specific group instead of everyone — a narrower promise beats a generic one.",
    example: "Resume templates → specifically for freshers with no experience.",
    promptLine:
      "ANGLE SHIFT — narrow audience: target ONE specific audience group (not everyone). Name who it is for and shape every example around that group.",
  },
  language_examples: {
    angle: "language_examples",
    title: "Change the language and examples",
    description: "Make the language and examples local and relatable instead of English/foreign.",
    example: "English/foreign examples → easy Hinglish + Indian examples.",
    promptLine:
      "ANGLE SHIFT — language and examples: use easy Hinglish and Indian examples throughout. No foreign examples, no English-only references.",
  },
  format_change: {
    angle: "format_change",
    title: "Change the format",
    description: "Same information, easier to use — a format that helps the buyer DO it, not just read about it.",
    example: "A 200-page ebook people call too long → the same info as a checklist or ready-made template.",
    promptLine:
      "ANGLE SHIFT — format change: prefer a do-it-fast format (checklist / ready-made template) over long explanation. Show the result, don't lecture.",
  },
};

export interface AngleRecommendation {
  angle: AngleShift;
  /** Why this angle, with the matched gap(s) quoted. */
  reason: string;
  /** The gap clauses that matched this angle. */
  matchedGaps: string[];
  matches: number;
}

/** Gap keywords per angle (lowercased substring match; English + Hinglish). */
const ANGLE_KEYWORDS: Record<AngleShift, string[]> = {
  format_change: [
    "too long",
    "lamba",
    "lengthy",
    "boring",
    "too much",
    "overwhelming",
    "didn't finish",
    "did not finish",
    "hard to finish",
    "too detailed",
    "too big",
    "too many pages",
    "too heavy",
    "never finish",
  ],
  language_examples: [
    "indian",
    "hindi",
    "english",
    "example",
    "foreign",
    "not indian",
    "western",
    "american",
    "no indian",
    "us example",
  ],
  narrow_audience: [
    "beginner",
    "beginners",
    "advanced",
    "fresher",
    "freshers",
    "no experience",
    "not for beginners",
    "too advanced",
    "newbie",
    "first time",
    "just starting",
  ],
};

/** Tie-break order — the video's own order (a, b, c). */
const ANGLE_ORDER: AngleShift[] = ["narrow_audience", "language_examples", "format_change"];

/**
 * Pick the best Angle Shift for a product from its Lekin Line gaps.
 * `productKind` is context for the reason line (e.g. "ebook", "template").
 * Returns null when no gap matches any angle — no invented recommendation.
 */
export function recommendAngle(gaps: string[], productKind?: string): AngleRecommendation | null {
  const clean = (gaps ?? []).map((g) => (g ?? "").trim()).filter(Boolean);
  if (!clean.length) return null;
  const scored = ANGLE_ORDER.map((angle) => {
    const matched = clean.filter((gap) => {
      const lower = gap.toLowerCase();
      return ANGLE_KEYWORDS[angle].some((kw) => lower.includes(kw));
    });
    return { angle, matched, matches: matched.length };
  });
  const best = scored.reduce((a, b) => (b.matches > a.matches ? b : a), scored[0]);
  if (best.matches === 0) return null;
  const kind = (productKind ?? "").trim();
  const quoted = best.matched
    .slice(0, 3)
    .map((g) => `"${g.slice(0, 80)}"`)
    .join(", ");
  return {
    angle: best.angle,
    reason:
      `${best.matches} gap(s) point to ${ANGLE_SHIFTS[best.angle].title.toLowerCase()}${kind ? ` for this ${kind}` : ""}: ${quoted}.`,
    matchedGaps: best.matched,
    matches: best.matches,
  };
}

/** The prompt instruction line for an angle (empty string when unset). */
export function angleShiftLine(angle: AngleShift | undefined | null): string {
  if (!angle) return "";
  return ANGLE_SHIFTS[angle].promptLine;
}
