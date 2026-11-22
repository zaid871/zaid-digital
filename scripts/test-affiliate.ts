/**
 * Unit tests for the affiliate module (§4) — src/lib/affiliate.
 * All HTTP is mocked via fetchImpl. No real network calls.
 * Run: npx tsx scripts/test-affiliate.ts
 */
import {
  AFFILIATE_PROGRAMS,
  DISCLOSURE_TEXT,
  isAffiliateProgram,
  validateLink,
} from "../src/lib/affiliate";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

type MockFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Mock fetch that answers from a URL → Response map. */
function mockFetch(routes: Record<string, Response>): MockFetch {
  return async (input: string | URL | Request) => {
    const res = routes[String(input)];
    if (!res) throw new Error(`unexpected URL in test: ${String(input)}`);
    return res;
  };
}

const ok = () => new Response("ok", { status: 200 });
const redirect = (to: string, status = 301) =>
  new Response(null, { status, headers: { location: to } });

/** Mock fetch that never resolves until aborted (timeout test). */
const hangingFetch: MockFetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });

// ---- programs allowlist ----

async function main() {
  check(
    "allowlist has the six programmes",
    AFFILIATE_PROGRAMS.length === 6 &&
      ["amazon_associates", "flipkart", "admitad", "impact", "vcommission", "other"].every(
        (p) => (AFFILIATE_PROGRAMS as readonly string[]).includes(p),
      ),
  );
  check("isAffiliateProgram accepts amazon_associates", isAffiliateProgram("amazon_associates"));
  check("isAffiliateProgram accepts other", isAffiliateProgram("other"));
  check("isAffiliateProgram rejects unknown", !isAffiliateProgram("shady_network"));
  check("isAffiliateProgram rejects empty", !isAffiliateProgram(""));

  // ---- disclosure text (must match Prisma default byte-for-byte) ----
  check(
    "DISCLOSURE_TEXT matches schema default",
    DISCLOSURE_TEXT === "Affiliate link — I may earn a commission at no extra cost to you.",
  );

  // ---- validateLink: happy paths ----
  {
    const r = await validateLink("https://shop.example/product/1", {
      fetchImpl: mockFetch({ "https://shop.example/product/1": ok() }),
    });
    check("200 → valid", r.status === "valid" && r.httpStatus === 200);
    check("valid keeps finalUrl == input", r.finalUrl === "https://shop.example/product/1");
  }
  {
    const r = await validateLink("https://t.example/abc", {
      fetchImpl: mockFetch({
        "https://t.example/abc": redirect("https://shop.example/product/1"),
        "https://shop.example/product/1": ok(),
      }),
    });
    check("301 → 200 is redirected", r.status === "redirected");
    check("redirected reports finalUrl", r.finalUrl === "https://shop.example/product/1");
    check("redirected reports final httpStatus", r.httpStatus === 200);
  }
  {
    const r = await validateLink("https://t.example/rel", {
      fetchImpl: mockFetch({
        "https://t.example/rel": redirect("/product/9"),
        "https://t.example/product/9": ok(),
      }),
    });
    check(
      "relative Location resolved",
      r.status === "redirected" && r.finalUrl === "https://t.example/product/9",
    );
  }

  // ---- validateLink: broken ----
  {
    const r = await validateLink("https://shop.example/gone", {
      fetchImpl: mockFetch({
        "https://shop.example/gone": new Response("nf", { status: 404 }),
      }),
    });
    check("404 → broken", r.status === "broken" && r.httpStatus === 404);
  }
  {
    const r = await validateLink("https://shop.example/err", {
      fetchImpl: mockFetch({
        "https://shop.example/err": new Response("err", { status: 500 }),
      }),
    });
    check("500 → broken", r.status === "broken" && r.httpStatus === 500);
  }
  {
    // Endless redirect loop: every hop 301s back to itself.
    const loop: MockFetch = async (input) =>
      new Response(null, { status: 301, headers: { location: String(input) } });
    const r = await validateLink("https://t.example/loop", {
      fetchImpl: loop,
      maxRedirects: 3,
    });
    check("redirect loop beyond maxRedirects → broken", r.status === "broken");
  }
  {
    // 3xx with no Location header.
    const r = await validateLink("https://t.example/noloc", {
      fetchImpl: mockFetch({
        "https://t.example/noloc": new Response(null, { status: 302 }),
      }),
    });
    check("3xx without Location → broken", r.status === "broken" && r.httpStatus === 302);
  }
  {
    const r = await validateLink("https://t.example/slow", {
      fetchImpl: hangingFetch,
      timeoutMs: 50,
    });
    check("timeout → broken, no httpStatus", r.status === "broken" && r.httpStatus === null);
  }
  {
    const r = await validateLink("https://t.example/dns", {
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    check("DNS failure → broken", r.status === "broken" && r.httpStatus === null);
  }

  // ---- validateLink: malformed input ----
  {
    const r = await validateLink("not a url", { fetchImpl: hangingFetch });
    check("garbage input → broken without network", r.status === "broken");
    check("garbage input keeps raw finalUrl", r.finalUrl === "not a url");
  }
  {
    const r = await validateLink("ftp://files.example/x", { fetchImpl: hangingFetch });
    check("non-http(s) → broken without network", r.status === "broken");
  }

  console.log(failures === 0 ? "\nALL AFFILIATE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);

}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
