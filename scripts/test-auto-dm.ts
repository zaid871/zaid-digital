/**
 * Auto-DM tests: mandatory dmCta in script parsing, keyword-spoken
 * enforcement, QA dm-cta-present check, caption-pack DM CTA closing line,
 * and the n8n workflow's keyword/DM logic (mirrored from the embedded JS).
 * Run: npx tsx scripts/test-auto-dm.ts
 */
import { DmCtaSchema } from "../src/lib/pipeline/schemas";
import { sanitizeDmCta, dmKeywordSpoken } from "../src/lib/pipeline/script";
import { runQualityChecks, type QAInputs } from "../src/lib/pipeline/qa";
import { generateCaptionPack, type CaptionTextGen } from "../src/lib/pipeline/caption-pack";
import { readFileSync } from "fs";
import { join } from "path";

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
function throws(name: string, fn: () => void) {
  try {
    fn();
    check(name, false, "expected throw");
  } catch {
    check(name, true);
  }
}

// ---------- DmCtaSchema ----------
{
  const ok = DmCtaSchema.safeParse({ keyword: "LINK", ctaLine: "Comment me LINK likho." });
  check("schema: valid dmCta parses", ok.success);
  check("schema: missing keyword fails", !DmCtaSchema.safeParse({ ctaLine: "x" }).success);
  check("schema: empty ctaLine fails", !DmCtaSchema.safeParse({ keyword: "LINK", ctaLine: "" }).success);
  check("schema: missing dmCta object fails", !DmCtaSchema.safeParse(undefined).success);
}

// ---------- sanitizeDmCta ----------
{
  const d = sanitizeDmCta({ keyword: "link", ctaLine: "Comment me LINK likho — link DM me bhej dunga." });
  check("sanitize: lowercase keyword normalized to LINK", d.keyword === "LINK", d.keyword);
  check("sanitize: ctaLine kept", d.ctaLine.length > 10);
  throws("sanitize: missing object throws", () => sanitizeDmCta(undefined));
  throws("sanitize: non-word keyword throws", () => sanitizeDmCta({ keyword: "!!!", ctaLine: "x" }));
  throws("sanitize: empty ctaLine throws", () => sanitizeDmCta({ keyword: "LINK", ctaLine: "  " }));
  throws("sanitize: price in ctaLine throws", () =>
    sanitizeDmCta({ keyword: "LINK", ctaLine: "Comment LINK, sirf ₹499 me pao." })
  );
  throws("sanitize: banned claim in ctaLine throws", () =>
    sanitizeDmCta({ keyword: "LINK", ctaLine: "Comment LINK — #1 best product guarantee!" })
  );
}

// ---------- dmKeywordSpoken ----------
{
  check("spoken: keyword found (case-insensitive)", dmKeywordSpoken(["comment me link likho"], "LINK"));
  check("spoken: missing keyword false", !dmKeywordSpoken(["yeh product kamaal hai"], "LINK"));
  check("spoken: empty keyword false", !dmKeywordSpoken(["link"], ""));
}

// ---------- QA dm-cta-present ----------
const baseQa: QAInputs = {
  jobId: "test",
  finalPath: "/nonexistent/final.mp4",
  srtPath: "/nonexistent/captions.srt",
  targetDurationSec: 30,
  scenes: [],
  narrations: ["Dekho ye tiffin kitna solid hai.", "Comment me LINK likho, link DM me bhej dunga."],
  callToAction: "Check product details through the link in the description or profile.",
  productCategory: "kitchen",
  dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho, link DM me bhej dunga." },
};

async function main() {
  const res = await runQualityChecks(baseQa);
  const dm = res.contentChecks.find((x) => x.name === "dm-cta-present");
  check("qa: dm-cta-present passes when keyword spoken", !!dm?.passed, dm?.detail ?? "missing");
{
  const res = await runQualityChecks({ ...baseQa, dmCta: null });
  const dm = res.contentChecks.find((x) => x.name === "dm-cta-present");
  check("qa: dm-cta-present fails when dmCta null", !!dm && !dm.passed, dm?.detail ?? "missing");
  check("qa: missing dmCta drives FAILED verdict", res.verdict === "FAILED", res.verdict);
}
{
  const res = await runQualityChecks({
    ...baseQa,
    narrations: ["Dekho ye tiffin kitna solid hai."],
  });
  const dm = res.contentChecks.find((x) => x.name === "dm-cta-present");
  check("qa: dm-cta-present fails when keyword not spoken", !!dm && !dm.passed, dm?.detail ?? "missing");
}

// ---------- caption pack: DM CTA closing line ----------
const stubNoCta: CaptionTextGen = async () =>
  JSON.stringify({
    instagram: "Roz ka khana, ab style ke saath. Link in bio.",
    facebook: "Ek tiffin jo roz ke khane ko thoda khaas bana de.",
    headlines: ["Khana fresh, har din", "Ye tiffin kyun alag hai?", "Mazboot steel, saaf design"],
    seoDescription: "Leak-proof steel tiffin box.",
    seoKeywords: ["steel tiffin", "lunch box"],
    hashtags: ["#tiffin", "#kitchen"],
  });
{
  const pack = await generateCaptionPack(
    {
      productName: "Steel Tiffin Box",
      features: ["leak-proof steel body"],
      dmCtaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga.",
    },
    stubNoCta
  );
  check(
    "caption: model-ignored CTA line is appended",
    !!pack.instagram?.endsWith("Comment me LINK likho — link seedha tumhare DM me bhej dunga."),
    pack.instagram ?? "null"
  );
}
{
  const pack = await generateCaptionPack(
    { productName: "Steel Tiffin Box", dmCtaLine: "Comment LINK, sirf ₹499 me!" },
    stubNoCta
  );
  check(
    "caption: violating dmCtaLine dropped with warning, never forced in",
    !pack.instagram?.includes("₹499") && pack.warnings.some((w) => w.includes("dmCtaLine")),
    pack.warnings.join("; ")
  );
}

// ---------- n8n keyword logic (mirrors keyword-match node JS) ----------
{
  const kws = ["LINK"];
  const re = new RegExp(`\\b(${kws.join("|")})\\b`, "i");
  check("kw: 'LINK bhej do' matches", re.test("LINK bhej do"));
  check("kw: lowercase 'link' matches", re.test("link chahiye"));
  check("kw: 'BLINK' does not match (word boundary)", !re.test("BLINK"));
  check("kw: 'links' plural does not match", !re.test("links please"));
}

// ---------- n8n build-dm: digital lane (executes the REAL workflow JS) ----------
// Meta allows one webhook callback URL per app, so the digital lane lives
// as a branch in this workflow: a media in DM_DIGITAL_LINK_MAP_JSON gets
// the own-product template with NO affiliate disclosure.
{
  const wf = JSON.parse(
    readFileSync(join(process.cwd(), "n8n/workflows/affiliate/instagram-auto-dm.json"), "utf-8")
  ) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
  const jsCode = wf.nodes.find((n) => n.name === "build-dm")?.parameters.jsCode ?? "";
  check("workflow has build-dm with the digital lane", jsCode.includes("DM_DIGITAL_LINK_MAP_JSON") && jsCode.includes("isDigital"));
  const runBuildDm = (items: Array<Record<string, unknown>>, env: Record<string, string>) => {
    const fn = new Function("$input", "$env", jsCode);
    return fn(
      { all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) },
      env
    ) as Array<Record<string, unknown>>;
  };
  const env: Record<string, string> = {
    DM_LINK_MAP_JSON: JSON.stringify({ "media-a1": "https://merchant.example.com/product" }),
    DM_DIGITAL_LINK_MAP_JSON: JSON.stringify({ "media-d1": "https://example.com/wedding-pack" }),
    DM_DEFAULT_LINK: "https://merchant.example.com/default",
    DM_DISCLOSURE: "Affiliate disclosure: test disclosure.",
    DM_REPLY_TEMPLATE: "Namaste {{username}}! Link: {{link}}",
    DM_DIGITAL_TEMPLATE: "Namaste {{username}}! Aapka product link: {{link}}",
  };
  const comment = (mediaId: string, keyword = "LINK") => ({ commentId: "c1", text: "LINK please", username: "rahul", mediaId, keyword, matched: true });
  {
    const out = runBuildDm([comment("media-d1")], env);
    check("digital media -> send, digital lane", out[0]?.send === true && out[0]?.lane === "digital", JSON.stringify(out[0]));
    check("digital DM has no disclosure", typeof out[0]?.dmText === "string" && !(out[0].dmText as string).includes("Affiliate disclosure"), String(out[0]?.dmText));
    check("digital DM carries the own-product link", typeof out[0]?.dmText === "string" && (out[0].dmText as string).includes("https://example.com/wedding-pack"), String(out[0]?.dmText));
  }
  {
    const out = runBuildDm([comment("media-a1")], env);
    check("affiliate media -> send, affiliate lane", out[0]?.send === true && out[0]?.lane === "affiliate", JSON.stringify(out[0]));
    check("affiliate DM keeps the disclosure", typeof out[0]?.dmText === "string" && (out[0].dmText as string).includes("Affiliate disclosure"), String(out[0]?.dmText));
  }
  {
    const out = runBuildDm([comment("media-unknown")], { ...env, DM_DEFAULT_LINK: "" });
    check("no link anywhere -> do not send", out[0]?.send === false, JSON.stringify(out[0]));
  }
  {
    const out = runBuildDm([comment("media-unknown")], env);
    check("affiliate fallback uses DM_DEFAULT_LINK", out[0]?.send === true && out[0]?.lane === "affiliate" && (out[0]?.dmText as string).includes("merchant.example.com/default"), JSON.stringify(out[0]));
  }
  {
    const out = runBuildDm([comment("media-d1")], { ...env, DM_DIGITAL_TEMPLATE: "Price ₹499! Link: {{link}}" });
    check("price in digital template -> blocked", out[0]?.send === false, JSON.stringify(out[0]));
  }
  {
    const longLink = "https://example.com/" + "x".repeat(950);
    const out = runBuildDm([comment("media-d1")], { ...env, DM_DIGITAL_LINK_MAP_JSON: JSON.stringify({ "media-d1": longLink }) });
    check("digital DM over 900 chars -> blocked", out[0]?.send === false, JSON.stringify(out[0]));
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
