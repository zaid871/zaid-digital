/**
 * IG carousel tests: Graph API call sequence (item containers ->
 * CAROUSEL container -> publish), validation, and failure modes.
 * Run: npx tsx scripts/test-publishing-carousel.ts
 */
import { CarouselError, createCarousel, type FetchFn } from "../src/lib/publishing/carousel";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function main() {
  // --- Happy path: 3 images -> 3 item containers + carousel + publish ---
  {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let n = 0;
    const fetchFn = (async (url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      n += 1;
      const id = `id-${n}`;
      return { ok: true, status: 200, json: async () => ({ id }) } as unknown as Response;
    }) as unknown as FetchFn;
    const r = await createCarousel(
      ["https://example.com/a.png", "https://example.com/b.png", "https://example.com/c.png"],
      "Test carousel caption",
      { fetchFn, igUserId: "123", accessToken: "tok" }
    );
    check("carousel returns the publish media id", r.mediaId === "id-5", r.mediaId);
    check("3 item containers created with is_carousel_item", calls.slice(0, 3).every((c) => c.body.is_carousel_item === true && typeof c.body.image_url === "string"), JSON.stringify(calls.slice(0, 3).map((c) => c.body)));
    check("carousel container has media_type CAROUSEL + children", calls[3].body.media_type === "CAROUSEL" && JSON.stringify(calls[3].body.children) === JSON.stringify(["id-1", "id-2", "id-3"]), JSON.stringify(calls[3].body));
    check("carousel container carries the caption", calls[3].body.caption === "Test carousel caption");
    check("publish called with the carousel creation id", calls[4].url.endsWith("/media_publish") && calls[4].body.creation_id === "id-4", JSON.stringify(calls[4]));
    check("all calls go to the IG user media endpoint", calls.every((c) => c.url.includes("graph.facebook.com/v21.0/123/media")), calls.map((c) => c.url).join(","));
  }

  // --- Validation ---
  {
    const never = (async () => {
      throw new Error("must not be called");
    }) as unknown as FetchFn;
    try {
      await createCarousel(["https://example.com/a.png"], "x", { fetchFn: never, igUserId: "1", accessToken: "t" });
      check("1 image is rejected", false);
    } catch (e) {
      check("1 image is rejected", e instanceof CarouselError && e.step === "validate", String(e));
    }
    try {
      await createCarousel(["https://example.com/a.png", "not-a-url"], "x", { fetchFn: never, igUserId: "1", accessToken: "t" });
      check("non-public URL is rejected", false);
    } catch (e) {
      check("non-public URL is rejected", e instanceof CarouselError && e.step === "validate", String(e));
    }
    try {
      await createCarousel(["https://example.com/a.png", "https://example.com/b.png"], "x", { fetchFn: never, igUserId: "", accessToken: "" });
      check("missing creds are rejected", false);
    } catch (e) {
      check("missing creds are rejected", e instanceof CarouselError && e.step === "config", String(e));
    }
  }

  // --- Failure modes ---
  {
    const failItem = (async () => {
      return { ok: false, status: 400, json: async () => ({ error: { message: "Invalid image URL", code: 100 } }) } as unknown as Response;
    }) as unknown as FetchFn;
    try {
      await createCarousel(["https://example.com/a.png", "https://example.com/b.png"], "x", { fetchFn: failItem, igUserId: "1", accessToken: "t" });
      check("item failure throws with the step", false);
    } catch (e) {
      check("item failure throws with the step", e instanceof CarouselError && e.step === "item-1" && String(e).includes("Invalid image URL"), String(e));
    }
  }
  {
    // Publish says "not ready" once, then succeeds on retry.
    let pubCalls = 0;
    const fetchFn = (async (url: unknown) => {
      if (String(url).endsWith("/media_publish")) {
        pubCalls += 1;
        if (pubCalls === 1) {
          return { ok: false, status: 400, json: async () => ({ error: { message: "Media is not ready", code: 9007 } }) } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ id: "pub-1" }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: "c-1" }) } as unknown as Response;
    }) as unknown as FetchFn;
    const started = Date.now();
    const r = await createCarousel(["https://example.com/a.png", "https://example.com/b.png"], "x", { fetchFn, igUserId: "1", accessToken: "t" });
    check("publish retries once when not ready", r.mediaId === "pub-1" && pubCalls === 2, `mediaId=${r.mediaId} pubCalls=${pubCalls}`);
    check("retry waited ~10s", Date.now() - started >= 9000, `${Date.now() - started}ms`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL PUBLISHING-CAROUSEL TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
