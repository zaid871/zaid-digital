/**
 * Pinterest API v5 publisher (free).
 *
 * POST https://api.pinterest.com/v5/pins — image pin from a public URL.
 * Auth: Bearer PINTEREST_ACCESS_TOKEN (OAuth, scopes boards:read,
 * boards:write, pins:read, pins:write). Every pin needs a board_id.
 *
 * Honest limits: new apps start on Trial access (pins visible only to you,
 * 1,000 req/day) until Standard access is granted (needs an OAuth-flow
 * demo). Business account required.
 */
import {
  assertCleanCopy,
  notConfigured,
  withDisclosure,
  SocialPublishError,
  type SocialProduct,
} from "./social-copy";

export interface PinterestPinCopy {
  title: string;
  description: string;
}

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 800;

/** Build pin copy from a product. Throws on compliance violation. */
export function buildPinCopy(product: SocialProduct): PinterestPinCopy {
  const feats = (product.features ?? []).filter(Boolean).slice(0, 4);
  const lines = [
    product.description?.trim() || `${product.name} — roz ke kaam ki useful cheez.`,
    feats.length > 0 ? `Khaasiyat: ${feats.join(", ")}.` : "",
  ].filter(Boolean);
  const description = withDisclosure(lines.join("\n"));
  const title = product.name.trim().slice(0, TITLE_MAX) || "Product";
  assertCleanCopy(`${title}\n${description}`, "pinterest");
  if (description.length > DESCRIPTION_MAX) {
    throw new SocialPublishError(
      "validation",
      `Pinterest description is ${description.length} chars (max ${DESCRIPTION_MAX}) — shorten the product description.`
    );
  }
  return { title, description };
}

export interface PinterestPublishResult {
  pinId: string;
}

export async function createImagePin(
  product: SocialProduct,
  opts?: {
    token?: string;
    boardId?: string;
    fetchFn?: typeof fetch;
  }
): Promise<PinterestPublishResult> {
  const token = opts?.token ?? process.env.PINTEREST_ACCESS_TOKEN ?? "";
  if (!token) throw notConfigured("PINTEREST_ACCESS_TOKEN");
  const boardId = opts?.boardId ?? process.env.PINTEREST_BOARD_ID ?? "";
  if (!boardId) throw notConfigured("PINTEREST_BOARD_ID");
  if (!product.imageUrl) {
    throw new SocialPublishError(
      "validation",
      "Pinterest needs a public image URL — none supplied for this product."
    );
  }
  if (!product.link) {
    throw new SocialPublishError("validation", "Pinterest pin needs a destination link.");
  }
  const copy = buildPinCopy(product);
  const doFetch = opts?.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await doFetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        board_id: boardId,
        title: copy.title,
        description: copy.description,
        link: product.link,
        media_source: { source_type: "image_url", url: product.imageUrl },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SocialPublishError(
      "upstream",
      `Pinterest request failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
  if (res.status === 429) {
    throw new SocialPublishError("rate_limited", "Pinterest rate limit hit (429) — retry later.", true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SocialPublishError(
      "auth",
      `Pinterest auth failed (${res.status}) — token invalid/expired or Trial access not granted.`
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "").then((t) => t.slice(0, 300));
    throw new SocialPublishError("upstream", `Pinterest pin failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) {
    throw new SocialPublishError("upstream", "Pinterest returned no pin id — treated as failure, not success.");
  }
  return { pinId: body.id };
}
