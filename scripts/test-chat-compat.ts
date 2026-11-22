/**
 * OpenAI-compatible chat completions tests (no live keys needed).
 * A fake caller stands in for the Groq/Gemini legs inside runHub, so the
 * OpenAI shape, auth, model mapping, validation and SSE format are all
 * verified without a single provider call. Live-key behaviour (a real
 * ensemble answer through this endpoint) is NOT covered here — it needs
 * the VM + keys, same as hub-eval.
 * Run: npx tsx scripts/test-chat-compat.ts
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolated storage so tests never touch storage/hub.
process.env.HUB_STORAGE_DIR = mkdtempSync(join(tmpdir(), "chat-compat-test-"));
// Auth key for these tests (fallback path is N8N_WEBHOOK_SECRET).
process.env.CHAT_API_KEY = "test-chat-key-123";

import {
  CHAT_COMPAT_MODELS,
  estimateTokens,
  handleChatCompletion,
  listChatModels,
  messagesToPrompt,
} from "../src/lib/hub/chat-compat";
import type { TextCaller } from "../src/lib/hub/ensemble";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name} ${extra}`);
  }
}

const fakeCaller: TextCaller = async (leg, prompt) => ({
  text: `[${leg.model}] fake answer to: ${prompt.slice(0, 40)}`,
  durationMs: 5,
});

// Fake caller whose every leg returns a price — trips the compliance scan.
const priceCaller: TextCaller = async () => ({
  text: "This product costs only $9.99, best deal ever!",
  durationMs: 5,
});

const goodBody = {
  model: "hub",
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello, who are you?" },
  ],
};

async function main(): Promise<void> {
  console.log("messages -> prompt");
  check(
    "roles kept as labels",
    messagesToPrompt(goodBody.messages) === "system: You are helpful.\nuser: Hello, who are you?"
  );
  let threw = false;
  try {
    messagesToPrompt([]);
  } catch {
    threw = true;
  }
  check("empty messages throws", threw);
  threw = false;
  try {
    messagesToPrompt([{ role: "admin", content: "hi" }]);
  } catch {
    threw = true;
  }
  check("bad role throws", threw);
  threw = false;
  try {
    messagesToPrompt([{ role: "user", content: "x".repeat(9000) }]);
  } catch {
    threw = true;
  }
  check("over-long prompt throws", threw);
  check("estimateTokens 8 chars -> 2", estimateTokens("12345678") === 2);
  check("estimateTokens empty -> 1", estimateTokens("") === 1);

  console.log("models list");
  const models = listChatModels() as { data: { id: string }[] };
  check(
    "lists hub + hub-fast",
    models.data.map((m) => m.id).join(",") === CHAT_COMPAT_MODELS.join(",")
  );

  console.log("auth");
  const noKey = await handleChatCompletion(goodBody, null, { caller: fakeCaller });
  check("no Bearer -> 401", noKey.status === 401);
  const wrongKey = await handleChatCompletion(goodBody, "Bearer nope", { caller: fakeCaller });
  check("wrong Bearer -> 401", wrongKey.status === 401);
  const auth = "Bearer test-chat-key-123";

  console.log("validation");
  const badModel = await handleChatCompletion(
    { model: "gpt-4o", messages: goodBody.messages },
    auth,
    { caller: fakeCaller }
  );
  check("unknown model -> 400", badModel.status === 400);
  const badStream = await handleChatCompletion(
    { model: "hub", messages: goodBody.messages, stream: "yes" },
    auth,
    { caller: fakeCaller }
  );
  check("non-boolean stream -> 400", badStream.status === 400);
  const emptyMsgs = await handleChatCompletion({ model: "hub", messages: [] }, auth, {
    caller: fakeCaller,
  });
  check("empty messages -> 400", emptyMsgs.status === 400);

  console.log("ensemble completion (fake caller)");
  const res = await handleChatCompletion(goodBody, auth, { caller: fakeCaller });
  check("hub -> 200", res.status === 200);
  const json = res.json as {
    id: string;
    object: string;
    model: string;
    choices: { message: { role: string; content: string }; finish_reason: string }[];
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  check("object is chat.completion", json.object === "chat.completion");
  check("id carries chatcmpl-", json.id.startsWith("chatcmpl-"));
  check("model echoes hub", json.model === "hub");
  check("assistant message present", json.choices[0].message.role === "assistant");
  check("content is non-empty text", json.choices[0].message.content.length > 0);
  check("finish_reason stop", json.choices[0].finish_reason === "stop");
  check(
    "usage adds up",
    json.usage.total_tokens === json.usage.prompt_tokens + json.usage.completion_tokens
  );
  check("usage prompt tokens estimated > 0", json.usage.prompt_tokens > 0);

  console.log("hub-fast single leg");
  const fast = await handleChatCompletion(
    { model: "hub-fast", messages: [{ role: "user", content: "Hi" }] },
    auth,
    { caller: fakeCaller }
  );
  check("hub-fast -> 200", fast.status === 200);
  check(
    "hub-fast echoes model",
    (fast.json as { model: string }).model === "hub-fast"
  );

  console.log("streaming (one-chunk SSE)");
  const sse = await handleChatCompletion({ ...goodBody, stream: true }, auth, {
    caller: fakeCaller,
  });
  check("stream -> 200 + SSE flag", sse.status === 200 && sse.isSse === true);
  check(
    "SSE has data chunk + DONE",
    typeof sse.sse === "string" &&
      sse.sse.includes("data: {") &&
      sse.sse.includes("chat.completion.chunk") &&
      sse.sse.includes("data: [DONE]")
  );

  console.log("compliance passthrough");
  const priced = await handleChatCompletion(goodBody, auth, { caller: priceCaller });
  check("price answer -> 400 compliance_rejected", priced.status === 400);
  check(
    "error body is OpenAI-shaped",
    (priced.json as { error?: { code?: string } }).error?.code === "compliance_rejected"
  );

  console.log("not configured (no key anywhere)");
  delete process.env.CHAT_API_KEY;
  delete process.env.N8N_WEBHOOK_SECRET;
  const unconfigured = await handleChatCompletion(goodBody, "Bearer x", {
    caller: fakeCaller,
  });
  check("no key env -> 501", unconfigured.status === 501);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
