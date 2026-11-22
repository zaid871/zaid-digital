/**
 * Unit tests for the product discovery agent (§3) — src/lib/discovery.
 * Pure unit tests: DiscoverySources are mocked, no network, no DB.
 * Run: npx tsx scripts/test-discovery.ts
 */
import {
  AFFILIATE_NICHES,
  ALLOWED_CATEGORIES,
  affiliateNicheForCategory,
  dedupHash,
  dedupeCandidates,
  isAllowedCategory,
  normalizeForDedup,
  prefilterCandidate,
  runDiscovery,
  trendingScore,
} from "../src/lib/discovery";
import type { DiscoverySource, ProductCandidate } from "../src/lib/discovery";
import { searchAds, summarizeAds, SELLER_KEYWORDS } from "../src/lib/discovery/meta-ad-library";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    name: "Aurora X1 Wireless Earbuds",
    brand: "Aurora",
    category: "electronics",
    features: ["Bluetooth 5.3", "30h battery"],
    sourceUrls: ["https://example.com/aurora-x1"],
    claims: [{ text: "Bluetooth 5.3 connectivity", verified: true }],
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

const NOW = new Date("2026-11-20T00:00:00.000Z");

const API_OK = {
  data: [
    {
      id: "111",
      page_id: "p1",
      page_name: "Seller One",
      ad_creation_time: "2026-10-01T00:00:00+0000",
      ad_delivery_start_time: "2026-10-05T00:00:00+0000",
      ad_delivery_stop_time: "",
      ad_creative_bodies: ["Budget planner ebook — instant download"],
      ad_creative_link_titles: ["Budget Planner"],
      ad_snapshot_url: "https://example.com/snap/111",
    },
    {
      id: "222",
      page_id: "p1",
      page_name: "Seller One",
      ad_creation_time: "2026-11-01T00:00:00+0000",
      ad_creative_bodies: ["Budget planner bundle — 5 templates"],
      ad_creative_link_titles: ["Planner Bundle"],
      ad_snapshot_url: "https://example.com/snap/222",
    },
    {
      id: "333",
      page_id: "p2",
      page_name: "Seller Two",
      ad_creation_time: "2026-11-10T00:00:00+0000",
      ad_delivery_start_time: "2026-11-12T00:00:00+0000",
      ad_delivery_stop_time: "2026-11-15T00:00:00+0000",
      ad_creative_bodies: ["Budget planner ebook — instant download"],
      ad_creative_link_titles: ["Budget Planner"],
      ad_snapshot_url: "https://example.com/snap/333",
    },
    { id: "", page_id: "p3", page_name: "No ID" }, // dropped: no ad id
  ],
  paging: { cursors: { after: "CURSOR123" } },
};

function stubFetch(body: unknown, status = 200, capture?: { url?: string }): typeof fetch {
  return (async (url: unknown) => {
    if (capture) capture.url = String(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

// ---- normalization + hashing ----

async function main() {
  check(
    "normalizeForDedup lowercases/trims/collapses",
    normalizeForDedup("  Hello   WORLD\n") === "hello world",
  );
  const h1 = dedupHash("Aurora X1", "Aurora");
  const h2 = dedupHash("  aurora   x1 ", " AURORA ");
  check("dedupHash is deterministic across case/whitespace", h1 === h2, `${h1.slice(0, 12)}…`);
  check("dedupHash is 64-char hex", /^[0-9a-f]{64}$/.test(h1));
  check(
    "dedupHash differs by brand",
    dedupHash("Aurora X1", "Aurora") !== dedupHash("Aurora X1", "Nova"),
  );
  check(
    "dedupHash differs by name",
    dedupHash("Aurora X1", "Aurora") !== dedupHash("Aurora X2", "Aurora"),
  );
  check(
    "dedupHash tolerates missing brand",
    dedupHash("Aurora X1") === dedupHash("Aurora X1", null),
  );

  // ---- dedupeCandidates ----
  {
    const a = candidate();
    const b = candidate({ name: "  AURORA X1 wireless EARBUDS  " }); // same product, messy casing
    const c = candidate({ name: "Nova Y2 Speaker", brand: "Nova" });
    const { unique, duplicates } = dedupeCandidates([a, b, c]);
    check("dedupe keeps first occurrence", unique.length === 2);
    check("dedupe records the duplicate", duplicates.length === 1);
    check(
      "duplicate record carries the hash",
      duplicates[0]?.dedupHash === dedupHash(a.name, a.brand),
    );
  }

  // ---- category allowlist ----
  check("electronics is allowed", isAllowedCategory("electronics"));
  check("kitchen is allowed", isAllowedCategory("kitchen"));
  check(
    "all listed categories allowed",
    ALLOWED_CATEGORIES.every((c) => isAllowedCategory(c)),
  );
  check("alcohol category rejected", !isAllowedCategory("alcohol"));
  check("empty category rejected", !isAllowedCategory(""));

  // ---- pre-filter ----
  check("clean candidate APPROVED", prefilterCandidate(candidate()).verdict === "APPROVED");
  {
    const r = prefilterCandidate(candidate({ category: "weapons" }));
    check("non-allowlisted category REJECTED", r.verdict === "REJECTED");
  }
  {
    const r = prefilterCandidate(
      candidate({ name: "Premium Vodka Gift Set", category: "other_permissible" }),
    );
    check("disallowed product name REJECTED", r.verdict === "REJECTED");
  }
  {
    const r = prefilterCandidate(
      candidate({
        name: "Stainless Steel Bar Set",
        description: "Includes a wine opener and cocktail shaker.",
      }),
    );
    check(
      "disallowed mention in description NEEDS_REVIEW",
      r.verdict === "NEEDS_REVIEW",
    );
  }
  {
    const r = prefilterCandidate(
      candidate({ claims: [{ text: "Cures all headaches", verified: false }] }),
    );
    check("unverified claim NEEDS_REVIEW", r.verdict === "NEEDS_REVIEW");
  }
  {
    const r = prefilterCandidate(
      candidate({
        claims: [
          { text: "Bluetooth 5.3 connectivity", verified: true },
          { text: "30h battery", verified: true },
        ],
      }),
    );
    check("all claims verified APPROVED", r.verdict === "APPROVED");
  }

  // ---- affiliate scope: Tech + Useful Gadgets only (2026-11-20) ----
  check(
    "affiliate niches are tech + gadgets",
    AFFILIATE_NICHES.length === 2 &&
      AFFILIATE_NICHES.includes("tech") &&
      AFFILIATE_NICHES.includes("gadgets"),
  );
  check("electronics maps to tech", affiliateNicheForCategory("electronics") === "tech");
  check(
    "mobile_accessories maps to tech",
    affiliateNicheForCategory("mobile_accessories") === "tech",
  );
  check(
    "computers_ai_tools maps to tech",
    affiliateNicheForCategory("computers_ai_tools") === "tech",
  );
  check(
    "useful_physical maps to gadgets",
    affiliateNicheForCategory("useful_physical") === "gadgets",
  );
  check("kitchen has no affiliate niche", affiliateNicheForCategory("kitchen") === null);
  check("household has no affiliate niche", affiliateNicheForCategory("household") === null);
  check(
    "digital_products_templates has no affiliate niche",
    affiliateNicheForCategory("digital_products_templates") === null,
  );
  {
    const r = prefilterCandidate(candidate(), { affiliateOnly: true });
    check("affiliateOnly: electronics APPROVED", r.verdict === "APPROVED");
  }
  {
    const r = prefilterCandidate(candidate({ category: "useful_physical" }), {
      affiliateOnly: true,
    });
    check("affiliateOnly: useful_physical APPROVED", r.verdict === "APPROVED");
  }
  {
    const r = prefilterCandidate(candidate({ category: "kitchen" }), { affiliateOnly: true });
    check("affiliateOnly: kitchen REJECTED", r.verdict === "REJECTED");
  }
  {
    const r = prefilterCandidate(candidate({ category: "digital_products_templates" }), {
      affiliateOnly: true,
    });
    check("affiliateOnly: digital template REJECTED", r.verdict === "REJECTED");
  }
  {
    // Default (no opts) keeps the general allowlist: kitchen still passes.
    const r = prefilterCandidate(candidate({ category: "kitchen" }));
    check("default prefilter: kitchen still APPROVED", r.verdict === "APPROVED");
  }

  // ---- runDiscovery orchestration ----
  {
    const clean = candidate();
    const dup = candidate({ name: "aurora X1 WIRELESS earbuds" });
    const bad = candidate({ name: "Casino Night Poker Set", category: "other_permissible" });
    const sourceA: DiscoverySource = {
      name: "source-a",
      fetchCandidates: async () => [clean, bad],
    };
    const sourceB: DiscoverySource = {
      name: "source-b",
      fetchCandidates: async () => [dup],
    };
    const failing: DiscoverySource = {
      name: "source-fail",
      fetchCandidates: async () => {
        throw new Error("feed exploded");
      },
    };
    const result = await runDiscovery([sourceA, failing, sourceB]);
    check("runDiscovery approves the clean candidate", result.approved.length === 1);
    check("runDiscovery rejects the disallowed candidate", result.rejected.length === 1);
    check("runDiscovery dedupes across sources", result.duplicates.length === 1);
    check(
      "failing source recorded, run continues",
      result.errors.length === 1 && result.errors[0]?.source === "source-fail",
    );
  }

  // ---- trending score stub ----
  {
    const empty = trendingScore({});
    check("trendingScore in [0,1]", empty >= 0 && empty <= 1, String(empty));
    check(
      "better rank scores higher",
      trendingScore({ sourceRank: 1 }) > trendingScore({ sourceRank: 10 }),
    );
    check(
      "trendingScore is deterministic",
      trendingScore({ sourceRank: 2, mentionCount: 5 }) ===
        trendingScore({ sourceRank: 2, mentionCount: 5 }),
    );
  }

    // --- Meta Ad Library adapter (Utkarsh Gose; mocked fetch, no live call) ---

  const fetchFn = stubFetch(API_OK);

  // Parse: 3 usable ads (the no-id row is dropped).
  {
    const r = await searchAds(["ebook", "templates"], "IN", { token: "fake-token", fetchFn });
    check("parse: 3 ads returned", r.ads.length === 3, String(r.ads.length));
    check("parse: no warnings on success", r.warnings.length === 0, r.warnings.join("; "));
    check("parse: next cursor returned", r.nextCursor === "CURSOR123", String(r.nextCursor));
  }

  // Time prefers ad_delivery_start_time over ad_creation_time.
  {
    const r = await searchAds(["ebook"], "IN", { token: "fake-token", fetchFn });
    const ad111 = r.ads.find((a) => a.adId === "111");
    check("time: delivery start preferred", ad111?.startedAt === "2026-10-05T00:00:00+0000", String(ad111?.startedAt));
    const ad222 = r.ads.find((a) => a.adId === "222");
    check("time: creation time fallback", ad222?.startedAt === "2026-11-01T00:00:00+0000", String(ad222?.startedAt));
  }

  // Active flag: no stop time = active; stop time = inactive.
  {
    const r = await searchAds(["ebook"], "IN", { token: "fake-token", fetchFn });
    check("active: no stop time = active", r.ads.find((a) => a.adId === "111")?.active === true);
    check("active: stop time = inactive", r.ads.find((a) => a.adId === "333")?.active === false);
  }

  // Request shape: endpoint + required params.
  {
    const capture: { url?: string } = {};
    await searchAds(["ebook", "templates"], ["IN", "US"], { token: "fake-token", fetchFn: stubFetch(API_OK, 200, capture) });
    const url = capture.url ?? "";
    check("request: graph ads_archive endpoint", url.startsWith("https://graph.facebook.com/v21.0/ads_archive?"), url.slice(0, 80));
    check("request: search_terms sent", url.includes("search_terms=ebook+templates") || url.includes("search_terms=ebook%20templates"), url);
    check("request: countries sent", url.includes("ad_reached_countries=") && url.includes("IN"), url);
    check("request: ad_type ALL sent", url.includes("ad_type=ALL"), url);
  }

  // summarizeAds: oldest age, versions (distinct bodies), sellers (distinct pages).
  {
    const r = await searchAds(["ebook"], "IN", { token: "fake-token", fetchFn });
    const s = summarizeAds(r.ads, NOW);
    check("summary: 3 ads", s.adCount === 3, String(s.adCount));
    // Oldest start is 2026-10-05 → 46 days before 2026-11-20.
    check("summary: oldest age 46 days", s.oldestAdAgeDays === 46, String(s.oldestAdAgeDays));
    // Bodies: "Budget planner ebook…" (111 + 333, same text) + "Budget planner bundle…" = 2.
    check("summary: 2 distinct creatives", s.versionCount === 2, String(s.versionCount));
    // Pages: p1 + p2 = 2 sellers.
    check("summary: 2 distinct sellers", s.sellerCount === 2, String(s.sellerCount));
    check("summary: 2 active", s.activeCount === 2, String(s.activeCount));
    check("summary: seller names listed", s.sellers.includes("Seller One") && s.sellers.includes("Seller Two"));
  }

  // summarizeAds: empty list → null age, zero counts.
  {
    const s = summarizeAds([], NOW);
    check("summary empty: null age, zeros", s.oldestAdAgeDays === null && s.versionCount === 0 && s.sellerCount === 0);
  }

  // No token → skip with warning, never throw.
  {
    const r = await searchAds(["ebook"], "IN", { token: "", fetchFn });
    check("no token: empty + warning", r.ads.length === 0 && r.warnings.some((w) => w.includes("no_token")), r.warnings.join("; "));
  }

  // 401 → auth warning; 429 → rate-limit warning.
  {
    const r401 = await searchAds(["ebook"], "IN", { token: "bad", fetchFn: stubFetch({ error: "x" }, 401) });
    check("401: auth warning", r401.ads.length === 0 && r401.warnings.some((w) => w.includes("auth")), r401.warnings.join("; "));
    const r429 = await searchAds(["ebook"], "IN", { token: "t", fetchFn: stubFetch({ error: "x" }, 429) });
    check("429: rate-limit warning", r429.ads.length === 0 && r429.warnings.some((w) => w.includes("rate_limited")), r429.warnings.join("; "));
  }

  // Bad JSON → warning, never throw.
  {
    const badJson = (async () => new Response("<html>bot wall</html>", { status: 200 })) as unknown as typeof fetch;
    const r = await searchAds(["ebook"], "IN", { token: "t", fetchFn: badJson });
    check("bad JSON: warning, no crash", r.ads.length === 0 && r.warnings.some((w) => w.includes("bad_json")), r.warnings.join("; "));
  }

  // search_terms over 100 chars → truncated with warning.
  {
    const capture: { url?: string } = {};
    const r = await searchAds(["a".repeat(60), "b".repeat(60)], "IN", { token: "t", fetchFn: stubFetch(API_OK, 200, capture) });
    const params = new URLSearchParams((capture.url ?? "").split("?")[1] ?? "");
    check("terms >100 chars: truncated", (params.get("search_terms") ?? "").length <= 100, String((params.get("search_terms") ?? "").length));
    check("terms >100 chars: warning", r.warnings.some((w) => w.includes("truncated")));
  }

  // SELLER_KEYWORDS: video's words present, locale-agnostic (no currency amounts).
  {
    check("keywords: video's words present", ["e-book", "templates", "bundle", "instant download"].every((k) => SELLER_KEYWORDS.includes(k)));
    check("keywords: no currency amounts", SELLER_KEYWORDS.every((k) => !/₹|\$|€|£/.test(k)));
  }

  

console.log(failures === 0 ? "\nALL DISCOVERY TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);

}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
