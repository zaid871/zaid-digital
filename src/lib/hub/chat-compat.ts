/**
 * OpenAI-compatible chat completions over the hub (video: Astro K Joseph,
 * "Build Your Own Private AI API Server in 10 Minutes ($0)", 2026-11-15).
 *
 * The transferable idea in that video is the API itself: one
 * OpenAI-compatible endpoint (own URL + own key) that ANY app can plug
 * into, instead of a custom endpoint only our own code understands.
 * The hub spec §7 already named this as Phase 2 ("if n8n wants an
 * OpenAI-compatible URL instead of the hub endpoint, add LiteLLM").
 *
 * This file is the lighter version of that Phase 2: a thin shim, NOT a
 * LiteLLM container. LiteLLM is a router, not a brain — it would
 * duplicate the hub's routing/quota/ledger and add a whole container,
 * while still not doing the ensemble merge. The shim reuses runHub, so
 * every call still gets the ensemble, quota guard, compliance scan and
 * ledger. No new service, no new RAM, one redeploy.
 *
 * What is NOT taken from the video:
 * - Ollama local model: the VM is CPU-only (2 OCPU). The video itself
 *   admits ~56s per answer with reasoning on a CPU VPS, and a 4B model
 *   would eat ~3GB of the ~3.5-4GB spare RAM while renders already peak
 *   at 7.5-8.5GB. The free Groq/Gemini legs stay the inference path.
 * - Paid Hostinger VPS: free-first. The Oracle Always Free VM already
 *   hosts this backend.
 * - The "$0" label: true for per-token fees only, not for the VPS.
 *
 * Honest limits of this shim (kept, not hidden):
 * - Text only. No vision, no audio, no function calling, no logprobs.
 * - `stream: true` arrives as ONE SSE chunk: the ensemble merges all
 *   legs before responding, so there is nothing to stream token by
 *   token. Clients get valid SSE (`data: {...}` + `data: [DONE]`), just
 *   not incremental.
 * - `usage` token counts are estimates (chars / 4, rounded up) — no
 *   tokenizer runs on the VM. They are shaped like OpenAI usage, but
 *   they are not measured tokens.
 * - The hub compliance scan applies: an answer tripping the price /
 *   banned-claim patterns fails with `compliance_rejected` (HTTP 400
 *   here), the same as any hub text run.
 */
import { runHub, type HubRunInput } from "./run";
import type { TextCaller } from "./ensemble";

/** The only models this endpoint serves. "hub" is the ensemble default. */
export const CHAT_COMPAT_MODELS = ["hub", "hub-fast"] as const;
export type ChatCompatModel = (typeof CHAT_COMPAT_MODELS)[number];

export const CHAT_COMPAT_MAX_PROMPT_CHARS = 8000;

/** Bearer key: dedicated env first, n8n secret as fallback, else unset. */
export function chatApiKey(): string | null {
  return process.env.CHAT_API_KEY ?? process.env.N8N_WEBHOOK_SECRET ?? null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * OpenAI messages[] -> one hub prompt. Roles are kept as labels so the
 * legs still see who said what. Throws on empty/invalid input — never
 * silently truncates or invents a prompt.
 */
export function messagesToPrompt(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }
  const parts: string[] = [];
  for (const m of messages) {
    if (typeof m !== "object" || m === null) {
      throw new Error("Each message must be an object with role and content.");
    }
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new Error(`Invalid message role '${String(role)}' — use system, user or assistant.`);
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("Each message content must be a non-empty string.");
    }
    parts.push(`${role}: ${content.trim()}`);
  }
  const prompt = parts.join("\n");
  if (prompt.length > CHAT_COMPAT_MAX_PROMPT_CHARS) {
    throw new Error(
      `Prompt is ${prompt.length} chars, over the ${CHAT_COMPAT_MAX_PROMPT_CHARS} limit — shorten the conversation.`
    );
  }
  return prompt;
}

/** Rough token estimate: chars / 4, rounded up, minimum 1. See header. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface ChatCompatResult {
  status: number;
  /** JSON body for non-streaming responses (and all errors). */
  json?: unknown;
  /** SSE body for stream:true responses. */
  sse?: string;
  isSse?: boolean;
}

function openAiError(status: number, message: string, code: string): ChatCompatResult {
  return { status, json: { error: { message, type: "invalid_request_error", code } } };
}

function openAiCompletion(
  model: string,
  runId: string,
  text: string,
  promptTokens: number
): Record<string, unknown> {
  const completionTokens = estimateTokens(text);
  return {
    id: `chatcmpl-${runId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export interface HandleChatDeps {
  /** Test seam: replaces real provider calls inside runHub. */
  caller?: TextCaller;
}

/**
 * Handle one POST /api/v1/chat/completions body. Returns an OpenAI-shaped
 * response (never the v1 envelope — OpenAI clients would not understand
 * it). Auth is `Authorization: Bearer <CHAT_API_KEY or N8N_WEBHOOK_SECRET>`.
 */
export async function handleChatCompletion(
  body: unknown,
  authHeader: string | null,
  deps: HandleChatDeps = {}
): Promise<ChatCompatResult> {
  const key = chatApiKey();
  if (!key) {
    return openAiError(
      501,
      "Chat completions are not configured — set CHAT_API_KEY (or N8N_WEBHOOK_SECRET) in .env and redeploy.",
      "not_configured"
    );
  }
  const provided = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided || provided !== key) {
    return openAiError(401, "Invalid or missing Bearer API key.", "invalid_api_key");
  }
  if (typeof body !== "object" || body === null) {
    return openAiError(400, "Request body must be a JSON object.", "invalid_request");
  }
  const { model, messages, stream } = body as {
    model?: unknown;
    messages?: unknown;
    stream?: unknown;
  };
  const modelName = typeof model === "string" && model.length > 0 ? model : "hub";
  if (!CHAT_COMPAT_MODELS.includes(modelName as ChatCompatModel)) {
    return openAiError(
      400,
      `Unknown model '${modelName}'. Supported models: ${CHAT_COMPAT_MODELS.join(", ")}.`,
      "model_not_found"
    );
  }
  if (stream !== undefined && typeof stream !== "boolean") {
    return openAiError(400, "'stream' must be a boolean.", "invalid_request");
  }
  let prompt: string;
  try {
    prompt = messagesToPrompt(messages);
  } catch (err) {
    return openAiError(400, err instanceof Error ? err.message : "Invalid messages.", "invalid_request");
  }

  const input: HubRunInput = {
    task: {
      kind: "chat",
      prompt,
      mode: modelName === "hub-fast" ? "single" : "ensemble",
    },
    deliver: { format: "text" },
  };
  const result = await runHub(input, { caller: deps.caller });
  if (!result.ok || result.output.kind !== "text" || typeof result.output.text !== "string") {
    const code = result.error?.code ?? "internal_error";
    const message = result.error?.message ?? "Hub run failed.";
    if (code === "quota_exceeded") return openAiError(429, message, code);
    if (code === "compliance_rejected") return openAiError(400, message, code);
    if (code === "not_configured" || code === "all_legs_paused") {
      return openAiError(503, message, code);
    }
    return openAiError(502, message, code);
  }

  const text = result.output.text;
  const promptTokens = estimateTokens(prompt);
  if (stream === true) {
    // One-chunk SSE: the ensemble merges before responding (see header).
    const chunk = {
      id: `chatcmpl-${result.runId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }],
    };
    return {
      status: 200,
      isSse: true,
      sse: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
    };
  }
  return { status: 200, json: openAiCompletion(modelName, result.runId, text, promptTokens) };
}

/** GET /api/v1/chat/completions — OpenAI-style model list for this endpoint. */
export function listChatModels(): Record<string, unknown> {
  return {
    object: "list",
    data: CHAT_COMPAT_MODELS.map((id) => ({
      id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "hub",
      description:
        id === "hub"
          ? "Parallel ensemble over the live free legs (Groq + Gemini), merged by one synthesis call."
          : "Single fast leg (Groq gpt-oss-20b) — cheapest latency, no ensemble merge.",
    })),
  };
}
