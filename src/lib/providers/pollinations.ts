/**
 * Pollinations.ai image adapter — free, no API key, best-effort.
 *
 * Endpoint: https://image.pollinations.ai/prompt/{prompt}?width=&height=&nologo=true&model=flux
 * The service is community-run and best-effort: it can be slow, rate-limit,
 * or return non-image payloads. We retry with backoff and validate the
 * content-type; on failure we return a typed error (never a placeholder).
 */
import { z } from "zod";
import { backoffDelayMs, errResult, okResult, sleep, type ProviderResult } from "./types";

export const PROVIDER_KEY = "pollinations";

const GenerateImageInputSchema = z.object({
  prompt: z.string().min(1).max(1500),
  width: z.number().int().min(64).max(2048).default(768),
  height: z.number().int().min(64).max(2048).default(1024),
  /** Pollinations model id, e.g. "flux". Overridable via POLLINATIONS_MODEL. */
  model: z.string().min(1).optional(),
});

const MAX_RETRIES = 3;
const TIMEOUT_MS = 120_000;

/** Free, no-key text endpoint (OpenAI-compatible). Sits in the script chain after
 *  groq/gemini now that Hugging Face Inference Providers has no free credits
 *  for free accounts. */
const TEXT_ENDPOINT = "https://text.pollinations.ai/openai";

const GenerateTextInputSchema = z.object({
  prompt: z.string().min(1).max(8000),
  maxTokens: z.number().int().min(64).max(4096).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  model: z.string().min(1).optional(),
});

/**
 * Generate text via Pollinations' free OpenAI-compatible endpoint.
 * Best-effort like the image endpoint: no key, community-run, may be slow
 * or fail. Retries with backoff; failures are typed, never fabricated.
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
  const { prompt, maxTokens, temperature } = parsed.data;
  const model = parsed.data.model || process.env.POLLINATIONS_TEXT_MODEL || "openai";

  const started = Date.now();
  let lastDetail = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(TEXT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        lastDetail = "http=429 rate limited";
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 3000, 30000));
        continue;
      }
      if (!res.ok) {
        lastDetail = `http=${res.status}`;
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
        continue;
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastDetail = "empty choices in response";
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
        continue;
      }
      return okResult(PROVIDER_KEY, content, { model, durationMs: Date.now() - started });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg.includes("abort") ? "timeout" : msg.slice(0, 120);
      if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
    }
  }
  return errResult(PROVIDER_KEY, {
    code: "unavailable",
    message: `Pollinations.ai did not return text after ${MAX_RETRIES + 1} attempts. Last: ${lastDetail}`,
    retryable: true,
    fallback: "hf",
  });
}

export function isConfigured(): boolean {
  // No credentials required — always "available" as a best-effort provider.
  // Callers should still treat failures as normal, not exceptional.
  return true;
}

/** Free, no-key TTS endpoint (OpenAI-compatible). Best-effort like the rest. */
const SPEECH_ENDPOINT = "https://gen.pollinations.ai/v1/audio/speech";

const GenerateSpeechInputSchema = z.object({
  text: z.string().min(1).max(4000),
  /** Voice id. Overridable via POLLINATIONS_TTS_VOICE. */
  voice: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

const SPEECH_TIMEOUT_MS = 120_000;

/**
 * Text-to-speech via Pollinations' free OpenAI-compatible endpoint.
 * Returns MP3 bytes. Best-effort: no key, community-run, may be slow or fail.
 * Commercial-use status NOT verified — check terms at deploy time.
 */
export async function generateSpeech(
  input: z.input<typeof GenerateSpeechInputSchema>
): Promise<ProviderResult<Buffer>> {
  const parsed = GenerateSpeechInputSchema.safeParse(input);
  if (!parsed.success) {
    return errResult(PROVIDER_KEY, {
      code: "invalid_input",
      message: "Invalid TTS input.",
      retryable: false,
    });
  }
  const { text } = parsed.data;
  const voice = parsed.data.voice || process.env.POLLINATIONS_TTS_VOICE || "alloy";
  const model = parsed.data.model || process.env.POLLINATIONS_TTS_MODEL || "openai";

  const started = Date.now();
  let lastDetail = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPEECH_TIMEOUT_MS);
    try {
      const res = await fetch(SPEECH_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: "mp3",
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const ct = res.headers.get("content-type") || "";
      if (res.status === 429) {
        lastDetail = "http=429 rate limited";
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 3000, 30000));
        continue;
      }
      if (!res.ok || !ct.startsWith("audio/")) {
        lastDetail = `http=${res.status} content-type=${ct.slice(0, 60)}`;
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) {
        lastDetail = "empty body";
        continue;
      }
      return okResult(PROVIDER_KEY, buf, { model, durationMs: Date.now() - started });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg.includes("abort") ? "timeout" : msg.slice(0, 120);
      if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
    }
  }
  return errResult(PROVIDER_KEY, {
    code: "unavailable",
    message: `Pollinations TTS did not return audio after ${MAX_RETRIES + 1} attempts. Last: ${lastDetail}`,
    retryable: true,
  });
}

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
  const { prompt, width, height } = parsed.data;
  const model = parsed.data.model || process.env.POLLINATIONS_MODEL || "flux";
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&nologo=true&model=${encodeURIComponent(model)}`;

  const started = Date.now();
  let lastDetail = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const ct = res.headers.get("content-type") || "";
      if (res.status === 429) {
        lastDetail = "http=429 rate limited";
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 3000, 30000));
        continue;
      }
      if (!res.ok || !ct.startsWith("image/")) {
        lastDetail = `http=${res.status} content-type=${ct.slice(0, 60)}`;
        if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) {
        lastDetail = "empty body";
        continue;
      }
      return okResult(PROVIDER_KEY, buf, { model, durationMs: Date.now() - started });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastDetail = msg.includes("abort") ? "timeout" : msg.slice(0, 120);
      if (attempt < MAX_RETRIES) await sleep(backoffDelayMs(attempt, 2000, 20000));
    }
  }
  return errResult(PROVIDER_KEY, {
    code: "unavailable",
    message: `Pollinations.ai did not return an image after ${MAX_RETRIES + 1} attempts. Last: ${lastDetail}`,
    retryable: true,
    fallback: "hf",
  });
}
