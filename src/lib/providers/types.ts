/**
 * Shared types for the free provider adapters.
 *
 * Every adapter returns honest, typed results: real output is marked
 * `simulated: false`; anything that could not be produced is a typed
 * error (never fabricated). Experimental adapters additionally set
 * `experimental: true`.
 */
import { z } from "zod";

export const ProviderErrorCodeSchema = z.enum([
  "not_configured",
  "rate_limited",
  "unavailable",
  "timeout",
  "invalid_input",
  "upstream_error",
  "dependency_missing",
  "billing", // provider needs paid credits (e.g. HF Inference Providers on a free account)
]);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  /** True when retrying later (or via a fallback) could plausibly succeed. */
  retryable: boolean;
  /** Suggested fallback provider key, when one exists (e.g. "ffmpeg-motion"). */
  fallback?: string;
}

export interface ProviderResultMeta {
  provider: string;
  model?: string;
  /** Always false for real adapter output; true only for explicitly-marked simulations. */
  simulated: boolean;
  /** True for Tier A / hacky adapters whose output must not be trusted blindly. */
  experimental?: boolean;
  /** Milliseconds the upstream call took. */
  durationMs?: number;
}

export type ProviderResult<T> =
  | ({ ok: true; data: T } & ProviderResultMeta)
  | ({ ok: false; error: ProviderError } & ProviderResultMeta);

export function okResult<T>(
  provider: string,
  data: T,
  meta: Partial<ProviderResultMeta> = {}
): ProviderResult<T> {
  return { ok: true, provider, simulated: false, data, ...meta };
}

export function errResult<T>(
  provider: string,
  error: ProviderError,
  meta: Partial<ProviderResultMeta> = {}
): ProviderResult<T> {
  return { ok: false, provider, simulated: false, error, ...meta };
}

/** Bounded exponential backoff with jitter. Returns delay in ms for attempt n (0-based). */
export function backoffDelayMs(attempt: number, baseMs = 2000, maxMs = 30000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read a secret env var. Never logs or echoes the value — callers must only
 * pass it into Authorization headers.
 */
export function requireEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : null;
}
