/**
 * Groq script adapter — free tier, OpenAI-compatible chat completions.
 *
 * Endpoint: POST https://api.groq.com/openai/v1/chat/completions
 * Free plan (per Groq docs): ~30 RPM, ~1,000 requests/day, no credit card.
 * Requires a free GROQ_API_KEY (user creates it; never in chat).
 *
 * Commercial-use status: NOT verified by us — check Groq's current terms
 * at deploy time before using for affiliate content.
 */
import { z } from "zod";
import {
  backoffDelayMs,
  errResult,
  okResult,
  requireEnv,
  sleep,
  type ProviderResult,
} from "./types";

export const PROVIDER_KEY = "groq";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const GenerateTextInputSchema = z.object({
  prompt: z.string().min(1).max(8000),
  maxTokens: z.number().int().min(64).max(4096).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  model: z.string().min(1).optional(),
});

const MAX_RETRIES = 2;
const TIMEOUT_MS = 60_000;

export function isConfigured(): boolean {
  return requireEnv("GROQ_API_KEY") !== null;
}

export function defaultModel(): string {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

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
  const apiKey = requireEnv("GROQ_API_KEY");
  if (!apiKey) {
    return errResult(PROVIDER_KEY, {
      code: "not_configured",
      message: "Missing GROQ_API_KEY — create a free key at console.groq.com.",
      retryable: false,
    });
  }
  const { prompt, maxTokens, temperature } = parsed.data;
  const model = parsed.data.model || defaultModel();
  const started = Date.now();
  let lastDetail = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
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
    message: `Groq did not return text after ${MAX_RETRIES + 1} attempts. Last: ${lastDetail}`,
    retryable: true,
  });
}
