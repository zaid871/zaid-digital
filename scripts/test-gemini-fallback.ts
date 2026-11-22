/**
 * Gemini model-fallback tests: a 429 on one model moves to the next
 * instead of burning retries on the exhausted model.
 * Run: npx tsx scripts/test-gemini-fallback.ts
 */
import { generateText, modelFallbackList } from "../src/lib/providers/gemini";

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

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  };
}
function statusResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

function stubFetch(responses: Array<{ ok: boolean; status: number; text?: string }>, seenUrls: string[]) {
  let i = 0;
  (globalThis as { fetch?: unknown }).fetch = async (url: unknown) => {
    seenUrls.push(String(url));
    const r = responses[Math.min(i++, responses.length - 1)];
    return r.ok ? okResponse(r.text ?? "") : statusResponse(r.status);
  };
}

async function main() {
  process.env.GEMINI_API_KEY = "test-dummy-key";
  const origFetch = globalThis.fetch;

  // 1. Default list keeps the current default first, then flash fallbacks.
  const list = modelFallbackList();
  check("default model first", list[0] === "gemini-2.0-flash", list.join(","));
  check("flash-lite + flash in list", list.includes("gemini-2.5-flash-lite") && list.includes("gemini-2.5-flash"));
  check("no duplicates", new Set(list).size === list.length);

  // 2. 429 on first model -> second model succeeds, no wasted retries.
  {
    const urls: string[] = [];
    stubFetch(
      [
        { ok: false, status: 429 },
        { ok: true, status: 200, text: "hello from fallback" },
      ],
      urls
    );
    const r = await generateText({ prompt: "hi", maxTokens: 64 });
    check("429 -> fallback model succeeds", r.ok && r.data === "hello from fallback");
    if (r.ok) check("result names the fallback model", r.model === "gemini-2.5-flash-lite", r.model ?? "");
    check("only 2 calls (no retry on exhausted model)", urls.length === 2, String(urls.length));
  }

  // 3. Explicit model tried first, then fallbacks.
  {
    const urls: string[] = [];
    stubFetch(
      [
        { ok: false, status: 429 },
        { ok: true, status: 200, text: "explicit fallback ok" },
      ],
      urls
    );
    const r = await generateText({ prompt: "hi", maxTokens: 64, model: "gemini-2.5-flash" });
    check("explicit model tried first", urls[0].includes("gemini-2.5-flash"));
    check("explicit -> fallback succeeds", r.ok && r.data === "explicit fallback ok");
  }

  // 4. All models 429 -> typed unavailable naming the tried models.
  {
    const urls: string[] = [];
    stubFetch([{ ok: false, status: 429 }], urls);
    const r = await generateText({ prompt: "hi", maxTokens: 64 });
    check(
      "all 429 -> unavailable listing tried models",
      !r.ok && r.error.code === "unavailable" && r.error.message.includes("gemini-2.5-flash-lite")
    );
    check("every model tried once", urls.length === modelFallbackList().length, `${urls.length} vs ${modelFallbackList().length}`);
  }

  // 5. First model healthy -> no fallback at all.
  {
    const urls: string[] = [];
    stubFetch([{ ok: true, status: 200, text: "direct" }], urls);
    const r = await generateText({ prompt: "hi", maxTokens: 64 });
    check("healthy first model -> single call", r.ok && urls.length === 1, String(urls.length));
  }

  globalThis.fetch = origFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GEMINI-FALLBACK TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
