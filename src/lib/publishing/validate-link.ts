/**
 * Link validation — the affiliate technique ported to digital.
 *
 * Affiliate side: `affiliate/link-validation` (webhook
 * `affiliate/affiliate-check`) does a HEAD/GET reachability check and
 * marks a broken URL NEEDS_REVIEW. This lib is the same check as a
 * backend function, used by the digital ads-marketing workflow's
 * validate step (a dead product link is invalid input — the ad would
 * point nowhere) and by the QC check below.
 *
 * Safety: public http(s) only — localhost / private addresses are
 * never fetched (SSRF gate, same rule as the promote URL gate).
 */
export type FetchFn = typeof fetch;

export interface LinkCheckResult {
  url: string;
  reachable: boolean;
  status: number | null;
  note: string;
}

export function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "127.0.0.1" || h === "[::1]") return true;
  return false;
}

/** Reachability check. Never throws: any failure -> reachable:false. */
export async function checkLink(rawUrl: string, fetchFn: FetchFn = fetch): Promise<LinkCheckResult> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return { url: rawUrl, reachable: false, status: null, note: "URL parse nahi hui — valid http(s) URL do" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { url: rawUrl, reachable: false, status: null, note: "Sirf http(s) URLs check hote hain" };
  }
  if (!u.hostname || isPrivateHostname(u.hostname)) {
    return { url: rawUrl, reachable: false, status: null, note: "Local/private address check nahi hota — public URL do" };
  }
  try {
    let res = await fetchFn(u.toString(), {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    // Some servers refuse HEAD — fall back to GET.
    if (res.status === 405 || res.status === 501) {
      res = await fetchFn(u.toString(), {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
    }
    const ok = res.status >= 200 && res.status < 400;
    return {
      url: rawUrl,
      reachable: ok,
      status: res.status,
      note: ok ? "Link reachable hai" : `Server ne HTTP ${res.status} diya`,
    };
  } catch (err) {
    return {
      url: rawUrl,
      reachable: false,
      status: null,
      note: err instanceof Error ? `Fetch fail hua: ${err.message}` : "Fetch fail hua",
    };
  }
}
