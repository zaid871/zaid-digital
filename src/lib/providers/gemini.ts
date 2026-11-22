/**
 * Google Gemini script adapter — free tier via AI Studio.
 *
 * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * Free tier (per Google AI Studio docs): rate-limited Flash models, no credit
 * card. Requires a free GEMINI_API_KEY (user creates it; never in chat).
 *
 * Commercial-use status: NOT verified by us — check Google's current terms
 * at deploy time before using for affiliate content. Note: Google may use
 * free-tier inputs to improve models unless the paid tier is used.
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

export const PROVIDER_KEY = "gemini";

const GenerateTextInputSchema = z.object({
  prompt: z.string().min(1).max(8000),
  maxTokens: z.number().int().min(64).max(4096).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  model: z.string().min(1).optional(),
});

const MAX_ATTEMPTS_PER_MODEL = 2;
const TIMEOUT_MS = 60_000;

/**
 * Ordered model fallback list (AdCraftAI pattern, adapted to our stack).
 * The requested model (or the env/default) is tried first; on a 429 the
 * adapter moves to the next model instead of burning retries on an
 * exhausted one. Only the flash family is listed — 2.5-pro's free-tier
 * quota is far smaller, so it would rarely rescue a flash rate-limit.
 * Override the tail with GEMINI_MODELS="model-a,model-b".
 */
export function modelFallbackList(explicit?: string): string[] {
  const first = explicit || defaultModel();
  const envList = (process.env.GEMINI_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tail = envList.length > 0 ? envList : ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];
  return [...new Set([first, ...tail])];
}

export function isConfigured(): boolean {
  return requireEnv("GEMINI_API_KEY") !== null;
}

export function defaultModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.0-flash";
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
  const apiKey = requireEnv("GEMINI_API_KEY");
  if (!apiKey) {
    return errResult(PROVIDER_KEY, {
      code: "not_configured",
      message: "Missing GEMINI_API_KEY — create a free key in Google AI Studio.",
      retryable: false,
    });
  }
  const { prompt, maxTokens, temperature } = parsed.data;
  const models = modelFallbackList(parsed.data.model);
  const started = Date.now();
  let lastDetail = "";

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature },
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429) {
          // Exhausted model: do not waste retries here, move on.
          lastDetail = `http=429 rate limited (model ${model})`;
          break;
        }
        if (!res.ok) {
          lastDetail = `http=${res.status} (model ${model})`;
          if (attempt < MAX_ATTEMPTS_PER_MODEL - 1) await sleep(backoffDelayMs(attempt, 2000, 20000));
          continue;
        }
        const body = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const content = body.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("")
          .trim();
        if (!content) {
          lastDetail = `empty candidates in response (model ${model})`;
          if (attempt < MAX_ATTEMPTS_PER_MODEL - 1) await sleep(backoffDelayMs(attempt, 2000, 20000));
          continue;
        }
        return okResult(PROVIDER_KEY, content, { model, durationMs: Date.now() - started });
      } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        lastDetail = `${msg.includes("abort") ? "timeout" : msg.slice(0, 120)} (model ${model})`;
        if (attempt < MAX_ATTEMPTS_PER_MODEL - 1) await sleep(backoffDelayMs(attempt, 2000, 20000));
      }
    }
  }
  return errResult(PROVIDER_KEY, {
    code: "unavailable",
    message: `Gemini did not return text after trying: ${models.join(", ")}. Last: ${lastDetail}`,
    retryable: true,
  });
}
