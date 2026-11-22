/**
 * Reddit publisher tests: refresh-then-submit (mocked fetch), refresh
 * failure, submit failure (Reddit error surfaced), missing env, text post.
 * Run: npx tsx scripts/test-publishing-reddit.ts
 */
import {
  buildRedditCopy,
  createRedditPost,
  normalizeSubreddit,
  refreshRedditToken,
} from "../src/lib/publishing/reddit";
import { SocialPublishError } from "../src/lib/publishing/social-copy";

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

const ENV_KEYS = [
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_REFRESH_TOKEN",
  "REDDIT_USERNAME",
  "REDDIT_SUBREDDIT",
] as const;

function setEnv(vars: Partial<Record<string, string | undefined>>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) {
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

const FULL_ENV = {
  REDDIT_CLIENT_ID: "cid123",
  REDDIT_CLIENT_SECRET: "csecret123",
  REDDIT_REFRESH_TOKEN: "refresh123",
  REDDIT_USERNAME: "testuser",
  REDDIT_SUBREDDIT: "gadgets",
};

const product = {
  name: "Steel Tiffin Box",
  category: "kitchen",
  link: "https://example.com/tiffin",
  imageUrl: "https://example.com/tiffin.jpg",
  description: "Leak-proof steel tiffin.",
  features: ["3 compartments", "steel body"],
};

interface Call {
  url: string;
  method: string;
  auth: string;
  ua: string;
  body: string;
}

function stubFetch(handlers: {
  refresh?: (call: Call) => Response;
  submit?: (call: Call) => Response;
}): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(url),
      method: String(init?.method ?? "GET"),
      auth: headers.get("Authorization") ?? "",
      ua: headers.get("User-Agent") ?? "",
      body: String(init?.body ?? ""),
    };
    calls.push(call);
    if (call.url.includes("reddit.com/api/v1/access_token")) {
      return (
        handlers.refresh ??
        (() =>
          new Response(
            JSON.stringify({ access_token: "tok123", token_type: "bearer", expires_in: 3600, scope: "submit" }),
            { status: 200 }
          ))
      )(call);
    }
    if (call.url.includes("oauth.reddit.com/api/submit")) {
      return (
        handlers.submit ??
        (() =>
          new Response(
            JSON.stringify({
              json: {
                errors: [],
                data: {
                  id: "abc123",
                  name: "t3_abc123",
                  url: "https://www.reddit.com/r/gadgets/comments/abc123/steel_tiffin_box/",
                },
              },
            }),
            { status: 200 }
          ))
      )(call);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function main() {
  // ---------- copy builder ----------
  {
    const copy = buildRedditCopy(product, "link");
    check("reddit: link title has name + disclosure marker", copy.title.includes("Steel Tiffin Box") && copy.title.includes("(affiliate link)"), copy.title);
    check("reddit: link title within 300 chars", copy.title.length <= 300, `${copy.title.length}`);
    check("reddit: link copy has no text body", copy.text === undefined);
  }
  {
    const copy = buildRedditCopy(product, "text");
    check("reddit: text copy has disclosure", (copy.text ?? "").includes("Affiliate link"), (copy.text ?? "").slice(0, 80));
    check("reddit: text copy has product link", (copy.text ?? "").includes(product.link));
  }
  {
    // Link posts only carry the title — a price in the title is blocked.
    try {
      buildRedditCopy({ ...product, name: "Tiffin sirf ₹499 me" }, "link");
      check("reddit: price in title blocked", false);
    } catch {
      check("reddit: price in title blocked", true);
    }
    // Text posts carry the description — a price there is blocked too.
    try {
      buildRedditCopy({ ...product, description: "Sirf ₹499 me pao!" }, "text");
      check("reddit: price in text body blocked", false);
    } catch {
      check("reddit: price in text body blocked", true);
    }
  }
  {
    const long = buildRedditCopy({ ...product, name: "X".repeat(500) }, "link");
    check("reddit: long name truncated to 300", long.title.length <= 300, `${long.title.length}`);
  }
  {
    check("reddit: subreddit r/ prefix stripped", normalizeSubreddit("r/gadgets") === "gadgets");
    try {
      normalizeSubreddit("not a subreddit!!");
      check("reddit: invalid subreddit rejected", false);
    } catch (e) {
      check("reddit: invalid subreddit rejected", e instanceof SocialPublishError && e.code === "validation");
    }
  }

  // ---------- refresh-then-submit success (link) ----------
  {
    const restore = setEnv(FULL_ENV);
    try {
      const { fetchFn, calls } = stubFetch({});
      const r = await createRedditPost(product, { fetchFn });
      check("reddit: refresh called first (Basic auth + grant_type)", calls.length === 2 && calls[0].url.includes("/api/v1/access_token") && calls[0].auth.startsWith("Basic ") && calls[0].body.includes("grant_type=refresh_token"), JSON.stringify(calls.map((c) => c.url)));
      const submit = calls[1];
      const form = new URLSearchParams(submit.body);
      check("reddit: submit uses Bearer + descriptive UA", submit.auth === "Bearer tok123" && submit.ua.includes("by /u/testuser"), submit.ua);
      check("reddit: submit is a link post to the subreddit", form.get("kind") === "link" && form.get("sr") === "gadgets" && form.get("url") === product.link, submit.body.slice(0, 120));
      check("reddit: returns post id + url", r.postId === "t3_abc123" && r.url.startsWith("https://www.reddit.com/"), `${r.postId} ${r.url}`);
    } finally {
      restore();
    }
  }

  // ---------- refresh failure ----------
  {
    const restore = setEnv(FULL_ENV);
    try {
      const { fetchFn } = stubFetch({
        refresh: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      });
      try {
        await createRedditPost(product, { fetchFn });
        check("reddit: refresh 400 → token_refresh_failed", false);
      } catch (e) {
        check(
          "reddit: refresh 400 → token_refresh_failed",
          e instanceof SocialPublishError && e.code === "token_refresh_failed" && e.message.includes("invalid_grant"),
          e instanceof Error ? e.message : String(e)
        );
      }
    } finally {
      restore();
    }
  }

  // ---------- submit failure (Reddit error surfaced) ----------
  {
    const restore = setEnv(FULL_ENV);
    try {
      const { fetchFn } = stubFetch({
        submit: () =>
          new Response(
            JSON.stringify({
              json: {
                errors: [["RATELIMIT", "you are doing that too much. try again in 5 minutes.", "ratelimit"]],
                data: {},
              },
            }),
            { status: 200 }
          ),
      });
      try {
        await createRedditPost(product, { fetchFn });
        check("reddit: RATELIMIT error surfaced as submit_failed", false);
      } catch (e) {
        check(
          "reddit: RATELIMIT error surfaced as submit_failed",
          e instanceof SocialPublishError && e.code === "submit_failed" && e.message.includes("RATELIMIT"),
          e instanceof Error ? e.message : String(e)
        );
      }
    } finally {
      restore();
    }
  }

  // ---------- submit HTTP failure ----------
  {
    const restore = setEnv(FULL_ENV);
    try {
      const { fetchFn } = stubFetch({
        submit: () => new Response("forbidden", { status: 403 }),
      });
      try {
        await createRedditPost(product, { fetchFn });
        check("reddit: submit 403 → auth error", false);
      } catch (e) {
        check("reddit: submit 403 → auth error", e instanceof SocialPublishError && e.code === "auth");
      }
    } finally {
      restore();
    }
  }

  // ---------- missing env ----------
  {
    const restore = setEnv({});
    try {
      const { fetchFn } = stubFetch({});
      try {
        await createRedditPost(product, { fetchFn });
        check("reddit: missing env → not_configured", false);
      } catch (e) {
        check("reddit: missing env → not_configured", e instanceof SocialPublishError && e.code === "not_configured");
      }
    } finally {
      restore();
    }
  }

  // ---------- missing refresh token only ----------
  {
    const restore = setEnv({ ...FULL_ENV, REDDIT_REFRESH_TOKEN: undefined });
    try {
      const { fetchFn } = stubFetch({});
      try {
        await createRedditPost(product, { fetchFn });
        check("reddit: missing refresh token → token_missing", false);
      } catch (e) {
        check("reddit: missing refresh token → token_missing", e instanceof SocialPublishError && e.code === "token_missing");
      }
    } finally {
      restore();
    }
  }

  // ---------- text post path ----------
  {
    const restore = setEnv(FULL_ENV);
    try {
      const { fetchFn, calls } = stubFetch({});
      const r = await createRedditPost(product, { kind: "text", fetchFn });
      const form = new URLSearchParams(calls[1].body);
      check("reddit: text post kind=self with body, no url param", form.get("kind") === "self" && (form.get("text") ?? "").includes(product.link) && form.get("url") === null, calls[1].body.slice(0, 140));
      check("reddit: text post returns post id", r.postId === "t3_abc123");
    } finally {
      restore();
    }
  }

  // ---------- refresh helper directly ----------
  {
    const { fetchFn, calls } = stubFetch({});
    const token = await refreshRedditToken({
      clientId: "cid123",
      clientSecret: "csecret123",
      refreshToken: "refresh123",
      username: "testuser",
      fetchFn,
    });
    check("reddit: refresh helper returns access token", token === "tok123");
    check("reddit: refresh uses reddit.com token endpoint", calls[0].url === "https://www.reddit.com/api/v1/access_token");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch((err) => {
    console.error("FATAL", err);
    process.exit(1);
  });
