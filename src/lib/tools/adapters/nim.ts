/**
 * NVIDIA NIM text adapter — free tier, OpenAI-compatible chat completions.
 *
 * Endpoint: POST https://integrate.api.nvidia.com/v1/chat/completions
 * Free tier (verified 2026-11-16): 40 RPM, 10,000 requests/day per model,
 * 100+ models, no card. Requires a free NVIDIA_API_KEY (user creates it
 * in the NVIDIA Developer Program; never in chat).
 *
 * Model IDs are env config, never hardcoded: NIM_MODEL overrides the
 * default below. The default MUST be verified live at wiring — the NIM
 * catalog moves, same as Groq's.
 *
 * Mirrors src/lib/providers/groq.ts (zod input, requireEnv, retries
 * with backoff, typed ToolRunResult, never a fake success).
 */
import { z } from "zod";
import {
  backoffDelayMs,
  requireEnv,
  sleep,
} from "../../providers/types";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const NIM_TOOL_ID = "nim";

const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const NimInputSchema = z.object({
  prompt: z.string().min(1).max(8000),
  maxTokens: z.number().int().min(64).max(4096).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  model: z.string().min(1).optional(),
});

const MAX_RETRIES = 2;
const TIMEOUT_MS = 60_000;

export function isConfigured(): boolean {
  return requireEnv("NVIDIA_API_KEY") !== null;
}

export function defaultModel(): string {
  // Verified live 2026-11-20: meta/llama-3.1-70b-instruct returns 410
  // (gone from the NIM catalog); nvidia/nemotron-3-ultra-550b-a55b
  // answers 200 with choices. Re-check the live catalog before wiring
  // a different default — NIM rotates models without notice.
  return process.env.NIM_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";
}

function paused(
  req: ToolRunRequest,
  reason: ToolRunResult["pauseReason"],
  code: string,
  message: string,
  started: number
): ToolRunResult {
  return {
    ok: false,
    toolId: NIM_TOOL_ID,
    jobId: req.jobId,
    status: "paused",
    pauseReason: reason,
    usage: { unitsUsed: 0, unit: "requests", costUsd: 0 },
    durationMs: Date.now() - started,
    error: { code, message },
  };
}

export const nimAdapter: ToolAdapter = {
  id: NIM_TOOL_ID,
  capabilities: ["text-llm"],
  isConfigured,
  async run(req: ToolRunRequest): Promise<ToolRunResult> {
    const started = Date.now();
    const parsed = NimInputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused(req, "error", "invalid_input", "Invalid NIM input.", started);
    }
    const apiKey = requireEnv("NVIDIA_API_KEY");
    if (!apiKey) {
      return paused(
        req,
        "not_configured",
        "not_configured",
        "Missing NVIDIA_API_KEY — create a free key in the NVIDIA Developer Program.",
        started
      );
    }
    const { prompt, maxTokens, temperature } = parsed.data;
    const model = parsed.data.model || defaultModel();
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
          if (attempt < MAX_RETRIES) {
            await sleep(backoffDelayMs(attempt, 3000, 30000));
          }
          continue;
        }
        if (!res.ok) {
          lastDetail = `http=${res.status}`;
          if (attempt < MAX_RETRIES) {
            await sleep(backoffDelayMs(attempt, 2000, 20000));
          }
          continue;
        }
        const body = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = body.choices?.[0]?.message?.content?.trim();
        if (!content) {
          return paused(
            req,
            "empty",
            "empty_response",
            "NIM returned no text.",
            started
          );
        }
        return {
          ok: true,
          toolId: NIM_TOOL_ID,
          jobId: req.jobId,
          status: "ok",
          output: { text: content, data: { model } },
          usage: { unitsUsed: 1, unit: "requests", costUsd: 0 },
          durationMs: Date.now() - started,
        };
      } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        lastDetail = msg.includes("abort") ? "timeout" : msg.slice(0, 120);
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelayMs(attempt, 2000, 20000));
        }
      }
    }
    const reason =
      lastDetail === "http=429 rate limited" ? "rate_limited" : "error";
    const code = reason === "rate_limited" ? "rate_limited" : "unavailable";
    return paused(
      req,
      reason,
      code,
      `NIM did not return text after ${MAX_RETRIES + 1} attempts. Last: ${lastDetail}`,
      started
    );
  },
};
