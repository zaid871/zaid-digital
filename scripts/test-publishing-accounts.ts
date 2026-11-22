/**
 * test-publishing-accounts: accounts registry parsing, routing, and
 * credential resolution (pure — no network, no disk).
 * Run: npx tsx scripts/test-publishing-accounts.ts
 */
import {
  AccountError,
  accountKeyForProduct,
  loadAccounts,
  resolveAccount,
  type SocialAccount,
} from "../src/lib/publishing/accounts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

function envWith(accounts: SocialAccount[], tokens: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ACCOUNTS_JSON: JSON.stringify(accounts), ...tokens };
  return env;
}

const REGISTRY: SocialAccount[] = [
  { key: "affiliate", label: "Affiliate Brand", kind: "affiliate", igUserId: "ig-aff", fbPageId: "fb-aff" },
  { key: "ebooks", label: "Ebooks", kind: "digital", productTypes: ["ebook", "coloring_book"], igUserId: "ig-ebooks", fbPageId: "fb-ebooks" },
  { key: "templates", label: "Templates", kind: "digital", igUserId: "ig-templates", fbPageId: "fb-templates" },
  { key: "pod", label: "POD", kind: "digital", niches: ["fitness"], igUserId: "ig-pod", fbPageId: "fb-pod" },
];

const TOKENS: Record<string, string> = {
  IG_ACCESS_TOKEN_AFFILIATE: "tok-ig-aff",
  FB_PAGE_TOKEN_AFFILIATE: "tok-fb-aff",
  IG_ACCESS_TOKEN_EBOOKS: "tok-ig-ebooks",
  FB_PAGE_TOKEN_EBOOKS: "tok-fb-ebooks",
  IG_ACCESS_TOKEN_TEMPLATES: "tok-ig-templates",
  FB_PAGE_TOKEN_TEMPLATES: "tok-fb-templates",
  IG_ACCESS_TOKEN_POD: "tok-ig-pod",
  FB_PAGE_TOKEN_POD: "tok-fb-pod",
};

async function main() {
  // --- Parsing ---
  check("valid registry loads all 4", loadAccounts(envWith(REGISTRY, {})).length === 4);
  check("invalid JSON -> empty, never throws", loadAccounts({ ACCOUNTS_JSON: "{not json" }).length === 0);
  check("missing ACCOUNTS_JSON -> empty", loadAccounts({}).length === 0);
  check("non-array JSON -> empty", loadAccounts({ ACCOUNTS_JSON: "{\"key\":\"x\"}" }).length === 0);
  check("entries missing ids are skipped",
    loadAccounts({ ACCOUNTS_JSON: JSON.stringify([{ key: "bad" }, ...REGISTRY]) }).length === 4);
  check("duplicate keys deduped",
    loadAccounts({ ACCOUNTS_JSON: JSON.stringify([REGISTRY[0], REGISTRY[0]]) }).length === 1);

  // --- Routing (pure) ---
  const accounts = loadAccounts(envWith(REGISTRY, {}));
  check("ebook -> ebooks", accountKeyForProduct(accounts, "ebook") === "ebooks");
  check("coloring_book -> ebooks", accountKeyForProduct(accounts, "coloring_book") === "ebooks");
  check("template_pack -> templates (built-in key map)", accountKeyForProduct(accounts, "template_pack") === "templates");
  check("website -> templates (rides on Templates)", accountKeyForProduct(accounts, "website") === "templates");
  check("xlsx -> first digital account (no spreadsheets account in registry)",
    accountKeyForProduct(accounts, "xlsx") === "ebooks", accountKeyForProduct(accounts, "xlsx") ?? "null");
  check("pod_design -> pod", accountKeyForProduct(accounts, "pod_design") === "pod");
  check("affiliate -> affiliate", accountKeyForProduct(accounts, "affiliate") === "affiliate");
  check("unknown type + niche fitness -> pod", accountKeyForProduct(accounts, "planner", "fitness") === "pod");
  check("unknown type, no niche -> first digital account",
    accountKeyForProduct(accounts, "planner") === "ebooks");
  check("no accounts -> null", accountKeyForProduct([], "ebook") === null);

  // --- Affiliate niches: two affiliate accounts route by niche ---
  const nicheAccounts: SocialAccount[] = [
    { key: "tech", label: "Tech Finds", kind: "affiliate", niches: ["tech"], igUserId: "ig-tech", fbPageId: "fb-tech" },
    { key: "gadgets", label: "Useful Gadgets", kind: "affiliate", niches: ["gadgets"], igUserId: "ig-gadgets", fbPageId: "fb-gadgets" },
    { key: "ebooks", label: "Ebooks", kind: "digital", igUserId: "ig-ebooks", fbPageId: "fb-ebooks" },
  ];
  check("affiliate + tech niche -> tech account",
    accountKeyForProduct(nicheAccounts, "affiliate", "tech") === "tech");
  check("affiliate + gadgets niche -> gadgets account",
    accountKeyForProduct(nicheAccounts, "affiliate", "gadgets") === "gadgets");
  check("affiliate, no niche -> first affiliate account",
    accountKeyForProduct(nicheAccounts, "affiliate") === "tech");
  check("affiliate + unknown niche -> first affiliate account (never digital)",
    accountKeyForProduct(nicheAccounts, "affiliate", "fashion") === "tech");
  const nicheEnv = envWith(nicheAccounts, {
    IG_ACCESS_TOKEN_TECH: "tok-ig-tech",
    FB_PAGE_TOKEN_TECH: "tok-fb-tech",
    IG_ACCESS_TOKEN_GADGETS: "tok-ig-gadgets",
    FB_PAGE_TOKEN_GADGETS: "tok-fb-gadgets",
    IG_ACCESS_TOKEN_EBOOKS: "tok-ig-ebooks",
    FB_PAGE_TOKEN_EBOOKS: "tok-fb-ebooks",
  });
  const gadgets = resolveAccount({ productType: "affiliate", niche: "gadgets" }, nicheEnv);
  check("resolve affiliate gadgets returns gadgets account + tokens",
    gadgets.key === "gadgets" && gadgets.igUserId === "ig-gadgets" && gadgets.fbPageToken === "tok-fb-gadgets");

  // --- Resolution (tokens from named env vars) ---
  const env = envWith(REGISTRY, TOKENS);
  const ebooks = resolveAccount({ productType: "ebook" }, env);
  check("resolve ebook returns ebooks account", ebooks.key === "ebooks" && ebooks.igUserId === "ig-ebooks");
  check("resolve ebook returns its own tokens",
    ebooks.igAccessToken === "tok-ig-ebooks" && ebooks.fbPageToken === "tok-fb-ebooks");
  const aff = resolveAccount({ productType: "affiliate" }, env);
  check("resolve affiliate returns affiliate account + tokens",
    aff.key === "affiliate" && aff.igAccessToken === "tok-ig-aff" && aff.fbPageId === "fb-aff");
  const byKey = resolveAccount({ accountKey: "pod" }, env);
  check("explicit accountKey wins over routing", byKey.key === "pod" && byKey.igUserId === "ig-pod");
  const byNiche = resolveAccount({ productType: "planner", niche: "fitness" }, env);
  check("resolve by niche", byNiche.key === "pod");

  let err: unknown = null;
  try { resolveAccount({ accountKey: "nope" }, env); } catch (e) { err = e; }
  check("unknown accountKey throws account_not_found",
    err instanceof AccountError && err.code === "account_not_found", String(err));

  err = null;
  try { resolveAccount({ productType: "ebook" }, envWith(REGISTRY, {})); } catch (e) { err = e; }
  check("missing tokens throw token_missing naming the var",
    err instanceof AccountError && err.code === "token_missing" && String(err).includes("IG_ACCESS_TOKEN_EBOOKS"), String(err));

  // Custom token env names on the entry are honoured.
  const customEnv = envWith(
    [{ key: "custom", label: "Custom", kind: "digital", igUserId: "ig-c", fbPageId: "fb-c", igTokenEnv: "MY_IG_TOKEN", fbTokenEnv: "MY_FB_TOKEN" }],
    { MY_IG_TOKEN: "tok-ig-c", MY_FB_TOKEN: "tok-fb-c" }
  );
  const custom = resolveAccount({ accountKey: "custom" }, customEnv);
  check("custom token env names honoured", custom.igAccessToken === "tok-ig-c" && custom.fbPageToken === "tok-fb-c");

  // --- Legacy fallback (no registry) ---
  const legacy = resolveAccount({}, { IG_USER_ID: "ig-old", IG_ACCESS_TOKEN: "tok-ig-old", FB_PAGE_ID: "fb-old", FB_PAGE_TOKEN: "tok-fb-old" });
  check("legacy fallback resolves as default", legacy.key === "default" && legacy.igUserId === "ig-old" && legacy.fbPageToken === "tok-fb-old");
  err = null;
  try { resolveAccount({}, {}); } catch (e) { err = e; }
  check("nothing configured throws account_not_configured",
    err instanceof AccountError && err.code === "account_not_configured", String(err));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
