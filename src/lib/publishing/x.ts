/**
 * X (Twitter) post copy — DRAFT ONLY, no API call.
 *
 * Why no automation: since 6 Feb 2026 the X API is pay-per-use for new
 * developers — $0.015 per post, $0.20 per post WITH a link (every affiliate
 * post needs a link). 50 posts/month = ~$10/month. That violates this
 * project's free-first rule, so the old free tier is treated as gone.
 *
 * This module builds the ≤280-char post text; a human posts it via the X
 * app/web composer (free). If the user ever opts into pay-per-use, this is
 * the seam where POST /2/tweets would attach.
 */
import { assertCleanCopy, type SocialProduct } from "./social-copy";

export const X_POST_MAX = 280;
/** X shortens every URL to 23 chars (t.co) for counting purposes. */
const TCO_LEN = 23;

/** Build the post text. Throws on compliance violation or over-length. */
export function buildXPost(product: SocialProduct): string {
  if (!product.link) throw new Error("x: post needs the product link.");
  const name = product.name.trim().slice(0, 60) || "Ye product";
  const feats = (product.features ?? []).filter(Boolean);
  const hook = feats[0] ? `${name} — ${feats[0]}.` : `${name} — kaam ki cheez.`;
  const disclosure = "(affiliate link)";
  let text = `${hook} ${product.link} ${disclosure}`;
  assertCleanCopy(text, "x");
  // Count with t.co shortening: replace the real link length with 23.
  const counted = text.length - product.link.length + TCO_LEN;
  if (counted > X_POST_MAX) {
    const over = counted - X_POST_MAX;
    const shortHook = hook.slice(0, Math.max(0, hook.length - over - 1)).trimEnd();
    if (shortHook.length < 10) {
      throw new Error(`x: post copy still over ${X_POST_MAX} chars after shortening — shorten the product name/feature.`);
    }
    text = `${shortHook}… ${product.link} ${disclosure}`;
    assertCleanCopy(text, "x");
  }
  return text;
}
