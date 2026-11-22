/**
 * LinkedIn Posts API publisher (free).
 *
 * POST https://api.linkedin.com/rest/posts — text post on the authenticated
 * member's own profile. Auth: OAuth 3-legged, "Share on LinkedIn" product,
 * scope w_member_social (self-serve, no review for own profile).
 * Headers: Linkedin-Version (YYYYMM), X-Restli-Protocol-Version: 2.0.0.
 *
 * The `commentary` field uses LinkedIn's "little text" format: the 15
 * reserved characters \ | { } @ [ ] ( ) < > # * _ ~ MUST be escaped with a
 * backslash or the post is truncated/rejected. escapeLittleText() does it.
 *
 * Honest limits: 150 requests/member/day; tokens last ~60 days; a bare URL
 * in commentary posts as clickable text (no preview card — cards need an
 * uploaded thumbnail via the Images API, not built here).
 */
import {
  assertCleanCopy,
  notConfigured,
  withDisclosure,
  SocialPublishError,
  type SocialProduct,
} from "./social-copy";

/** The 15 little-text reserved characters (LinkedIn docs). */
const RESERVED = new Set(["\\", "|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "*", "_", "~"]);

/** Escape little-text reserved characters with a backslash. */
export function escapeLittleText(text: string): string {
  let out = "";
  for (const ch of text) {
    out += RESERVED.has(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/** Build the post commentary (≤3000 chars). Throws on compliance violation. */
export function buildLinkedInCopy(product: SocialProduct): string {
  const feats = (product.features ?? []).filter(Boolean).slice(0, 3);
  const lines = [
    `${product.name}`,
    "",
    product.description?.trim() ||
      "Roz ke kaam ki ek useful product — maine iske features check kiye hain.",
    feats.length > 0 ? `Khaasiyat: ${feats.join(" | ")}` : "",
    "",
    `Details yahan: ${product.link}`,
  ].filter((l) => l !== "");
  const commentary = withDisclosure(lines.join("\n"));
  assertCleanCopy(commentary, "linkedin");
  if (commentary.length > 3000) {
    throw new SocialPublishError(
      "validation",
      `LinkedIn commentary is ${commentary.length} chars (max 3000).`
    );
  }
  return commentary;
}

export interface LinkedInPublishResult {
  postId: string;
}

export async function createTextPost(
  product: SocialProduct,
  opts?: {
    token?: string;
    authorUrn?: string;
    version?: string;
    fetchFn?: typeof fetch;
  }
): Promise<LinkedInPublishResult> {
  const token = opts?.token ?? process.env.LINKEDIN_ACCESS_TOKEN ?? "";
  if (!token) throw notConfigured("LINKEDIN_ACCESS_TOKEN");
  const authorUrn = opts?.authorUrn ?? process.env.LINKEDIN_AUTHOR_URN ?? "";
  if (!authorUrn || !/^urn:li:person:.+/.test(authorUrn)) {
    throw notConfigured("LINKEDIN_AUTHOR_URN (format urn:li:person:<id>)");
  }
  if (!product.link) {
    throw new SocialPublishError("validation", "LinkedIn post needs the product link.");
  }
  const commentary = escapeLittleText(buildLinkedInCopy(product));
  const version = opts?.version ?? process.env.LINKEDIN_VERSION ?? "202610";
  const doFetch = opts?.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await doFetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Linkedin-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: authorUrn,
        commentary,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SocialPublishError(
      "upstream",
      `LinkedIn request failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
  if (res.status === 429) {
    throw new SocialPublishError("rate_limited", "LinkedIn rate limit hit (429) — retry later.", true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SocialPublishError(
      "auth",
      `LinkedIn auth failed (${res.status}) — token invalid/expired or w_member_social not granted.`
    );
  }
  if (res.status !== 201) {
    const detail = await res.text().catch(() => "").then((t) => t.slice(0, 300));
    throw new SocialPublishError("upstream", `LinkedIn post failed (${res.status}): ${detail}`);
  }
  const postId = res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id") ?? "";
  if (!postId) {
    throw new SocialPublishError(
      "upstream",
      "LinkedIn returned 201 but no post id header — treated as failure, not success."
    );
  }
  return { postId };
}
