/**
 * Affiliate link validator (§4: "Valid affiliate links use karna",
 * "Broken links detect karna").
 *
 * Follows redirects manually with a per-hop timeout and reports:
 *  - valid:      final response is 2xx with no redirects followed
 *  - redirected: ≥1 redirect followed, final response is 2xx
 *  - broken:     network error, timeout, 4xx/5xx, redirect loop, or bad URL
 *
 * Guarantees:
 *  - Never fabricates links: only server-issued `Location` targets are
 *    followed, resolved against the current URL. No guessing, no rewriting.
 *  - A "valid" result is a network fact only — it says nothing about affiliate
 *    programme approval, commission tracking, or product availability.
 */
export type LinkStatus = "valid" | "broken" | "redirected";

export interface LinkValidationResult {
  status: LinkStatus;
  /** Final HTTP status, or null when no HTTP response was received. */
  httpStatus: number | null;
  /** Last URL reached (== input when nothing was followed). */
  finalUrl: string;
}

export interface ValidateLinkOptions {
  /** Per-hop timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Max redirects to follow before giving up. Default 5. */
  maxRedirects?: number;
  /** Injectable fetch — tests pass a mock; no real HTTP in unit tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

export async function validateLink(
  rawUrl: string,
  options: ValidateLinkOptions = {},
): Promise<LinkValidationResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    fetchImpl = fetch,
  } = options;

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { status: "broken", httpStatus: null, finalUrl: rawUrl };
  }
  if (current.protocol !== "http:" && current.protocol !== "https:") {
    return { status: "broken", httpStatus: null, finalUrl: rawUrl };
  }

  let redirects = 0;
  let httpStatus: number | null = null;

  try {
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      httpStatus = response.status;

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { status: "broken", httpStatus, finalUrl: current.toString() };
        }
        if (redirects >= maxRedirects) {
          // Redirect loop / chain too long: report where it pointed last.
          return {
            status: "broken",
            httpStatus,
            finalUrl: new URL(location, current).toString(),
          };
        }
        redirects += 1;
        current = new URL(location, current);
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        return {
          status: redirects > 0 ? "redirected" : "valid",
          httpStatus,
          finalUrl: current.toString(),
        };
      }
      return { status: "broken", httpStatus, finalUrl: current.toString() };
    }
  } catch {
    // Network error, DNS failure, or timeout (AbortError).
    return { status: "broken", httpStatus, finalUrl: current.toString() };
  }
}
