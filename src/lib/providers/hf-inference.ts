/**
 * Hugging Face Inference Providers adapter.
 *
 * Covers three capabilities over one API:
 *  - llm:             generateText()   — e.g. Qwen2.5-7B-Instruct for scripts
 *  - image_generation: generateImage() — FLUX.1-schnell
 *  - tts:             textToSpeech()    — facebook/mms-tts-hin and friends
 *
 * Auth: HF_TOKEN env. IMPORTANT (verified 2026-10-21 on huggingface.co/docs):
 * the legacy Serverless Inference API (api-inference.huggingface.co) is
 * retired; this adapter targets the Inference Providers router
 * (router.huggingface.co/hf-inference). Free HF accounts receive NO included
 * Inference Providers credits — calls are billed per compute-second, so on a
 * free account expect billing failures. The provider therefore sits LAST in
 * the router's preference order: it works with PRO ($2/mo credits) or
 * purchased credits, and the chain falls through to genuinely-free providers
 * otherwise. The endpoint can be overridden with HF_INFERENCE_BASE_URL.
 *
 * 429s get bounded exponential backoff (max 3 retries); 402 (billing) is
 * surfaced as a non-retryable `billing` error — output is NEVER fabricated.
 */
import { z } from "zod";
import {
  backoffDelayMs,
  errResult,
  okResult,
  requireEnv,
  sleep,
  type ProviderError,
  type ProviderResult,
} from "./types";

export const PROVIDER_KEY = "hf";

const DEFAULT_BASE_URL = "https://router.huggingface.co/hf-inference/models";
const DEFAULT_TEXT_MODEL = "Qwen/Qwen2.5-7B-Instruct";
const DEFAULT_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";
/** Ordered preference for Hindi TTS; first reachable model wins. */
const HINDI_TTS_MODELS = [
  "facebook/mms-tts-hin",
  "facebook/mms-tts-eng", // fallback: intelligible, wrong accent
];

const MAX_429_RETRIES = 3;
const TEXT_TIMEOUT_MS = 90_000;
const IMAGE_TIMEOUT_MS = 180_000;
const TTS_TIMEOUT_MS = 90_000;

const TextParamsSchema = z.object({
  max_new_tokens: z.number().int().min(1).max(2048).default(512),
  temperature: z.number().min(0).max(2).default(0.7),
});
export type TextParams = z.infer<typeof TextParamsSchema>;

const GenerateTextInputSchema = z.object({
  model: z.string().min(1).default(DEFAULT_TEXT_MODEL),
  prompt: z.string().min(1).max(8000),
  params: TextParamsSchema.optional(),
});

const GenerateImageInputSchema = z.object({
  model: z.string().min(1).default(DEFAULT_IMAGE_MODEL),
  prompt: z.string().min(1).max(2000),
});

const TtsInputSchema = z.object({
  text: z.string().min(1).max(2000),
  /** BCP-47-ish hint; currently "hi" (Hindi) is the supported path. */
  lang: z.string().default("hi"),
});

function baseUrl(): string {
  return (process.env.HF_INFERENCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function rateLimitedError(provider: string, afterMs?: number): ProviderError {
  return {
    code: "rate_limited",
    message: `Hugging Face inference rate limit hit${afterMs ? ` (retry after ~${Math.ceil(afterMs / 1000)}s)` : ""}. No output was generated.`,
    retryable: true,
    fallback: "pollinations",
  };
}

function billingError(): ProviderError {
  return {
    code: "billing",
    message:
      "Hugging Face Inference Providers requires credits (free HF accounts have " +
      "no included credits — verified on huggingface.co/docs 2026-10-21). This leg is " +
      "skipped; the chain falls through to genuinely-free providers. Add credits or " +
      "upgrade to PRO to enable this provider.",
    retryable: false,
    fallback: "pollinations",
  };
}

interface FetchOutcome {
  ok: boolean;
  status: number;
  retryAfterMs?: number;
  buffer?: Buffer;
  json?: unknown;
  errorText?: string;
}

async function postModel(
  token: string,
  model: string,
  body: unknown,
  timeoutMs: number,
  acceptJson: boolean
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}/${model}`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const retryAfter = res.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, retryAfterMs, errorText: text.slice(0, 500) };
    }
    if (acceptJson) {
      return { ok: true, status: res.status, json: await res.json() };
    }
    const ab = await res.arrayBuffer();
    return { ok: true, status: res.status, buffer: Buffer.from(ab) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { ok: false, status: 0, errorText: "request timed out" };
    }
    return { ok: false, status: 0, errorText: msg.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/** POST with bounded exponential backoff on 429. Returns the final outcome. */
async function postWithBackoff(
  token: string,
  model: string,
  body: unknown,
  timeoutMs: number,
  acceptJson: boolean
): Promise<FetchOutcome & { attempts: number; rateLimited: boolean }> {
  let last: FetchOutcome = { ok: false, status: 0 };
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    last = await postModel(token, model, body, timeoutMs, acceptJson);
    if (last.ok || last.status !== 429) {
      return { ...last, attempts: attempt + 1, rateLimited: false };
    }
    if (attempt < MAX_429_RETRIES) {
      await sleep(backoffDelayMs(attempt, 2000, 20000));
    }
  }
  return { ...last, attempts: MAX_429_RETRIES + 1, rateLimited: true };
}

export function isConfigured(): boolean {
  return requireEnv("HF_TOKEN") !== null;
}

/**
 * Generate text with an HF-hosted LLM. Returns the generated string.
 * Response shape: [{ generated_text }] (may include the prompt echo).
 */
export async function generateText(
  input: z.input<typeof GenerateTextInputSchema>
): Promise<ProviderResult<string>> {
  const parsed = GenerateTextInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Invalid text-generation input.",
      retryable: false,
    });
  }
  const token = requireEnv("HF_TOKEN");
  if (!token) {
    return errResult(PROVIDER_KEY, {
      code: "not_configured",
      message:
        "HF_TOKEN is not set — and note: on a free Hugging Face account the token " +
        "alone is not enough, since Inference Providers has no included free credits. " +
        "Set HF_TOKEN plus credits (or PRO) to enable this provider.",
      retryable: false,
    });
  }
  const { model, prompt, params } = parsed.data;
  const started = Date.now();
  const out = await postWithBackoff(
    token,
    model,
    { inputs: prompt, parameters: { ...(params ?? {}), return_full_text: false } },
    TEXT_TIMEOUT_MS,
    true
  );
  if (out.rateLimited) {
    return errResult(PROVIDER_KEY, rateLimitedError(PROVIDER_KEY), { model });
  }
  if (!out.ok) {
    if (out.status === 402) {
      return errResult(PROVIDER_KEY, billingError(), { model });
    }
    const code =
      out.status === 0
        ? "timeout"
        : out.status === 404 || out.status === 410
          ? "unavailable"
          : "upstream_error";
    return errResult(
      PROVIDER_KEY,
      {
        code,
        message: `Text generation failed (model=${model}, http=${out.status}): ${(out.errorText || "").slice(0, 200)}`,
        retryable: out.status === 0 || out.status >= 500,
      },
      { model }
    );
  }
  const arr = Array.isArray(out.json) ? out.json : [];
  const text = typeof arr[0]?.generated_text === "string" ? arr[0].generated_text.trim() : "";
  if (!text) {
    return errResult(
      PROVIDER_KEY,
      { code: "upstream_error", message: "Model returned no text.", retryable: true },
      { model }
    );
  }
  return okResult(PROVIDER_KEY, text, { model, durationMs: Date.now() - started });
}

/**
 * Generate an image with FLUX.1-schnell (free-tier friendly). Returns a PNG/JPEG buffer.
 */
export async function generateImage(
  input: z.input<typeof GenerateImageInputSchema>
): Promise<ProviderResult<Buffer>> {
  const parsed = GenerateImageInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Invalid image-generation input.",
      retryable: false,
    });
  }
  const token = requireEnv("HF_TOKEN");
  if (!token) {
    return errResult(PROVIDER_KEY, {
      code: "not_configured",
      message: "HF_TOKEN is not set.",
      retryable: false,
    });
  }
  const { model, prompt } = parsed.data;
  const started = Date.now();
  const out = await postWithBackoff(token, model, { inputs: prompt }, IMAGE_TIMEOUT_MS, false);
  if (out.rateLimited) {
    return errResult(PROVIDER_KEY, rateLimitedError(PROVIDER_KEY), { model });
  }
  if (!out.ok || !out.buffer || out.buffer.length === 0) {
    if (out.status === 402) {
      return errResult(PROVIDER_KEY, billingError(), { model });
    }
    const code =
      out.status === 0
        ? "timeout"
        : out.status === 404 || out.status === 410
          ? "unavailable"
          : "upstream_error";
    return errResult(
      PROVIDER_KEY,
      {
        code,
        message: `Image generation failed (model=${model}, http=${out.status}): ${(out.errorText || "").slice(0, 200)}`,
        retryable: out.status === 0 || out.status >= 500,
        fallback: "pollinations",
      },
      { model }
    );
  }
  return okResult(PROVIDER_KEY, out.buffer, { model, durationMs: Date.now() - started });
}

/**
 * Text-to-speech via MMS-TTS Hindi models. Returns raw audio bytes (typically WAV/FLAC).
 * Best-effort: tries each candidate model in order; never synthesizes fake audio.
 */
export async function textToSpeech(
  input: z.input<typeof TtsInputSchema>
): Promise<ProviderResult<Buffer>> {
  const parsed = TtsInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Invalid TTS input.",
      retryable: false,
    });
  }
  const token = requireEnv("HF_TOKEN");
  if (!token) {
    return errResult(PROVIDER_KEY, {
      code: "not_configured",
      message: "HF_TOKEN is not set.",
      retryable: false,
    });
  }
  const { text } = parsed.data;
  const started = Date.now();
  let lastError = "";
  for (const model of HINDI_TTS_MODELS) {
    const out = await postWithBackoff(token, model, { inputs: text }, TTS_TIMEOUT_MS, false);
    if (out.rateLimited) {
      return errResult(PROVIDER_KEY, rateLimitedError(PROVIDER_KEY), { model });
    }
    if (out.ok && out.buffer && out.buffer.length > 0) {
      return okResult(PROVIDER_KEY, out.buffer, { model, durationMs: Date.now() - started });
    }
    lastError = `model=${model} http=${out.status} ${(out.errorText || "").slice(0, 120)}`;
  }
  return errResult(
    PROVIDER_KEY,
    {
      code: "unavailable",
      message: `No Hindi TTS model responded with audio. Last: ${lastError}`,
      retryable: true,
      fallback: "edge-tts",
    },
    { model: HINDI_TTS_MODELS.join(",") }
  );
}

export const HF_DEFAULTS = {
  textModel: DEFAULT_TEXT_MODEL,
  imageModel: DEFAULT_IMAGE_MODEL,
  ttsModels: HINDI_TTS_MODELS,
};
