/**
 * Resend email adapter — free tier.
 *
 * Endpoint: POST https://api.resend.com/emails
 * Free tier (verified 2026-11-16): 3,000 emails/mo, 100/day, 3 domains,
 * no approval step. Requires a free RESEND_API_KEY (user creates it;
 * never in chat). The `from` address must belong to a domain verified
 * in Resend — otherwise Resend rejects with 422.
 *
 * Mirrors the NIM adapter pattern: zod input, requireEnv, typed
 * ToolRunResult, never a fake success.
 */
import { z } from "zod";
import { requireEnv } from "../../providers/types";
import type { ToolAdapter, ToolRunRequest, ToolRunResult } from "../types";

export const RESEND_TOOL_ID = "resend";

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 30_000;

const ResendInputSchema = z
  .object({
    from: z.string().min(1).max(200),
    to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    subject: z.string().min(1).max(500),
    text: z.string().max(100_000).optional(),
    html: z.string().max(100_000).optional(),
  })
  .refine((v) => v.text || v.html, {
    message: "Provide text or html.",
  });

export function isConfigured(): boolean {
  return requireEnv("RESEND_API_KEY") !== null;
}

export const resendAdapter: ToolAdapter = {
  id: RESEND_TOOL_ID,
  capabilities: ["email"],
  isConfigured,
  async run(req: ToolRunRequest): Promise<ToolRunResult> {
    const started = Date.now();
    const paused = (
      reason: ToolRunResult["pauseReason"],
      code: string,
      message: string
    ): ToolRunResult => ({
      ok: false,
      toolId: RESEND_TOOL_ID,
      jobId: req.jobId,
      status: "paused",
      pauseReason: reason,
      usage: { unitsUsed: 0, unit: "emails", costUsd: 0 },
      durationMs: Date.now() - started,
      error: { code, message },
    });
    const parsed = ResendInputSchema.safeParse(req.input);
    if (!parsed.success) {
      return paused("error", "invalid_input", "Invalid Resend input.");
    }
    const apiKey = requireEnv("RESEND_API_KEY");
    if (!apiKey) {
      return paused(
        "not_configured",
        "not_configured",
        "Missing RESEND_API_KEY — create a free key at resend.com."
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        let detail = `http=${res.status}`;
        try {
          const body = (await res.json()) as { message?: string };
          if (body.message) detail = body.message.slice(0, 200);
        } catch {
          // Keep the HTTP status as the detail.
        }
        if (res.status === 429) {
          return paused("rate_limited", "rate_limited", `Resend rate limited. ${detail}`);
        }
        return paused("error", "upstream_error", `Resend rejected the email. ${detail}`);
      }
      const body = (await res.json()) as { id?: string };
      return {
        ok: true,
        toolId: RESEND_TOOL_ID,
        jobId: req.jobId,
        status: "ok",
        output: { data: { id: body.id ?? null } },
        usage: { unitsUsed: 1, unit: "emails", costUsd: 0 },
        durationMs: Date.now() - started,
      };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) {
        return paused("timeout", "timeout", "Resend timed out.");
      }
      return paused("error", "unavailable", `Resend unreachable: ${msg.slice(0, 120)}`);
    }
  },
};
