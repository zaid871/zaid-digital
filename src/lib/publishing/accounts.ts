/**
 * Social accounts registry + routing.
 *
 * One login can manage many IG/FB accounts (Meta Business Suite),
 * but each IG account links to exactly one FB Page, and each brand
 * needs its own IG handle — so the system keeps a REGISTRY of
 * accounts and ROUTES each publish to the right one. The registry
 * lives in the ACCOUNTS_JSON env var (deploy-time config, like
 * DM_LINK_MAP_JSON); tokens never live in the registry — each entry
 * names the env vars holding that account's tokens.
 *
 * Routing (accountKeyForProduct): explicit productTypes on an entry
 * win, then the built-in key map (ebooks/templates/spreadsheets/pod/
 * affiliate), then a niche match, then the first account of the
 * right kind (digital catch-all / affiliate). With no registry at
 * all, the legacy single-account env vars (IG_USER_ID etc.) are the
 * "default" account — everything works exactly as before.
 *
 * The n8n publishing workflows call POST /api/v1/publishing/
 * resolve-account with {productType, niche, accountKey?} and use
 * the returned credentials instead of the single $env pair.
 */

export type AccountKind = "affiliate" | "digital";

export interface SocialAccount {
  key: string;
  label: string;
  kind: AccountKind;
  /** Product types this account publishes (ebook, template_pack, ...). */
  productTypes?: string[];
  /** Niches this account serves (wedding, money, fitness, ...). */
  niches?: string[];
  igUserId: string;
  fbPageId: string;
  /** Env var holding this account's IG token (default IG_ACCESS_TOKEN_<KEY>). */
  igTokenEnv?: string;
  /** Env var holding this account's FB Page token (default FB_PAGE_TOKEN_<KEY>). */
  fbTokenEnv?: string;
  /** Env var holding this account's Threads token (default THREADS_ACCESS_TOKEN_<KEY>).
   *  The tech_fynd default account uses the bare THREADS_ACCESS_TOKEN var instead. */
  threadsTokenEnv?: string;
  /** This account's Threads user id (from the OAuth /me call). No token without it. */
  threadsUserId?: string;
}

export interface ResolvedAccount {
  key: string;
  label: string;
  igUserId: string;
  igAccessToken: string;
  fbPageId: string;
  fbPageToken: string;
}

export class AccountError extends Error {
  constructor(
    public code: "account_not_found" | "account_not_configured" | "token_missing",
    message: string
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/** Built-in product-type -> account-key map (the 4 product-type accounts + affiliate). */
const DEFAULT_PRODUCT_TYPES: Record<string, string[]> = {
  ebooks: ["ebook", "coloring_book"],
  templates: ["template_pack", "website"],
  spreadsheets: ["xlsx"],
  pod: ["pod", "pod_design"],
  affiliate: ["affiliate"],
};

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
  return out.length ? out : undefined;
}

function parseAccount(raw: unknown): SocialAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const key = asNonEmptyString(m.key);
  const igUserId = asNonEmptyString(m.igUserId);
  const fbPageId = asNonEmptyString(m.fbPageId);
  if (!key || !igUserId || !fbPageId) return null;
  const kind = m.kind === "affiliate" ? "affiliate" : "digital";
  return {
    key,
    label: asNonEmptyString(m.label) ?? key,
    kind,
    productTypes: asStringArray(m.productTypes),
    niches: asStringArray(m.niches),
    igUserId,
    fbPageId,
    igTokenEnv: asNonEmptyString(m.igTokenEnv) ?? undefined,
    fbTokenEnv: asNonEmptyString(m.fbTokenEnv) ?? undefined,
    threadsTokenEnv: asNonEmptyString(m.threadsTokenEnv) ?? undefined,
    threadsUserId: asNonEmptyString(m.threadsUserId) ?? undefined,
  };
}

/** Parse ACCOUNTS_JSON. Invalid JSON / non-array / bad entries -> skipped, never throws. */
export function loadAccounts(env: Record<string, string | undefined> = process.env): SocialAccount[] {
  const raw = env.ACCOUNTS_JSON;
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: SocialAccount[] = [];
  for (const entry of parsed) {
    const account = parseAccount(entry);
    if (!account || seen.has(account.key)) continue;
    seen.add(account.key);
    out.push(account);
  }
  return out;
}

function defaultTokenEnv(prefix: string, key: string): string {
  return `${prefix}_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** Pure routing: which registry key publishes this product? Null = no match.
 *
 * Affiliate products route by NICHE first: the affiliate side is niche
 * accounts (tech, gadgets), not one "affiliate" account. Digital
 * products route by product type; niche is only a fallback there. */
export function accountKeyForProduct(
  accounts: SocialAccount[],
  productType?: string,
  niche?: string
): string | null {
  const type = (productType ?? "").trim().toLowerCase();
  const nicheNorm = (niche ?? "").trim().toLowerCase();
  if (type === "affiliate") {
    if (nicheNorm) {
      const byNiche = accounts.find(
        (a) => a.kind === "affiliate" && (a.niches ?? []).some((n) => n.toLowerCase() === nicheNorm)
      );
      if (byNiche) return byNiche.key;
    }
    const aff = accounts.find((a) => a.kind === "affiliate");
    if (aff) return aff.key;
  }
  if (type) {
    const explicit = accounts.find((a) => (a.productTypes ?? []).some((t) => t.toLowerCase() === type));
    if (explicit) return explicit.key;
    for (const [key, types] of Object.entries(DEFAULT_PRODUCT_TYPES)) {
      if (types.includes(type) && accounts.some((a) => a.key === key)) return key;
    }
  }
  if (nicheNorm) {
    const byNiche = accounts.find((a) => (a.niches ?? []).some((n) => n.toLowerCase() === nicheNorm));
    if (byNiche) return byNiche.key;
  }
  const digital = accounts.find((a) => a.kind === "digital");
  return digital ? digital.key : null;
}

export interface ResolveInput {
  accountKey?: string;
  productType?: string;
  niche?: string;
}

/**
 * Resolve the account for a publish. Throws AccountError when nothing
 * is configured, the named key is unknown, or the account's tokens
 * are missing from the environment.
 */
export function resolveAccount(
  input: ResolveInput = {},
  env: Record<string, string | undefined> = process.env
): ResolvedAccount {
  const accounts = loadAccounts(env);
  let account: SocialAccount | undefined;
  if (input.accountKey) {
    account = accounts.find((a) => a.key === input.accountKey);
    if (!account) {
      throw new AccountError(
        "account_not_found",
        `Account "${input.accountKey}" registry mein nahi hai (ACCOUNTS_JSON check karein).`
      );
    }
  } else if (accounts.length > 0) {
    const key = accountKeyForProduct(accounts, input.productType, input.niche);
    if (!key) {
      throw new AccountError(
        "account_not_configured",
        `Product type "${input.productType ?? ""}" ke liye koi account nahi hai — ACCOUNTS_JSON mein entry add karein.`
      );
    }
    account = accounts.find((a) => a.key === key);
  } else {
    // No registry: legacy single-account env vars (backward compatible).
    const igUserId = (env.IG_USER_ID ?? "").trim();
    const fbPageId = (env.FB_PAGE_ID ?? "").trim();
    if (!igUserId && !fbPageId) {
      throw new AccountError(
        "account_not_configured",
        "Koi social account configure nahi hai — ACCOUNTS_JSON ya legacy IG_USER_ID/FB_PAGE_ID set karein."
      );
    }
    account = {
      key: "default",
      label: "Default",
      kind: "digital",
      igUserId,
      fbPageId,
      igTokenEnv: "IG_ACCESS_TOKEN",
      fbTokenEnv: "FB_PAGE_TOKEN",
    };
  }
  if (!account) {
    // Reachable only when routing returned a key with no matching entry.
    throw new AccountError(
      "account_not_configured",
      `Product type "${input.productType ?? ""}" ke liye koi account nahi hai — ACCOUNTS_JSON mein entry add karein.`
    );
  }
  const igTokenEnv = account.igTokenEnv ?? defaultTokenEnv("IG_ACCESS_TOKEN", account.key);
  const fbTokenEnv = account.fbTokenEnv ?? defaultTokenEnv("FB_PAGE_TOKEN", account.key);
  const igAccessToken = (env[igTokenEnv] ?? "").trim();
  const fbPageToken = (env[fbTokenEnv] ?? "").trim();
  if (!igAccessToken || !fbPageToken) {
    const missing = [!igAccessToken ? igTokenEnv : null, !fbPageToken ? fbTokenEnv : null]
      .filter(Boolean)
      .join(", ");
    throw new AccountError(
      "token_missing",
      `Account "${account.key}" ke token nahi mile — env var set karein: ${missing}.`
    );
  }
  return {
    key: account.key,
    label: account.label,
    igUserId: account.igUserId,
    igAccessToken,
    fbPageId: account.fbPageId,
    fbPageToken,
  };
}
