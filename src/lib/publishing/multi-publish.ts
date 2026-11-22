/**
 * Multi-publish router (extracted from POST /api/v1/publishing/multi-publish
 * so the campaigns tick can use it directly for carousel picks).
 *
 * Flow: platform-fit.fitFor(product) ranks Pinterest/X/LinkedIn/Reddit/Quora/Threads.
 * Pinterest, LinkedIn and Threads publish immediately via their free APIs. Quora,
 * Reddit and X are MANUAL lanes — the function returns ready-to-post drafts:
 * Quora has no public API at all; Reddit's Data API is closed to new
 * developers (createRedditPost is never called here); the X API is
 * pay-per-use. A human posts each draft in one tap, free.
 *
 * The optional `question` (Problem Miner output) shapes the Quora answer
 * and the X thread hook. The optional `subreddit` goes to the Reddit
 * draft; when missing it stays empty for the human to fill — never invented.
 *
 * Per-platform failures are collected, never thrown: the response lists
 * every platform with published | draft | skipped | failed.
 */
import {
  fitFor,
  autoPlatforms,
  manualPlatforms,
  type SocialPlatform,
  type PlatformFit,
} from "./platform-fit";
import { createImagePin } from "./pinterest";
import { createTextPost } from "./linkedin";
import { createThreadsPost } from "./threads";
import { buildQuoraAnswer, buildRedditDraft, buildXThread } from "./intent-drafts";
import { SocialPublishError, type SocialProduct } from "./social-copy";

export type MultiPublishStatus = "published" | "draft" | "skipped" | "failed";

export interface PlatformResult {
  platform: SocialPlatform;
  status: MultiPublishStatus;
  /** Fit info when the router chose the platforms. */
  fit?: string;
  /** Pin/post id when published. */
  id?: string;
  /** Ready-to-post text for manual platforms (Quora answer, Reddit body, X thread). */
  text?: string;
  /** Reddit draft title (manual lane). */
  title?: string;
  /** Reddit target subreddit, "" when none was given (human fills it). */
  subreddit?: string;
  reason?: string;
}

export type FetchFn = typeof fetch;

export async function multiPublish(
  product: SocialProduct,
  platforms: SocialPlatform[] | undefined,
  opts?: { fetchFn?: FetchFn; subreddit?: string; question?: string }
): Promise<{ fits: PlatformFit[]; results: PlatformResult[] }> {
  const fits = fitFor({ name: product.name, category: product.category });
  const fitBy = new Map(fits.map((f) => [f.platform, f]));

  // Router: explicit list wins; otherwise auto (api) + manual (quora/x) by fit.
  const requested: SocialPlatform[] =
    platforms ?? [...autoPlatforms(product), ...manualPlatforms(product)];

  const results: PlatformResult[] = [];
  for (const platform of requested) {
    const fit = fitBy.get(platform);
    if (fit && fit.fit === "low") {
      results.push({
        platform,
        status: "skipped",
        fit: fit.fit,
        reason: `Low fit for this product: ${fit.reasons[0]}`,
      });
      continue;
    }
    try {
      if (platform === "pinterest") {
        const { pinId } = await createImagePin(product, { fetchFn: opts?.fetchFn });
        results.push({ platform, status: "published", fit: fit?.fit, id: pinId });
      } else if (platform === "linkedin") {
        const { postId } = await createTextPost(product, { fetchFn: opts?.fetchFn });
        results.push({ platform, status: "published", fit: fit?.fit, id: postId });
      } else if (platform === "threads") {
        // API lane — Threads has a free official API (container-then-publish).
        const { postId } = await createThreadsPost(product, { fetchFn: opts?.fetchFn });
        results.push({ platform, status: "published", fit: fit?.fit, id: postId });
      } else if (platform === "quora") {
        // Manual lane — Quora has no API. Draft only, never posted.
        const { answer } = buildQuoraAnswer(product, opts?.question);
        results.push({
          platform,
          status: "draft",
          fit: fit?.fit,
          text: answer,
          reason: fit?.note ?? undefined,
        });
      } else if (platform === "reddit") {
        // Manual lane — Reddit's Data API is closed to new developers.
        // createRedditPost is deliberately NOT called here.
        const draft = buildRedditDraft(product, opts?.subreddit);
        results.push({
          platform,
          status: "draft",
          fit: fit?.fit,
          text: draft.text,
          title: draft.title,
          subreddit: draft.subreddit,
          reason: fit?.note ?? undefined,
        });
      } else {
        // X: draft only — API is pay-per-use, manual posting is free.
        // The draft is a thread summarising the key points; the link
        // goes in the last post.
        const thread = buildXThread(product, opts?.question);
        results.push({
          platform,
          status: "draft",
          fit: fit?.fit,
          text: thread.join("\n\n"),
          reason: fit?.note ?? undefined,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof SocialPublishError ? err.retryable : false;
      results.push({
        platform,
        status: "failed",
        fit: fit?.fit,
        reason: `${reason}${retryable ? " (retryable)" : ""}`.slice(0, 400),
      });
    }
  }
  return { fits, results };
}
