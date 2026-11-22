/**
 * Reddit publisher (free tier).
 *
 * Reddit access tokens last only 1 hour, so this module refreshes the
 * token on EVERY publish call: POST https://www.reddit.com/api/v1/access_token
 * (grant_type=refresh_token, HTTP Basic auth client_id:client_secret) using
 * REDDIT_REFRESH_TOKEN, then submits via POST https://oauth.reddit.com/api/submit.
 * Default is a link post (kind=link); text posts (kind=self) supported.
 * Reddit requires a descriptive User-Agent on every call.
 *
 * Copy is compliance-scanned like every other publisher (no prices, no
 * banned claims) and carries the affiliate disclosure — link-post titles
 * get the short "(affiliate link)" marker, text posts get the full
 * disclosure in the body.
 *
 * Honest limits: new/low-karma accounts get auto-removed by many
 * subreddits and each subreddit has its own self-promotion rules — a
 * "published" result means Reddit accepted the submission, not that it
 * survived moderation. No test post has been made yet (tokens pending).
 */
import {
  assertCleanCopy,
  notConfigured,
  withDisclosure,
  SocialPublishError,
  type SocialProduct,
} from "./social-copy";

export type RedditPostKind = "link" | "text";

const TITLE_MAX = 300;
const SUBREDDIT_RE = /^[A-Za-z0-9_]{3,21}$/;

/** Strip an optional "r/" prefix and validate the subreddit name. */
export function normalizeSubreddit(raw: string): string {
  const name = raw.trim().replace(/^r\//i, "");
  if (!SUBREDDIT_RE.test(name)) {
    throw new SocialPublishError(
      "validation",
      `Invalid subreddit "${raw.trim().slice(0, 40)}" — use the plain name, e.g. "gadgets".`
    );
  }
  return name;
}

/** Build the Reddit title + optional text body. Throws on compliance violation. */
export function buildRedditCopy(
  product: SocialProduct,
  kind: RedditPostKind
): { title: string; text?: string } {
  const disclosure = "(affiliate link)";
  // Keep room for the disclosure marker on link posts.
  const nameBudget = TITLE_MAX - disclosure.length - 1;
  const name = product.name.trim().slice(0, nameBudget) || "Useful product";
  const title = `${name} ${disclosure}`;
  if (kind === "link") {
    assertCleanCopy(title, "reddit");
    return { title };
  }
  if (!product.link) {
    throw new SocialPublishError("validation", "Reddit text post needs the product link.");
  }
  const feats = (product.features ?? []).filter(Boolean).slice(0, 3);
  const lines = [
    product.description?.trim() || "Roz ke kaam ki ek useful product — maine iske features check kiye hain.",
    feats.length > 0 ? `Khaasiyat: ${feats.join(" | ")}` : "",
    "",
    `Details yahan: ${product.link}`,
  ].filter((l) => l !== "");
  const text = withDisclosure(lines.join("\n"));
  assertCleanCopy(`${title}\n${text}`, "reddit");
  return { title, text };
}

export interface RedditPublishResult {
  postId: string;
  /** Full Reddit URL of the submitted post. */
  url: string;
}

export interface RedditPublishOpts {
  kind?: RedditPostKind;
  /** Target subreddit (plain name, "r/" prefix allowed); env REDDIT_SUBREDDIT fallback. */
  subreddit?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  username?: string;
  fetchFn?: typeof fetch;
}

function userAgent(username: string): string {
  return `web:ZaidDigital:1.0 (by /u/${username})`;
}

/**
 * Exchange the stored refresh token for a 1-hour access token.
 * Throws token_refresh_failed with Reddit's returned detail — never a fake token.
 */
export async function refreshRedditToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  username: string;
  fetchFn: typeof fetch;
}): Promise<string> {
  const { clientId, clientSecret, refreshToken, username, fetchFn } = opts;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let res: Response;
  try {
    res = await fetchFn("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent(username),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SocialPublishError(
      "token_refresh_failed",
      `Reddit token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "").then((t) => t.slice(0, 300));
    throw new SocialPublishError(
      "token_refresh_failed",
      `Reddit token refresh failed (${res.status}): ${detail || "no detail returned"}`,
      res.status >= 500 || res.status === 429
    );
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new SocialPublishError(
      "token_refresh_failed",
      "Reddit token refresh returned no access token — treated as failure, not success."
    );
  }
  return body.access_token;
}

/**
 * Submit a Reddit post. Refreshes the access token on every call (tokens
 * last 1 hour). Returns the post id + URL only when Reddit accepted it.
 */
export async function createRedditPost(
  product: SocialProduct,
  opts?: RedditPublishOpts
): Promise<RedditPublishResult> {
  const clientId = opts?.clientId ?? process.env.REDDIT_CLIENT_ID ?? "";
  if (!clientId) throw notConfigured("REDDIT_CLIENT_ID");
  const clientSecret = opts?.clientSecret ?? process.env.REDDIT_CLIENT_SECRET ?? "";
  if (!clientSecret) throw notConfigured("REDDIT_CLIENT_SECRET");
  const refreshToken = opts?.refreshToken ?? process.env.REDDIT_REFRESH_TOKEN ?? "";
  if (!refreshToken) {
    throw new SocialPublishError(
      "token_missing",
      "REDDIT_REFRESH_TOKEN is not configured — run the Reddit OAuth flow once and store the refresh token; nothing was published."
    );
  }
  const username = opts?.username ?? process.env.REDDIT_USERNAME ?? "";
  if (!username) throw notConfigured("REDDIT_USERNAME");
  const subredditRaw = opts?.subreddit ?? process.env.REDDIT_SUBREDDIT ?? "";
  if (!subredditRaw.trim()) throw notConfigured("REDDIT_SUBREDDIT");
  const subreddit = normalizeSubreddit(subredditRaw);
  const kind: RedditPostKind = opts?.kind ?? "link";
  if (kind === "link" && !product.link) {
    throw new SocialPublishError("validation", "Reddit link post needs the product link.");
  }
  const copy = buildRedditCopy(product, kind);
  const doFetch = opts?.fetchFn ?? fetch;

  const accessToken = await refreshRedditToken({
    clientId,
    clientSecret,
    refreshToken,
    username,
    fetchFn: doFetch,
  });

  const form = new URLSearchParams({
    api_type: "json",
    // Reddit's API kind for a text post is "self", not "text".
    kind: kind === "link" ? "link" : "self",
    sr: subreddit,
    title: copy.title,
  });
  if (kind === "link") form.set("url", product.link);
  else form.set("text", copy.text ?? "");

  let res: Response;
  try {
    res = await doFetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent(username),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SocialPublishError(
      "upstream",
      `Reddit request failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
  if (res.status === 429) {
    throw new SocialPublishError("rate_limited", "Reddit rate limit hit (429) — retry later.", true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SocialPublishError(
      "auth",
      `Reddit auth failed (${res.status}) — refreshed token rejected; re-run the OAuth flow.`
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "").then((t) => t.slice(0, 300));
    throw new SocialPublishError("submit_failed", `Reddit submit failed (${res.status}): ${detail || "no detail returned"}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    json?: { errors?: Array<[string, string, string?]>; data?: { id?: unknown; name?: unknown; url?: unknown } };
  };
  const errors = body.json?.errors ?? [];
  if (errors.length > 0) {
    const [code, message] = errors[0];
    throw new SocialPublishError(
      "submit_failed",
      `Reddit rejected the post (${code}): ${message || "no detail returned"}`.slice(0, 400)
    );
  }
  const data = body.json?.data ?? {};
  const postId = typeof data.name === "string" && data.name ? data.name : typeof data.id === "string" ? data.id : "";
  if (!postId) {
    throw new SocialPublishError(
      "submit_failed",
      "Reddit returned no post id — treated as failure, not success."
    );
  }
  const url =
    typeof data.url === "string" && data.url
      ? data.url
      : `https://www.reddit.com/r/${subreddit}/comments/${String(data.id ?? postId).replace(/^t3_/, "")}/`;
  return { postId, url };
}
