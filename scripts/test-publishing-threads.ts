/**
 * Threads publisher tests: copy builder (500-char cap, compliance) +
 * createThreadsPost container-then-publish flow (stubbed fetch only —
 * no live Threads call, no token exists yet).
 * Run: npx tsx scripts/test-publishing-threads.ts
 */
import {
  buildThreadsCopy,
  createThreadsPost,
  resolveThreadsCredentials,
  THREADS_TEXT_MAX,
} from "../src/lib/publishing/threads";
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

const product = {
  name: "Steel Tiffin Box",
  category: "kitchen",
  link: "https://example.com/tiffin",
  description:
    "Leak-proof steel tiffin with three compartments. Keeps food warm for hours and fits easily in a school or office bag.",
  features: ["3 compartments", "steel body"],
};

type StubBehavior = {
  containerStatus?: number;
  containerBody?: unknown;
  publishStatus?: number;
  publishBody?: unknown;
};

function makeStub(behavior: StubBehavior = {}) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(String(init?.body ?? ""));
    if (String(url).includes("threads_publish")) {
      const status = behavior.publishStatus ?? 200;
      return new Response(JSON.stringify(behavior.publishBody ?? { id: "post123" }), { status });
    }
    const status = behavior.containerStatus ?? 200;
    return new Response(JSON.stringify(behavior.containerBody ?? { id: "container123" }), { status });
  }) as typeof fetch;
  return { fetchFn, urls, bodies };
}

async function main() {
  // ---------- copy builder ----------
  {
    const text = buildThreadsCopy(product);
    check("copy: has name + link + disclosure", text.includes(product.name) && text.includes(product.link) && text.includes("Affiliate link"));
    check("copy: within 500 chars", text.length <= THREADS_TEXT_MAX, `${text.length}`);
    check("copy: link is a full URL line", text.includes(`Details: ${product.link}`));
  }
  {
    const longDesc = "A".repeat(50) + ". " + "B".repeat(800) + ". " + "C".repeat(800) + ".";
    const text = buildThreadsCopy({ ...product, description: longDesc, features: ["x".repeat(200), "y".repeat(200)] });
    check("copy: long input trimmed to ≤500, link + disclosure kept", text.length <= THREADS_TEXT_MAX && text.includes(product.link) && text.includes("Affiliate link"), `${text.length}`);
  }
  {
    try {
      buildThreadsCopy({ ...product, description: "Sirf ₹499 me pao!" });
      check("copy: price in description blocked", false);
    } catch {
      check("copy: price in description blocked", true);
    }
  }
  {
    try {
      buildThreadsCopy({ ...product, features: ["guaranteed income in 7 days"] });
      check("copy: banned claim blocked", false);
    } catch {
      check("copy: banned claim blocked", true);
    }
  }
  {
    try {
      buildThreadsCopy({ ...product, link: "" });
      check("copy: missing link → validation", false);
    } catch (e) {
      check("copy: missing link → validation", e instanceof SocialPublishError && e.code === "validation");
    }
  }
  {
    // Name + link + disclosure alone over 500 → honest validation, no broken post.
    const huge = { ...product, name: "N".repeat(400), link: "https://example.com/" + "l".repeat(100) };
    try {
      buildThreadsCopy(huge);
      check("copy: un-fittable name+link → validation", false);
    } catch (e) {
      check("copy: un-fittable name+link → validation", e instanceof SocialPublishError && e.code === "validation");
    }
  }

  // ---------- happy path ----------
  {
    const { fetchFn, urls, bodies } = makeStub();
    const r = await createThreadsPost(product, { token: "t", threadsUserId: "u123", fetchFn });
    check("publish: returns post id", r.postId === "post123", r.postId);
    check("publish: container created first", urls[0] === "https://graph.threads.net/u123/threads", urls[0] ?? "");
    check("publish: publish called with container id", urls[1] === "https://graph.threads.net/u123/threads_publish?creation_id=container123", urls[1] ?? "");
    const sent = JSON.parse(bodies[0]) as { media_type?: string; text?: string };
    check("publish: container is a TEXT post with the copy", sent.media_type === "TEXT" && (sent.text ?? "").includes(product.link), JSON.stringify(sent).slice(0, 120));
  }

  // ---------- config / auth / rate limit ----------
  {
    const { fetchFn } = makeStub();
    try {
      await createThreadsPost(product, { token: "", threadsUserId: "u123", fetchFn });
      check("config: missing token → not_configured", false);
    } catch (e) {
      check("config: missing token → not_configured", e instanceof SocialPublishError && e.code === "not_configured");
    }
    try {
      await createThreadsPost(product, { token: "t", threadsUserId: "", fetchFn });
      check("config: missing user id → not_configured", false);
    } catch (e) {
      check("config: missing user id → not_configured", e instanceof SocialPublishError && e.code === "not_configured");
    }
  }
  {
    const { fetchFn } = makeStub({ containerStatus: 401 });
    try {
      await createThreadsPost(product, { token: "bad", threadsUserId: "u123", fetchFn });
      check("auth: 401 → auth error", false);
    } catch (e) {
      check("auth: 401 → auth error", e instanceof SocialPublishError && e.code === "auth");
    }
  }
  {
    const { fetchFn } = makeStub({ publishStatus: 429 });
    try {
      await createThreadsPost(product, { token: "t", threadsUserId: "u123", fetchFn });
      check("rate: 429 on publish → rate_limited", false);
    } catch (e) {
      check("rate: 429 on publish → rate_limited", e instanceof SocialPublishError && e.code === "rate_limited");
    }
  }

  // ---------- failures are never fake successes ----------
  {
    const { fetchFn, urls } = makeStub({ publishStatus: 500, publishBody: { error: { message: "publish failed" } } });
    try {
      await createThreadsPost(product, { token: "t", threadsUserId: "u123", fetchFn });
      check("fail: publish step 500 after container → submit_failed, not success", false);
    } catch (e) {
      check(
        "fail: publish step 500 after container → submit_failed, not success",
        e instanceof SocialPublishError && e.code === "submit_failed" && urls.length === 2
      );
    }
  }
  {
    const { fetchFn } = makeStub({ containerStatus: 500, containerBody: { error: { message: "bad container" } } });
    try {
      await createThreadsPost(product, { token: "t", threadsUserId: "u123", fetchFn });
      check("fail: container 500 → submit_failed with detail", false);
    } catch (e) {
      check(
        "fail: container 500 → submit_failed with detail",
        e instanceof SocialPublishError && e.code === "submit_failed" && e.message.includes("bad container")
      );
    }
  }
  {
    const { fetchFn } = makeStub({ containerBody: {} });
    try {
      await createThreadsPost(product, { token: "t", threadsUserId: "u123", fetchFn });
      check("fail: container with no id → submit_failed", false);
    } catch (e) {
      check("fail: container with no id → submit_failed", e instanceof SocialPublishError && e.code === "submit_failed");
    }
  }
  {
    const { fetchFn } = makeStub({ publishBody: {} });
    try {
      await createThreadsPost(product, { token: "t", threadsUserId: "u123", fetchFn });
      check("fail: publish with no id → submit_failed", false);
    } catch (e) {
      check("fail: publish with no id → submit_failed", e instanceof SocialPublishError && e.code === "submit_failed");
    }
  }

  // --- resolveThreadsCredentials: per-profile routing + default fallback ---
  {
    const env = {
      ACCOUNTS_JSON: JSON.stringify([
        { key: "tech", label: "Tech Finds", kind: "affiliate", niches: ["tech"], igUserId: "ig-tech", fbPageId: "fb-tech", threadsTokenEnv: "THREADS_ACCESS_TOKEN", threadsUserId: "th-tech" },
        { key: "ebooks", label: "Classic Books", kind: "digital", productTypes: ["ebook", "coloring_book"], igUserId: "ig-ebooks", fbPageId: "fb-ebooks", threadsUserId: "th-ebooks" },
        { key: "templates", label: "Crafted Pixels", kind: "digital", productTypes: ["template_pack", "website"], igUserId: "ig-templates", fbPageId: "fb-templates", threadsUserId: "th-templates" },
        { key: "spreadsheets", label: "Clear Budget Sheet", kind: "digital", productTypes: ["xlsx"], igUserId: "ig-sheets", fbPageId: "fb-sheets", threadsUserId: "th-sheets" },
        { key: "pod", label: "Printed Tshirts", kind: "digital", productTypes: ["pod", "pod_design"], igUserId: "ig-pod", fbPageId: "fb-pod" },
      ]),
      THREADS_ACCESS_TOKEN: "tok-default",
      THREADS_USER_ID: "th-tech",
      THREADS_ACCESS_TOKEN_EBOOKS: "tok-ebooks",
      THREADS_ACCESS_TOKEN_TEMPLATES: "tok-templates",
      THREADS_ACCESS_TOKEN_SPREADSHEETS: "tok-sheets",
    };
    const r1 = resolveThreadsCredentials("ebook", env);
    check("route: ebook -> ebooks profile", r1.token === "tok-ebooks" && r1.threadsUserId === "th-ebooks");
    const r2 = resolveThreadsCredentials("template_pack", env);
    check("route: template_pack -> templates profile", r2.token === "tok-templates" && r2.threadsUserId === "th-templates");
    const r3 = resolveThreadsCredentials("xlsx", env);
    check("route: xlsx -> spreadsheets profile", r3.token === "tok-sheets" && r3.threadsUserId === "th-sheets");
    const r4 = resolveThreadsCredentials("affiliate", env);
    check("route: affiliate -> default (tech) profile", r4.token === "tok-default" && r4.threadsUserId === "th-tech");
    const r5 = resolveThreadsCredentials("pod", env);
    check("route: pod (no Threads profile) -> default", r5.token === "tok-default" && r5.threadsUserId === "th-tech");
    // Account without Threads fields falls back to default, never throws.
    const envNoThreads = {
      ACCOUNTS_JSON: JSON.stringify([
        { key: "ebooks", label: "Classic Books", kind: "digital", productTypes: ["ebook"], igUserId: "ig-ebooks", fbPageId: "fb-ebooks" },
      ]),
      THREADS_ACCESS_TOKEN: "tok-default",
      THREADS_USER_ID: "th-tech",
    };
    const r6 = resolveThreadsCredentials("ebook", envNoThreads);
    check("route: account without Threads fields -> default", r6.token === "tok-default" && r6.threadsUserId === "th-tech");
    // Nothing configured anywhere -> empty (createThreadsPost throws notConfigured).
    const r7 = resolveThreadsCredentials("ebook", {});
    check("route: nothing configured -> empty", r7.token === "" && r7.threadsUserId === "");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch((err) => {
    console.error("FATAL", err);
    process.exit(1);
  });
