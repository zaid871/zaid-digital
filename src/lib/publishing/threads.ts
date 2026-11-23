/**
 * Threads API publisher (free, official Meta API).
 *
 * Two calls, the same container-then-publish shape as Instagram:
 *   1. POST https://graph.threads.net/{threads-user-id}/threads
 *      { media_type: "TEXT", text } -> { id: "<container-id>" }
 *   2. POST https://graph.threads.net/{threads-user-id}/threads_publish
 *      ?creation_id={container-id} -> { id: "<post-id>" }
 * Auth: Bearer THREADS_ACCESS_TOKEN (OAuth, scopes threads_basic +
 * threads_content_publish). Own account needs no App Review (dev mode
 * + tester, same as the IG setup); tokens last ~60 days.
 *
 * Honest limits: text max 500 characters, max 5 unique links per post
 * (ours carry 1), 250 API-published posts per profile per rolling 24h.
 * A container created but not published is a FAILURE, never a success.
 */
import {
  assertCleanCopy,
  notConfigured,
  withDisclosure,
  SocialPublishError,
  type SocialProduct,
} from "./social-copy";
import { accountKeyForProduct, loadAccounts } from "./accounts";

const THREADS_BASE = "https://graph.threads.net";
/** Threads caps text at 500 characters (emojis count as UTF-8 bytes). */
export const THREADS_TEXT_MAX = 500;

/**
 * Which Threads profile posts this product type? Resolves the account
 * for the product (same routing as IG/FB), then reads that account's
 * Threads token (env var from its threadsTokenEnv, default
 * THREADS_ACCESS_TOKEN_<KEY>) and threadsUserId. Falls back to the
 * default env vars (THREADS_ACCESS_TOKEN / THREADS_USER_ID = tech_fynd)
 * when the account has no Threads credentials — so products whose
 * account lacks a Threads token still post from the default profile
 * instead of failing. Returns empty strings when nothing is configured
 * anywhere; createThreadsPost then throws notConfigured honestly.
 */
export function resolveThreadsCredentials(
  productType?: string,
  env: Record<string, string | undefined> = process.env
): { token: string; threadsUserId: string } {
  const fallback = {
    token: (env.THREADS_ACCESS_TOKEN ?? "").trim(),
    threadsUserId: (env.THREADS_USER_ID ?? "").trim(),
  };
  const accounts = loadAccounts(env);
  if (accounts.length === 0) return fallback;
  const key = accountKeyForProduct(accounts, productType);
  if (!key) return fallback;
  const account = accounts.find((a) => a.key === key);
  if (!account?.threadsUserId) return fallback;
  const tokenEnv =
    account.threadsTokenEnv ?? `THREADS_ACCESS_TOKEN_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const token = (env[tokenEnv] ?? "").trim();
  if (!token) return fallback;
  return { token, threadsUserId: account.threadsUserId };
}

function firstSentence(text: string): string {
  const m = text.trim().match(/^[^.!?]+[.!?]/);
  return (m ? m[0] : text.trim()).trim();
}

/**
 * Build the Threads post text (≤500 chars). Hook + 1-2 key points +
 * link + affiliate disclosure. Throws on compliance violation.
 *
 * Fitting rule: the link and the disclosure are mandatory and are
 * NEVER dropped to fit — the value text is trimmed first (points
 * dropped last-to-first, then the hook shortened word-by-word with
 * "…"). If even the product name + link + disclosure cannot fit,
 * this throws a validation error instead of posting a broken post.
 */
export function buildThreadsCopy(product: SocialProduct): string {
  if (!product.link) {
    throw new SocialPublishError("validation", "Threads post needs the product link.");
  }
  const name = product.name.trim() || "Ye product";
  const desc = product.description?.trim() ?? "";
  const feats = (product.features ?? []).filter(Boolean).slice(0, 2);
  const hook =
    feats[0] ?? (desc ? firstSentence(desc) : "Roz ke kaam ki useful product.");
  const points = [...feats.slice(1)];
  if (points.length < 2 && desc) {
    for (const s of desc.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)) {
      if (points.length >= 2) break;
      if (firstSentence(desc) === s && !feats[0]) continue;
      points.push(s);
    }
  }
  if (points.length === 0) points.push("Seedha point: kaam ki cheez, bina extra bakwaas.");

  const tail = `Details: ${product.link}`;
  const mandatory = `${name}\n\n${tail}\n\n${withDisclosure("")}`.length;
  if (mandatory > THREADS_TEXT_MAX) {
    throw new SocialPublishError(
      "validation",
      `Threads post cannot fit in ${THREADS_TEXT_MAX} chars: product name + link + disclosure alone are ${mandatory} chars — shorten the product name or link.`
    );
  }
  // Value text shrinks to fit; the tail (link + disclosure) never does.
  let value = `${name} — ${hook}`;
  const kept: string[] = [...points];
  let text = withDisclosure(`${value}\n${kept.join("\n")}\n\n${tail}`);
  while (text.length > THREADS_TEXT_MAX && kept.length > 0) {
    kept.pop();
    text = withDisclosure(`${value}\n${kept.join("\n")}\n\n${tail}`);
  }
  while (text.length > THREADS_TEXT_MAX) {
    const words = value.split(/\s+/);
    if (words.length <= 2) break; // name + one word is the floor; tail alone fits (checked above)
    words.pop();
    value = `${words.join(" ")}…`;
    text = withDisclosure(`${value}\n${kept.join("\n")}\n\n${tail}`);
  }
  assertCleanCopy(text, "threads");
  if (text.length > THREADS_TEXT_MAX) {
    throw new SocialPublishError(
      "validation",
      `Threads post is ${text.length} chars (max ${THREADS_TEXT_MAX}) even after trimming — shorten the product name or link.`
    );
  }
  return text;
}

export interface ThreadsPublishResult {
  postId: string;
}

export async function createThreadsPost(
  product: SocialProduct,
  opts?: {
    token?: string;
    threadsUserId?: string;
    fetchFn?: typeof fetch;
  }
): Promise<ThreadsPublishResult> {
  const token = opts?.token ?? process.env.THREADS_ACCESS_TOKEN ?? "";
  if (!token) throw notConfigured("THREADS_ACCESS_TOKEN");
  const threadsUserId = opts?.threadsUserId ?? process.env.THREADS_USER_ID ?? "";
  if (!threadsUserId) throw notConfigured("THREADS_USER_ID");
  const text = buildThreadsCopy(product);
  const doFetch = opts?.fetchFn ?? fetch;

  const call = async (url: string, body: Record<string, unknown>): Promise<{ id: string }> => {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new SocialPublishError(
        "upstream",
        `Threads request failed: ${err instanceof Error ? err.message : String(err)}`,
        true
      );
    }
    if (res.status === 429) {
      throw new SocialPublishError("rate_limited", "Threads rate limit hit (429) — retry later.", true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SocialPublishError(
        "auth",
        `Threads auth failed (${res.status}) — token invalid/expired or threads_content_publish not granted.`
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "").then((t) => t.slice(0, 300));
      throw new SocialPublishError("submit_failed", `Threads post failed (${res.status}): ${detail}`);
    }
    const parsed = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (!parsed || typeof parsed.id !== "string" || !parsed.id) {
      throw new SocialPublishError(
        "submit_failed",
        "Threads returned no id — treated as failure, not success."
      );
    }
    return { id: parsed.id };
  };

  // Step 1: create the container.
  const container = await call(`${THREADS_BASE}/${threadsUserId}/threads`, {
    media_type: "TEXT",
    text,
  });
  // Step 2: publish it. A container that never publishes is a failure.
  const post = await call(
    `${THREADS_BASE}/${threadsUserId}/threads_publish?creation_id=${encodeURIComponent(container.id)}`,
    {}
  );
  return { postId: post.id };
}
