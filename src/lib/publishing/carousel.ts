/**
 * Instagram carousels via the Graph API (v21.0).
 *
 * Flow: one image container per image (is_carousel_item=true) -> one
 * CAROUSEL container with the item ids as children -> publish it.
 * Images must be PUBLIC URLs (the brain resolves pack PNGs through
 * GET /api/v1/digital/files/...). 2-10 images; caption max 2200 chars.
 * Never fakes a publish: any step failing throws with the step + the
 * API's own error message. One retry only when the publish call says
 * the container is not ready yet (transient).
 */
export type FetchFn = typeof fetch;

export class CarouselError extends Error {
  step: string;
  constructor(step: string, message: string) {
    super(`${step}: ${message}`);
    this.step = step;
  }
}

const API_BASE = "https://graph.facebook.com/v21.0";

async function postJson(
  fetchFn: FetchFn,
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { ok: res.ok, status: res.status, json };
}

function apiError(json: Record<string, unknown>, fallback: string): string {
  const err = json.error as { message?: string; code?: number } | undefined;
  if (err?.message) return `${err.message}${err.code ? ` (code ${err.code})` : ""}`;
  return fallback;
}

export interface CarouselDeps {
  fetchFn?: FetchFn;
  igUserId: string;
  accessToken: string;
  apiBase?: string;
}

export async function createCarousel(
  imageUrls: string[],
  caption: string,
  deps: CarouselDeps
): Promise<{ mediaId: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const base = (deps.apiBase ?? API_BASE).replace(/\/$/, "");
  if (!deps.igUserId || !deps.accessToken) {
    throw new CarouselError("config", "IG_USER_ID ya IG_ACCESS_TOKEN set nahi hai.");
  }
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new CarouselError("validate", `Carousel ke liye 2-10 images chahiye (mile: ${imageUrls.length}).`);
  }
  for (const u of imageUrls) {
    if (!/^https?:\/\//.test(u)) throw new CarouselError("validate", `Image URL public http(s) honi chahiye: ${u.slice(0, 60)}`);
  }
  const cleanCaption = caption.slice(0, 2200);

  const itemIds: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const r = await postJson(fetchFn, `${base}/${deps.igUserId}/media`, {
      image_url: imageUrls[i],
      is_carousel_item: true,
      access_token: deps.accessToken,
    });
    const id = typeof r.json.id === "string" ? r.json.id : "";
    if (!r.ok || !id) throw new CarouselError(`item-${i + 1}`, apiError(r.json, `HTTP ${r.status}`));
    itemIds.push(id);
  }

  const car = await postJson(fetchFn, `${base}/${deps.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: itemIds,
    caption: cleanCaption,
    access_token: deps.accessToken,
  });
  const carouselId = typeof car.json.id === "string" ? car.json.id : "";
  if (!car.ok || !carouselId) throw new CarouselError("carousel-container", apiError(car.json, `HTTP ${car.status}`));

  for (let attempt = 0; attempt < 2; attempt++) {
    const pub = await postJson(fetchFn, `${base}/${deps.igUserId}/media_publish`, {
      creation_id: carouselId,
      access_token: deps.accessToken,
    });
    const mediaId = typeof pub.json.id === "string" ? pub.json.id : "";
    if (pub.ok && mediaId) return { mediaId };
    const msg = apiError(pub.json, `HTTP ${pub.status}`);
    const notReady = /not ready|processing|9007/i.test(msg);
    if (notReady && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      continue;
    }
    throw new CarouselError("publish", msg);
  }
  throw new CarouselError("publish", "Publish retry ke baad bhi fail hua.");
}
