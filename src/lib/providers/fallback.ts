/**
 * Provider failover runner: "one stops → move to the next".
 *
 * Walks the router's usable providers for a task in preference order and
 * tries each one until one succeeds. Every attempt is recorded with the
 * circuit breaker (recordProviderSuccess / recordProviderFailure), so a
 * provider that keeps failing is skipped for an hour instead of being
 * hammered on every scene.
 *
 * Honesty rules: the runner never fabricates output. When every provider
 * fails it returns a typed error listing what each provider reported, so
 * the caller can park the job for review instead of inventing content.
 */
import {
  errResult,
  type ProviderError,
  type ProviderResult,
} from "./types";
import {
  getProviderStatus,
  providersForTask,
  recordProviderFailure,
  recordProviderSuccess,
  type ProviderStatusEntry,
  type TaskType,
} from "./router";

export interface FallbackOutcome<T> {
  ok: boolean;
  /** Provider key that produced the data (or "none" when all failed). */
  provider: string;
  data?: T;
  error?: ProviderError;
  /** Provider keys tried, in order. */
  attempted: string[];
  /** Per-provider failure messages, in attempt order. */
  failures: string[];
}

/**
 * Try providers for `task` in preference order until one succeeds.
 *
 * @param task        Capability to serve ("script" | "image" | "tts" | "video").
 * @param attempt     Called once per usable provider; performs the real call
 *                    and returns its typed ProviderResult.
 * @param providers   Optional override (tests): provider entries to walk
 *                    instead of the router's live list.
 */
export async function attemptWithFallback<T>(
  task: TaskType,
  attempt: (provider: ProviderStatusEntry) => Promise<ProviderResult<T>>,
  providers?: ProviderStatusEntry[]
): Promise<FallbackOutcome<T>> {
  const chain = providers ?? providersForTask(task);
  const attempted: string[] = [];
  const failures: string[] = [];

  if (chain.length === 0) {
    const status = getProviderStatus()
      .filter((p) => p.capabilities.includes(task))
      .map((p) => `${p.key}: ${p.status} (${p.detail.slice(0, 90)})`)
      .join("; ");
    const error: ProviderError = {
      code: "not_configured",
      message: `No usable provider for "${task}". Providers: ${status || "none registered"}.`,
      retryable: false,
    };
    return {
      ok: false,
      provider: "none",
      error,
      attempted,
      failures,
    };
  }

  let lastRetryable = true;
  for (const provider of chain) {
    attempted.push(provider.key);
    let res: ProviderResult<T>;
    try {
      res = await attempt(provider);
    } catch (err) {
      res = errResult<T>(provider.key, {
        code: "upstream_error",
        message: `Provider threw instead of returning a typed result: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`,
        retryable: true,
      });
    }
    if (res.ok) {
      recordProviderSuccess(provider.key);
      return { ok: true, provider: res.provider, data: res.data, attempted, failures };
    }
    recordProviderFailure(provider.key);
    lastRetryable = res.error.retryable;
    failures.push(`${provider.key}: ${res.error.message}`);
  }

  const error: ProviderError = {
    code: "unavailable",
    message: `All ${chain.length} provider(s) failed for "${task}". ${failures.join(" | ")}`,
    // Circuits reset after 1h, so a later retry can plausibly succeed.
    retryable: lastRetryable,
  };
  return { ok: false, provider: "none", error, attempted, failures };
}
