/**
 * Platform-fit analyzer: decides WHERE a product should be promoted.
 *
 * Pure and deterministic — a visible rule table, not a black box. The
 * router (multi-publish endpoint / n8n workflow) calls fitFor() and
 * publishes only where the fit is high/medium.
 *
 * Honest automation notes baked into the output:
 * - Pinterest + LinkedIn + Threads: free official APIs → publishMode "api".
 *   Threads posts text-first (500 chars) via graph.threads.net,
 *   container-then-publish like Instagram; 250 posts/profile/day.
 * - X: official API is pay-per-use since Feb 2026 ($0.20 per post WITH a
 *   link, no free tier for new developers) → publishMode "manual" always.
 *   The system prepares the post copy; a human posts it via the X app.
 * - Quora: NO public API at all → publishMode "manual" always. The
 *   system prepares a ready-to-post answer; a human posts it in Quora.
 * - Reddit: free API in principle, but closed to new developers since
 *   Nov 2025 (no tokens can exist — reddit.ts is dead code) → the
 *   router returns a manual draft instead of calling the API. Reddit is
 *   strict about self-promotion — new/low-karma accounts get
 *   auto-removed by many subreddits and each subreddit has its own
 *   rules. A Reddit "published" result means Reddit accepted the
 *   submission, not that it survived moderation.
 */

export type SocialPlatform = "pinterest" | "x" | "linkedin" | "reddit" | "quora" | "threads";
export type FitLevel = "high" | "medium" | "low";
/** "api" = free automated publishing; "manual" = copy prepared, human posts. */
export type PublishMode = "api" | "manual";

export interface PlatformFit {
  platform: SocialPlatform;
  fit: FitLevel;
  reasons: string[];
  publishMode: PublishMode;
  /** Human-readable caveat shown wherever this fit is surfaced. */
  note: string | null;
}

export interface FitInput {
  name: string;
  /** Category key from the discovery allowlist (e.g. "kitchen"). */
  category: string;
  tags?: string[];
}

const X_PAID_NOTE =
  "X automation is paid: since Feb 2026 the X API is pay-per-use for new developers " +
  "($0.20 per post with a link). The system prepares the post text — you post it " +
  "manually in the X app (free).";

const REDDIT_NOTE =
  "Reddit is strict about self-promotion: new/low-karma accounts get " +
  "auto-removed by many subreddits and each subreddit has its own rules. " +
  "Link posts only by default; post value-first. A 'published' result " +
  "means Reddit accepted the submission, not that it survived moderation.";

const QUORA_NOTE =
  "Quora has no public API — the system prepares a ready-to-post answer " +
  "and you post it manually in Quora (free). The answer must genuinely " +
  "answer the question; bare link-drops get collapsed.";

/**
 * Category → platform fit. Pinterest is a visual search engine (home, kitchen,
 * templates do best); X is tech conversation; LinkedIn is professional;
 * Reddit is community discussion (tech/productivity subreddits).
 */
const FIT_TABLE: Record<string, Record<SocialPlatform, { fit: FitLevel; reason: string }>> = {
  kitchen: {
    pinterest: { fit: "high", reason: "Kitchen products are top-performing visual-search content on Pinterest." },
    x: { fit: "low", reason: "Kitchen gadgets get little tech-conversation traction on X." },
    linkedin: { fit: "low", reason: "Kitchen products rarely fit a professional LinkedIn audience." },
    reddit: { fit: "low", reason: "Kitchen products get little discussion traction on Reddit." },
    quora: { fit: "low", reason: "Kitchen products rarely get asked about on Quora." },
    threads: { fit: "medium", reason: "Kitchen tips get some Threads conversation, but the platform is text-first and kitchen content is visual-led." },
  },
  household: {
    pinterest: { fit: "high", reason: "Home/household visuals are Pinterest's core discovery category." },
    x: { fit: "low", reason: "Household items get little tech-conversation traction on X." },
    linkedin: { fit: "low", reason: "Household products rarely fit a professional LinkedIn audience." },
    reddit: { fit: "low", reason: "Household items get little discussion traction on Reddit." },
    quora: { fit: "low", reason: "Household items rarely drive Quora questions." },
    threads: { fit: "medium", reason: "Household tips get some Threads conversation, but the platform is text-first and home content is visual-led." },
  },
  useful_physical: {
    pinterest: { fit: "high", reason: "Useful everyday products perform well as Pinterest discovery pins." },
    x: { fit: "medium", reason: "Clever gadgets can travel on X, but reach is unpredictable." },
    linkedin: { fit: "low", reason: "General gadgets rarely fit a professional LinkedIn audience." },
    reddit: { fit: "medium", reason: "Useful gadgets can spark discussion in gadget subreddits, but self-promotion rules are strict." },
    quora: { fit: "low", reason: "Everyday gadgets rarely drive Quora questions." },
    threads: { fit: "medium", reason: "Everyday gadgets get quick-take Threads posts, but the audience skews tech/professional." },
  },
  digital_products_templates: {
    pinterest: { fit: "high", reason: "Templates and printables are evergreen Pinterest search content." },
    x: { fit: "medium", reason: "Digital tools get some X traction in creator circles." },
    linkedin: { fit: "high", reason: "Productivity templates fit LinkedIn's professional audience." },
    reddit: { fit: "medium", reason: "Templates and productivity tools fit productivity subreddits, but each subreddit has its own self-promotion rules." },
    quora: { fit: "medium", reason: "Templates and productivity questions are common on Quora." },
    threads: { fit: "high", reason: "Templates and productivity tools fit Threads' text-first, tip-sharing audience — the same crowd that reads the ebook." },
  },
  computers_ai_tools: {
    pinterest: { fit: "low", reason: "AI/software tools are weak visual-search content on Pinterest." },
    x: { fit: "high", reason: "Tech and AI tools are X's strongest conversation category." },
    linkedin: { fit: "high", reason: "Productivity/AI tools fit LinkedIn's professional audience." },
    reddit: { fit: "high", reason: "AI/tech tools fit tech subreddits with strong discussion." },
    quora: { fit: "high", reason: "AI/tech tools are heavily asked about on Quora." },
    threads: { fit: "high", reason: "AI/tech tools are Threads' strongest text-first conversation category." },
  },
  electronics: {
    pinterest: { fit: "medium", reason: "Electronics work on Pinterest when the visual is strong." },
    x: { fit: "high", reason: "Gadgets and electronics drive strong X tech conversation." },
    linkedin: { fit: "medium", reason: "Work-relevant electronics (audio, desk gear) fit LinkedIn." },
    reddit: { fit: "medium", reason: "Gadget discussion is strong on Reddit, but self-promotion rules are strict." },
    quora: { fit: "medium", reason: "Electronics questions are common on Quora." },
    threads: { fit: "medium", reason: "Gadgets get Threads discussion, but visual-first products do better on Pinterest." },
  },
  mobile_accessories: {
    pinterest: { fit: "medium", reason: "Phone accessories do okay as Pinterest lifestyle pins." },
    x: { fit: "high", reason: "Mobile gear is everyday X tech conversation." },
    linkedin: { fit: "low", reason: "Phone accessories rarely fit a professional LinkedIn audience." },
    reddit: { fit: "medium", reason: "Phone accessories get some discussion in mobile subreddits." },
    quora: { fit: "low", reason: "Phone accessories rarely drive Quora questions." },
    threads: { fit: "medium", reason: "Phone gear gets some Threads chatter, but it is a niche topic there." },
  },
  other_permissible: {
    pinterest: { fit: "medium", reason: "Uncategorized products default to Pinterest's broad discovery." },
    x: { fit: "medium", reason: "Uncategorized products get unpredictable X traction." },
    linkedin: { fit: "low", reason: "Uncategorized products rarely fit a professional LinkedIn audience." },
    reddit: { fit: "low", reason: "Uncategorized products get unpredictable Reddit traction and strict self-promotion rules." },
    quora: { fit: "low", reason: "Uncategorized products get unpredictable Quora traction." },
    threads: { fit: "medium", reason: "Default medium: Threads' text-first feed gives uncategorized products a fair shot at discussion." },
  },
};

const FIT_ORDER: Record<FitLevel, number> = { high: 0, medium: 1, low: 2 };

/**
 * Rank all six platforms for a product, best fit first.
 * Unknown categories fall back to "other_permissible" — never throw.
 */
export function fitFor(input: FitInput): PlatformFit[] {
  const row = FIT_TABLE[input.category] ?? FIT_TABLE.other_permissible;
  const fits: PlatformFit[] = (Object.keys(row) as SocialPlatform[]).map((platform) => {
    const { fit, reason } = row[platform];
    const publishMode: PublishMode = platform === "x" || platform === "quora" ? "manual" : "api";
    return {
      platform,
      fit,
      reasons: [reason],
      publishMode,
      note: platform === "x" ? X_PAID_NOTE : platform === "reddit" ? REDDIT_NOTE : platform === "quora" ? QUORA_NOTE : null,
    };
  });
  fits.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit]);
  return fits;
}

/**
 * Platforms the system will actually publish to without asking:
 * high/medium fit AND free API automation. Manual-mode platforms (X,
 * Quora) are returned separately as drafts for the user to post by hand.
 */
export function autoPlatforms(input: FitInput): SocialPlatform[] {
  return fitFor(input)
    .filter((f) => f.fit !== "low" && f.publishMode === "api")
    // Reddit is explicit-only: a fresh/low-karma account auto-posting links
    // is exactly what gets flagged. Re-enable by removing this filter once
    // the account has karma. Explicit `platforms: ["reddit"]` still works.
    .filter((f) => f.platform !== "reddit")
    .map((f) => f.platform);
}

/** Platforms worth a manual post (high/medium fit, no free API). */
export function manualPlatforms(input: FitInput): SocialPlatform[] {
  return fitFor(input)
    .filter((f) => f.fit !== "low" && f.publishMode === "manual")
    .map((f) => f.platform);
}
