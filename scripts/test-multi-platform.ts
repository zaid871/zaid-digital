/**
 * Multi-platform tests: fit analyzer rules, little-text escaping, Pinterest /
 * LinkedIn publishers (mocked fetch), X draft builder, compliance gates.
 * Run: npx tsx scripts/test-multi-platform.ts
 */
import { fitFor, autoPlatforms, manualPlatforms } from "../src/lib/publishing/platform-fit";
import { buildPinCopy, createImagePin } from "../src/lib/publishing/pinterest";
import { createTextPost, escapeLittleText } from "../src/lib/publishing/linkedin";
import { buildXPost, X_POST_MAX } from "../src/lib/publishing/x";
import { SocialPublishError } from "../src/lib/publishing/social-copy";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function main() {
  // ---------- platform-fit ----------
  {
    const fits = fitFor({ name: "Steel Tiffin", category: "kitchen" });
    check("fit: kitchen → pinterest first/high", fits[0].platform === "pinterest" && fits[0].fit === "high");
    check("fit: pinterest mode is api", fits[0].publishMode === "api");
    const x = fits.find((f) => f.platform === "x")!;
    check("fit: x always manual with paid note", x.publishMode === "manual" && !!x.note?.includes("$0.20"));
  }
  {
    const fits = fitFor({ name: "AI Tool", category: "computers_ai_tools" });
    const x = fits.find((f) => f.platform === "x")!;
    const li = fits.find((f) => f.platform === "linkedin")!;
    const pin = fits.find((f) => f.platform === "pinterest")!;
    const rd = fits.find((f) => f.platform === "reddit")!;
    check("fit: ai tools → x high", x.fit === "high");
    check("fit: ai tools → linkedin high/api", li.fit === "high" && li.publishMode === "api");
    check("fit: ai tools → pinterest low", pin.fit === "low");
    check("fit: ai tools → reddit high/api with self-promo note", rd.fit === "high" && rd.publishMode === "api" && !!rd.note?.includes("self-promotion"));
    const qu = fits.find((f) => f.platform === "quora")!;
    check("fit: ai tools → quora high/manual with no-API note", qu.fit === "high" && qu.publishMode === "manual" && !!qu.note?.includes("no public API"));
    const th = fits.find((f) => f.platform === "threads")!;
    check("fit: ai tools → threads high/api", th.fit === "high" && th.publishMode === "api");
    check("fit: auto excludes low + manual + reddit (explicit-only)", JSON.stringify(autoPlatforms({ name: "t", category: "computers_ai_tools" })) === '["linkedin","threads"]');
    check("fit: manual lists x + quora", JSON.stringify(manualPlatforms({ name: "t", category: "computers_ai_tools" })) === '["x","quora"]');
  }
  {
    const fits = fitFor({ name: "Mystery", category: "nope" });
    check("fit: unknown category falls back, no throw", fits.length === 6);
  }
  {
    const fits = fitFor({ name: "Steel Tiffin", category: "kitchen" });
    const rd = fits.find((f) => f.platform === "reddit")!;
    check("fit: kitchen → reddit low", rd.fit === "low");
    check("fit: auto excludes reddit when low", !autoPlatforms({ name: "t", category: "kitchen" }).includes("reddit"));
    const qu = fits.find((f) => f.platform === "quora")!;
    check("fit: kitchen → quora low/manual", qu.fit === "low" && qu.publishMode === "manual");
    check("fit: manual excludes quora when low", !manualPlatforms({ name: "t", category: "kitchen" }).includes("quora"));
    const th = fits.find((f) => f.platform === "threads")!;
    check("fit: kitchen → threads medium/api", th.fit === "medium" && th.publishMode === "api");
    check("fit: auto includes threads for kitchen", autoPlatforms({ name: "t", category: "kitchen" }).includes("threads"));
  }

  // ---------- little-text escaping ----------
  {
    const raw = '\\ | { } @ [ ] ( ) < > # * _ ~';
    const esc = escapeLittleText(raw);
    check(
      "linkedin: all 15 reserved chars escaped",
      esc === '\\\\ \\| \\{ \\} \\@ \\[ \\] \\( \\) \\< \\> \\# \\* \\_ \\~',
      esc
    );
    check("linkedin: plain text untouched", escapeLittleText("Namaste dosto") === "Namaste dosto");
  }

  // ---------- pinterest (mocked) ----------
  const product = {
    name: "Steel Tiffin Box",
    category: "kitchen",
    link: "https://example.com/tiffin",
    imageUrl: "https://example.com/tiffin.jpg",
    description: "Leak-proof steel tiffin.",
    features: ["3 compartments", "steel body"],
  };
  {
    const copy = buildPinCopy(product);
    check("pinterest: copy has title+description", copy.title.length > 0 && copy.description.length > 0);
    check("pinterest: disclosure appended", copy.description.includes("Affiliate link"));
  }
  {
    const okFetch = (async () => new Response(JSON.stringify({ id: "pin123" }), { status: 201 })) as typeof fetch;
    const r = await createImagePin(product, { token: "t", boardId: "b", fetchFn: okFetch });
    check("pinterest: returns pin id", r.pinId === "pin123");
  }
  {
    const authFetch = (async () => new Response("denied", { status: 401 })) as typeof fetch;
    try {
      await createImagePin(product, { token: "bad", boardId: "b", fetchFn: authFetch });
      check("pinterest: 401 → auth error", false);
    } catch (e) {
      check("pinterest: 401 → auth error", e instanceof SocialPublishError && e.code === "auth");
    }
  }
  {
    try {
      await createImagePin(product, { token: "", boardId: "b" });
      check("pinterest: missing token → not_configured", false);
    } catch (e) {
      check("pinterest: missing token → not_configured", e instanceof SocialPublishError && e.code === "not_configured");
    }
  }
  {
    try {
      buildPinCopy({ ...product, description: "Sirf ₹499 me pao!" });
      check("pinterest: price in copy blocked", false);
    } catch {
      check("pinterest: price in copy blocked", true);
    }
  }

  // ---------- linkedin (mocked) ----------
  {
    let sentBody = "";
    const okFetch = (async (_u: unknown, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:999" } });
    }) as typeof fetch;
    const r = await createTextPost(product, { token: "t", authorUrn: "urn:li:person:abc", fetchFn: okFetch });
    check("linkedin: returns post id", r.postId === "urn:li:share:999", r.postId);
    const body = JSON.parse(sentBody) as { commentary: string; author: string; lifecycleState: string };
    check("linkedin: author + lifecycleState", body.author === "urn:li:person:abc" && body.lifecycleState === "PUBLISHED");
  }
  {
    // parentheses in features must be escaped in the sent commentary
    let sentBody = "";
    const okFetch = (async (_u: unknown, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return new Response("", { status: 201, headers: { "x-restli-id": "x" } });
    }) as typeof fetch;
    await createTextPost({ ...product, features: ["steel (ISI mark)"] }, { token: "t", authorUrn: "urn:li:person:abc", fetchFn: okFetch });
    check("linkedin: parens escaped in commentary", sentBody.includes("\\\\(ISI mark\\\\)"), sentBody.slice(0, 120));
  }
  {
    try {
      await createTextPost(product, { token: "", authorUrn: "urn:li:person:abc" });
      check("linkedin: missing token → not_configured", false);
    } catch (e) {
      check("linkedin: missing token → not_configured", e instanceof SocialPublishError && e.code === "not_configured");
    }
  }

  // ---------- x draft ----------
  {
    const text = buildXPost(product);
    const counted = text.length - product.link.length + 23;
    check("x: draft within 280 (t.co counted)", counted <= X_POST_MAX, `${counted}`);
    check("x: has link + disclosure", text.includes(product.link) && text.includes("(affiliate link)"));
    try {
      buildXPost({ ...product, features: ["sirf ₹499 me"] });
      check("x: price in feature blocked", false);
    } catch {
      check("x: price in feature blocked", true);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch((err) => {
    console.error("FATAL", err);
    process.exit(1);
  });
