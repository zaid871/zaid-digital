/**
 * Caption-pack tests: full pack kept, violating fields dropped (never
 * replaced with fabricated fallback copy), garbage -> hard error.
 * Run: npx tsx scripts/test-caption-pack.ts
 */
import { generateCaptionPack, type CaptionTextGen } from "../src/lib/pipeline/caption-pack";

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

const INPUT = {
  productName: "Steel Tiffin Box",
  features: ["leak-proof steel body", "3 compartments"],
  productCategory: "kitchen",
};

const FULL = JSON.stringify({
  instagram: "Roz ka khana, ab style ke saath. ✨ Link in bio.",
  facebook: "Ek tiffin jo roz ke khane ko thoda khaas bana de.",
  headlines: ["Khana fresh, har din", "Ye tiffin kyun alag hai?", "Mazboot steel, saaf design"],
  seoDescription: "Leak-proof steel tiffin box with 3 compartments for daily meals.",
  seoKeywords: ["steel tiffin", "lunch box", "3 compartment tiffin"],
  hashtags: ["#tiffin", "#kitchen", "#steelbox"],
});

async function main() {
  {
    const gen: CaptionTextGen = async () => FULL;
    const pack = await generateCaptionPack(INPUT, gen);
    check("full pack kept", pack.instagram !== null && pack.facebook !== null && pack.headlines.length === 3);
    check("seo + hashtags kept", pack.seoDescription !== null && pack.seoKeywords.length === 3 && pack.hashtags.length === 3);
    check("no warnings on clean pack", pack.warnings.length === 0, pack.warnings.join(";"));
  }
  {
    const dirty = JSON.parse(FULL) as Record<string, unknown>;
    dirty.instagram = "Sirf aaj 50% off! Buy now!";
    dirty.headlines = ["Khana fresh, har din", "The #1 choice for smart buyers", "Mazboot steel, saaf design"];
    const gen: CaptionTextGen = async () => JSON.stringify(dirty);
    const pack = await generateCaptionPack(INPUT, gen);
    check("price/buy-now caption dropped, not replaced", pack.instagram === null);
    check("banned headline dropped, others kept", pack.headlines.length === 2 && !pack.headlines.join(" ").includes("#1"));
    check("warnings name the dropped fields", pack.warnings.some((w) => w.startsWith("instagram")) && pack.warnings.some((w) => w.startsWith("headlines")));
    check("facebook untouched by instagram violation", pack.facebook !== null);
  }
  {
    const gen: CaptionTextGen = async () => "ye koi JSON nahi";
    let threw = false;
    try {
      await generateCaptionPack(INPUT, gen);
    } catch {
      threw = true;
    }
    check("garbage -> hard error, no silent fallback", threw);
  }
  {
    const gen: CaptionTextGen = async () => JSON.stringify({ instagram: 42, headlines: "nope" });
    let threw = false;
    try {
      await generateCaptionPack(INPUT, gen);
    } catch {
      threw = true;
    }
    check("wrong shape -> hard error", threw);
  }
  {
    // Prompt must carry the verified features and the hard rules.
    let seen = "";
    const gen: CaptionTextGen = async (prompt) => {
      seen = prompt;
      return FULL;
    };
    await generateCaptionPack(INPUT, gen);
    check("prompt carries verified features", seen.includes("leak-proof steel body"));
    check("prompt carries the no-price rule", seen.includes("No prices"));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL CAPTION-PACK TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
