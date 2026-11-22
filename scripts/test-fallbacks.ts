/**
 * Fallback-chain tests: new provider adapters (groq, gemini,
 * pollinations-tts, pollinations-video) + router chain order.
 *
 * All network calls are mocked — zero real HTTP. Run: npx tsx scripts/test-fallbacks.ts
 */
import * as groq from "../src/lib/providers/groq";
import * as gemini from "../src/lib/providers/gemini";
import * as pollinations from "../src/lib/providers/pollinations";
import * as pollinationsVideo from "../src/lib/providers/pollinations-video";
import { providersForTask } from "../src/lib/providers/router";
import { attemptWithFallback } from "../src/lib/providers/fallback";
import { okResult, errResult } from "../src/lib/providers/types";

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

// ---- mock fetch -----------------------------------------------------------
type MockHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: MockHandler = () => new Response("no mock", { status: 500 });
(globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: RequestInit) => {
  return handler(String(url), init);
};
function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function binRes(bytes: number[], contentType: string, status = 200) {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { "content-type": contentType },
  });
}

async function main() {
  // ---- groq ----------------------------------------------------------------
  process.env.GROQ_API_KEY = "test-key";
  handler = () =>
    jsonRes({ choices: [{ message: { content: "  hello from groq  " } }] });
  {
    const r = await groq.generateText({ prompt: "hi" });
    check("groq success trims content", r.ok === true && (r as { data: string }).data === "hello from groq");
  }
  {
    let n = 0;
    handler = () => (++n === 1 ? new Response("x", { status: 429 }) : jsonRes({ choices: [{ message: { content: "retry ok" } }] }));
    const r = await groq.generateText({ prompt: "hi" });
    check("groq retries on 429", r.ok === true && n === 2);
  }
  {
    handler = () => new Response("err", { status: 500 });
    const r = await groq.generateText({ prompt: "hi" });
    check("groq 500s → typed error, retryable", !r.ok && (r as { error: { retryable: boolean } }).error.retryable === true);
  }
  {
    delete process.env.GROQ_API_KEY;
    const r = await groq.generateText({ prompt: "hi" });
    check("groq missing key → not_configured", !r.ok && (r as { error: { code: string } }).error.code === "not_configured");
    process.env.GROQ_API_KEY = "test-key";
  }

  // ---- gemini ---------------------------------------------------------------
  process.env.GEMINI_API_KEY = "test-key";
  handler = () =>
    jsonRes({ candidates: [{ content: { parts: [{ text: "namaste" }, { text: " duniya" }] } }] });
  {
    const r = await gemini.generateText({ prompt: "hi" });
    check("gemini joins parts", r.ok === true && (r as { data: string }).data === "namaste duniya");
  }
  {
    handler = () => jsonRes({ candidates: [] });
    const r = await gemini.generateText({ prompt: "hi" });
    check("gemini empty candidates → typed error", !r.ok);
  }
  {
    delete process.env.GEMINI_API_KEY;
    const r = await gemini.generateText({ prompt: "hi" });
    check("gemini missing key → not_configured", !r.ok && (r as { error: { code: string } }).error.code === "not_configured");
    process.env.GEMINI_API_KEY = "test-key";
  }

  // ---- pollinations tts ------------------------------------------------------
  handler = () => binRes([1, 2, 3, 4], "audio/mpeg");
  {
    const r = await pollinations.generateSpeech({ text: "namaste" });
    check(
      "pollinations-tts returns mp3 bytes",
      r.ok === true && (r as { data: Buffer }).data.length === 4
    );
  }
  {
    handler = () => binRes([1], "text/html");
    const r = await pollinations.generateSpeech({ text: "namaste" });
    check("pollinations-tts rejects non-audio", !r.ok);
  }

  // ---- pollinations video -----------------------------------------------------
  handler = () => binRes([9, 9, 9], "video/mp4");
  {
    const r = await pollinationsVideo.generateVideo({ prompt: "a product rotating" });
    check(
      "pollinations-video returns mp4 + experimental flag",
      r.ok === true && (r as { experimental?: boolean }).experimental === true
    );
  }
  {
    handler = () => binRes([1], "application/json");
    const r = await pollinationsVideo.generateVideo({ prompt: "x" });
    check("pollinations-video rejects non-video", !r.ok);
  }

  // ---- router chain order ------------------------------------------------------
  process.env.HF_TOKEN = "test-hf";
  process.env.HF_SPACES_VIDEO_ENABLED = "true";
  const scriptKeys = providersForTask("script").map((p) => p.key);
  const scriptOrder = ["groq", "gemini", "pollinations", "hf"];
  check(
    "script chain order groq→gemini→pollinations→hf (hf last: no free credits on free accounts)",
    scriptOrder.every((k) => scriptKeys.includes(k)) &&
      scriptOrder
        .map((k) => scriptKeys.indexOf(k))
        .every((v, i, a) => i === 0 || a[i - 1] < v),
    JSON.stringify(scriptKeys)
  );
  const imageKeys = providersForTask("image").map((p) => p.key);
  const imageOrder = ["pollinations", "pollinations-turbo", "hf", "hf-sdxl"];
  check(
    "image chain order pollinations→turbo→hf→sdxl (hf legs last: billed on free accounts)",
    imageOrder.every((k) => imageKeys.includes(k)) &&
      imageOrder.map((k) => imageKeys.indexOf(k)).every((v, i, a) => i === 0 || a[i - 1] < v),
    JSON.stringify(imageKeys)
  );
  const ttsKeys = providersForTask("tts").map((p) => p.key);
  check(
    "tts chain contains hf→pollinations-tts in order",
    ttsKeys.includes("hf") &&
      ttsKeys.includes("pollinations-tts") &&
      ttsKeys.indexOf("hf") < ttsKeys.indexOf("pollinations-tts"),
    JSON.stringify(ttsKeys)
  );
  const videoKeys = providersForTask("video").map((p) => p.key);
  check(
    "video chain ends with ffmpeg reliable default",
    videoKeys[videoKeys.length - 1] === "ffmpeg",
    JSON.stringify(videoKeys)
  );
  check(
    "video chain has 3 links (honest: no 4th free video API)",
    videoKeys.length === 3,
    JSON.stringify(videoKeys)
  );

  // ---- attemptWithFallback walks the chain ------------------------------------
  {
    const seen: string[] = [];
    const fakeProviders = ["a", "b", "c"].map((k) => ({
      key: k,
      name: k,
      capabilities: ["script"] as const,
      status: "configured" as const,
      detail: "",
    }));
    const out = await attemptWithFallback(
      "script",
      async (p) => {
        seen.push(p.key);
        if (p.key === "c") return okResult(p.key, "won");
        return errResult<string>(p.key, { code: "unavailable", message: "down", retryable: true });
      },
      fakeProviders as never
    );
    check("fallback walks a→b→c and wins on c", out.ok && out.provider === "c" && seen.join(",") === "a,b,c");
    check("fallback records per-provider failures", out.failures.length === 2);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL FALLBACK TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
