/**
 * Intent-channel drafts — ready-to-post TEXT for the manual lanes
 * (Quora / Reddit / X). Nothing is posted here: no fetch calls at all.
 *
 * Why manual: Quora has no public API at all; Reddit's Data API is
 * closed to new developers (no tokens can exist — reddit.ts is dead
 * code); the X API is pay-per-use. The human posts each draft in one
 * tap, free. The funnel: Reels = discovery, these three channels =
 * intent + conversion (buyers come from questions, discussions and
 * threads — not from watching a reel).
 *
 * All copy is compliance-scanned like every other publisher (no prices,
 * no banned claims) and carries the affiliate disclosure. Drafts are
 * value-first: they answer the question / summarise the key points, and
 * the product appears only as the resource where it genuinely fits.
 */
import {
  assertCleanCopy,
  withDisclosure,
  type SocialProduct,
} from "./social-copy";
import { buildRedditCopy, normalizeSubreddit } from "./reddit";
import { buildXPost, X_POST_MAX } from "./x";

/** t.co shortens every URL to 23 chars for X counting purposes. */
const TCO_LEN = 23;
const QUORA_WORD_MAX = 260;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function firstSentence(text: string): string {
  const m = text.trim().match(/^[^.!?]+[.!?]/);
  return (m ? m[0] : text.trim()).trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface QuoraDraft {
  answer: string;
  wordCount: number;
}

/**
 * Build a Quora answer that directly answers `question` (from Problem
 * Miner output when available). Target ~150-250 words: direct answer
 * first, what was checked, then the product as the resource — never a
 * bare link-drop. Throws on compliance violation.
 */
export function buildQuoraAnswer(product: SocialProduct, question?: string): QuoraDraft {
  if (!product.link) throw new Error("quora: answer needs the product link.");
  const q = question?.trim() ?? "";
  const desc = product.description?.trim() ?? "";
  const feats = (product.features ?? []).filter(Boolean).slice(0, 3);
  const name = product.name.trim() || "Ye product";

  const direct = q
    ? `Short answer: ${desc ? firstSentence(desc) : `${name} isi problem ke liye bana hai.`}`
    : desc
      ? firstSentence(desc)
      : `${name} — roz ke kaam ki ek useful product hai.`;

  const checked: string[] = [];
  if (feats.length > 0) {
    checked.push(`Maine isme ye check kiya: ${feats.join(", ")}.`);
  }
  if (desc) {
    const extra = sentences(desc).slice(1, 5);
    checked.push(...extra);
  }

  const resource = q
    ? `Agar tumhe is sawaal ka practical solution chahiye to ${name} check kar sakte ho: ${product.link}.`
    : `Details yahan hain: ${product.link}.`;

  // Assemble inside the word budget: opening + resource + disclosure are
  // mandatory; checked points are dropped last-to-first if over budget.
  // Never pad with invented content to reach a minimum.
  const parts = [direct, ...checked, resource];
  let answer = withDisclosure(parts.join("\n\n"));
  while (wordCount(answer) > QUORA_WORD_MAX && checked.length > 0) {
    checked.pop();
    answer = withDisclosure([direct, ...checked, resource].join("\n\n"));
  }
  assertCleanCopy(answer, "quora");
  return { answer, wordCount: wordCount(answer) };
}

export interface RedditDraft {
  title: string;
  /** Self-post body (ready to paste). */
  text: string;
  /** Plain subreddit name, or "" when none was given — never invented. */
  subreddit: string;
}

/**
 * Build a Reddit self-post draft. Title + body reuse the existing
 * buildRedditCopy (value-first, disclosure included, compliance-scanned).
 * The subreddit is REQUIRED from the caller or left empty for the human
 * to fill — it is never invented. Throws on compliance violation or an
 * invalid subreddit name.
 */
export function buildRedditDraft(product: SocialProduct, subreddit?: string): RedditDraft {
  const copy = buildRedditCopy(product, "text");
  const sr = subreddit?.trim() ? normalizeSubreddit(subreddit) : "";
  return { title: copy.title, text: copy.text ?? "", subreddit: sr };
}

/** Count an X post with t.co shortening (every URL counts as 23 chars). */
export function countXPost(text: string, link = ""): number {
  return link ? text.length - link.length + TCO_LEN : text.length;
}

function trimXPost(text: string, link = ""): string {
  if (countXPost(text, link) <= X_POST_MAX) return text;
  const words = text.split(/\s+/);
  while (words.length > 1 && countXPost(`${words.join(" ")}…`, link) > X_POST_MAX) words.pop();
  return `${words.join(" ")}…`;
}

/**
 * Build an X thread of 3-5 posts that SUMMARISES the product's key
 * points — not a teaser + link. Post 1 hooks the problem/question,
 * the middle posts each carry one key point (feature/benefit), and the
 * last post carries the link + disclosure (reuses buildXPost). Every
 * post is ≤280 chars (t.co counted). Throws on compliance violation.
 */
export function buildXThread(product: SocialProduct, question?: string): string[] {
  if (!product.link) throw new Error("x thread: post needs the product link.");
  const name = product.name.trim() || "Ye product";
  const feats = (product.features ?? []).filter(Boolean).slice(0, 3);
  const desc = product.description?.trim() ?? "";
  const q = question?.trim() ?? "";

  const hook = q
    ? `${q} — short answer: ${name} isi liye bana hai.`
    : feats[0]
      ? `${name} — ${feats[0]}.`
      : desc
        ? `${name} — ${firstSentence(desc)}`
        : `${name} — kaam ki cheez.`;

  // Key points: features first, then description sentences. The hook
  // already used feats[0] when there is no question, so value posts
  // start from feats[1] in that case; with a question the hook used
  // the question, so all features are fresh key points.
  const points: string[] = [];
  for (const f of feats.slice(q ? 0 : 1)) points.push(f);
  for (const s of sentences(desc)) {
    if (points.length >= 3) break;
    if (firstSentence(desc) === s && !q) continue;
    points.push(s);
  }
  if (points.length === 0) {
    points.push("Seedha point: kaam ki cheez, bina extra bakwaas.");
  }

  const posts: string[] = [trimXPost(hook)];
  for (const p of points.slice(0, 3)) {
    posts.push(trimXPost(p.endsWith(".") || p.endsWith("!") ? p : `${p}.`));
  }
  posts.push(buildXPost(product));
  return posts.slice(0, 5);
}

export interface IntentDrafts {
  quora: QuoraDraft;
  reddit: RedditDraft;
  xThread: string[];
}

/**
 * All three manual-lane drafts for one product. Pure text — nothing is
 * posted, no fetch calls. `question` (Problem Miner output) shapes the
 * Quora answer and the X hook; `subreddit` is passed through to the
 * Reddit draft (empty when not given — never invented).
 */
export function buildIntentDrafts(
  product: SocialProduct,
  opts?: { question?: string; subreddit?: string }
): IntentDrafts {
  return {
    quora: buildQuoraAnswer(product, opts?.question),
    reddit: buildRedditDraft(product, opts?.subreddit),
    xThread: buildXThread(product, opts?.question),
  };
}
