/**
 * Intent-channel draft tests: Quora answer / Reddit draft / X thread
 * builders (pure functions — no fetch) + multiPublish draft routing
 * (stubbed fetch for the LinkedIn/Pinterest API lanes).
 * Run: npx tsx scripts/test-publishing-intent-drafts.ts
 */
import { multiPublish } from "../src/lib/publishing/multi-publish";
import {
  buildQuoraAnswer,
  buildRedditDraft,
  buildXThread,
  countXPost,
} from "../src/lib/publishing/intent-drafts";

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

const ebook = {
  name: "Freelance Client-Getting Playbook",
  category: "computers_ai_tools",
  link: "https://example.com/playbook",
  description:
    "A step-by-step playbook for freelancers who want steady clients without cold pitching. " +
    "Most freelancers rely on job boards and wait for work to come to them, which keeps income unpredictable month after month. " +
    "This playbook flips that: it shows how to position your service so clients come to you, which outreach messages actually get replies, and how to follow up without sounding desperate. " +
    "It covers positioning, outreach templates and follow-up systems that work even if you are just starting out and have no big portfolio yet.",
  features: ["30 outreach templates", "Follow-up system", "Pricing scripts"],
};
const QUESTION = "How can a freelancer get clients without cold pitching?";

async function main() {
  // ---------- Quora answer ----------
  {
    const { answer, wordCount } = buildQuoraAnswer(ebook, QUESTION);
    check("quora: direct answer opens with Short answer", answer.startsWith("Short answer:"));
    check("quora: carries the disclosure", answer.includes("Affiliate link"));
    check("quora: carries the product link", answer.includes(ebook.link));
    check("quora: mentions the checked features", answer.includes("30 outreach templates"));
    check("quora: word count in target range", wordCount >= 100 && wordCount <= 260, `words=${wordCount}`);
    check("quora: no price in answer", !/₹|\$|Rs\.?\s?\d/.test(answer));
  }
  {
    const { answer } = buildQuoraAnswer(ebook);
    check("quora: builds without a question", answer.length > 0 && answer.includes("Affiliate link"));
  }
  {
    try {
      buildQuoraAnswer({ ...ebook, description: "Sirf ₹499 me pao!" });
      check("quora: price in description blocked", false);
    } catch {
      check("quora: price in description blocked", true);
    }
  }
  {
    try {
      buildQuoraAnswer({ ...ebook, features: ["guaranteed income in 7 days"] });
      check("quora: banned claim blocked", false);
    } catch {
      check("quora: banned claim blocked", true);
    }
  }

  // ---------- Reddit draft ----------
  {
    const d = buildRedditDraft(ebook);
    check("reddit: missing subreddit → empty, never invented", d.subreddit === "" && d.title.length > 0 && d.text.length > 0, JSON.stringify(d.subreddit));
    check("reddit: title carries affiliate marker + ≤300 chars", d.title.includes("(affiliate link)") && d.title.length <= 300, `${d.title.length}`);
    check("reddit: body carries disclosure + link", d.text.includes("Affiliate link") && d.text.includes(ebook.link));
  }
  {
    check("reddit: plain subreddit kept", buildRedditDraft(ebook, "gadgets").subreddit === "gadgets");
    check("reddit: r/ prefix stripped", buildRedditDraft(ebook, "r/gadgets").subreddit === "gadgets");
    try {
      buildRedditDraft(ebook, "not a subreddit!!");
      check("reddit: invalid subreddit throws", false);
    } catch {
      check("reddit: invalid subreddit throws", true);
    }
  }
  {
    try {
      buildRedditDraft({ ...ebook, description: "Sirf ₹499 me pao!" });
      check("reddit: price in description blocked", false);
    } catch {
      check("reddit: price in description blocked", true);
    }
  }

  // ---------- X thread ----------
  {
    const thread = buildXThread(ebook, QUESTION);
    check("x thread: 3-5 posts", thread.length >= 3 && thread.length <= 5, `posts=${thread.length}`);
    check(
      "x thread: every post ≤280 (t.co counted)",
      thread.every((p, i) => countXPost(p, i === thread.length - 1 ? ebook.link : "") <= 280),
      thread.map((p, i) => countXPost(p, i === thread.length - 1 ? ebook.link : "")).join(",")
    );
    check("x thread: hook post carries the question", thread[0].includes(QUESTION));
    check(
      "x thread: middle posts summarise key points, not a teaser",
      thread.slice(1, -1).every((p) => ebook.features.some((f) => p.includes(f))),
      thread.slice(1, -1).join(" | ")
    );
    const last = thread[thread.length - 1];
    check("x thread: last post carries link + disclosure", last.includes(ebook.link) && last.includes("(affiliate link)"));
  }
  {
    const thread = buildXThread(ebook);
    check("x thread: builds without a question", thread.length >= 3 && thread.length <= 5, `posts=${thread.length}`);
    check(
      "x thread: no-question thread still within limits",
      thread.every((p, i) => countXPost(p, i === thread.length - 1 ? ebook.link : "") <= 280)
    );
  }
  {
    try {
      buildXThread({ ...ebook, features: ["sirf ₹499 me"] });
      check("x thread: price in feature blocked", false);
    } catch {
      check("x thread: price in feature blocked", true);
    }
  }

  // ---------- multiPublish draft routing (stubbed API lanes) ----------
  const calledUrls: string[] = [];
  const stubFetch = (async (url: unknown) => {
    calledUrls.push(String(url));
    if (String(url).includes("pinterest")) {
      return new Response(JSON.stringify({ id: "pin1" }), { status: 201 });
    }
    if (String(url).includes("graph.threads.net")) {
      const id = String(url).includes("threads_publish") ? "post1" : "container1";
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
  }) as typeof fetch;
  process.env.PINTEREST_ACCESS_TOKEN = "t";
  process.env.PINTEREST_BOARD_ID = "b";
  process.env.LINKEDIN_ACCESS_TOKEN = "t";
  process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:abc";
  try {
    const { results } = await multiPublish(ebook, ["quora", "reddit", "x", "linkedin"], {
      fetchFn: stubFetch,
      subreddit: "gadgets",
      question: QUESTION,
    });
    const by = new Map(results.map((r) => [r.platform, r]));
    check("router: quora is a draft, never published", by.get("quora")?.status === "draft", by.get("quora")?.status ?? "missing");
    check("router: quora draft carries the answer", (by.get("quora")?.text ?? "").includes("Short answer"));
    check("router: reddit is a draft, never published", by.get("reddit")?.status === "draft", by.get("reddit")?.status ?? "missing");
    check("router: reddit draft has title + subreddit", (by.get("reddit")?.title ?? "").length > 0 && by.get("reddit")?.subreddit === "gadgets");
    check("router: x is a draft thread", by.get("x")?.status === "draft" && (by.get("x")?.text ?? "").includes(ebook.link));
    check("router: linkedin still auto-publishes", by.get("linkedin")?.status === "published", by.get("linkedin")?.status ?? "missing");
    check("router: no Reddit API call was made", !calledUrls.some((u) => u.includes("reddit.com")), calledUrls.join(","));
  } finally {
    delete process.env.PINTEREST_ACCESS_TOKEN;
    delete process.env.PINTEREST_BOARD_ID;
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_AUTHOR_URN;
  }
  {
    // Auto-route: manual lanes (quora + x) join as drafts; reddit stays
    // explicit-only; linkedin + threads auto-publish; pinterest skipped (low fit).
    process.env.LINKEDIN_ACCESS_TOKEN = "t";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:abc";
    process.env.THREADS_ACCESS_TOKEN = "t";
    process.env.THREADS_USER_ID = "u123";
    try {
      const { results } = await multiPublish(ebook, undefined, {
        fetchFn: stubFetch,
        question: QUESTION,
      });
      const by = new Map(results.map((r) => [r.platform, r]));
      check("router auto: quora draft included", by.get("quora")?.status === "draft", by.get("quora")?.status ?? "missing");
      check("router auto: x draft included", by.get("x")?.status === "draft", by.get("x")?.status ?? "missing");
      check("router auto: reddit NOT auto-included (explicit-only)", !by.has("reddit"));
      check("router auto: pinterest absent (low fit, not auto-selected)", !by.has("pinterest"));
      check("router auto: linkedin published", by.get("linkedin")?.status === "published", by.get("linkedin")?.status ?? "missing");
      check("router auto: threads published", by.get("threads")?.status === "published" && by.get("threads")?.id === "post1", by.get("threads")?.status ?? "missing");
    } finally {
      delete process.env.LINKEDIN_ACCESS_TOKEN;
      delete process.env.LINKEDIN_AUTHOR_URN;
      delete process.env.THREADS_ACCESS_TOKEN;
      delete process.env.THREADS_USER_ID;
    }
  }
  {
    // Explicitly requested low-fit platform → skipped with a reason.
    const { results } = await multiPublish(ebook, ["pinterest"], { fetchFn: stubFetch });
    check("router: explicit low-fit platform skipped", results[0]?.status === "skipped" && (results[0]?.reason ?? "").includes("Low fit"), JSON.stringify(results[0]));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch((err) => {
    console.error("FATAL", err);
    process.exit(1);
  });
