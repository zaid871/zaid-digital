/**
 * Script-style tests: prompt structure + end-to-end generateScript
 * with a mocked provider fetch (zero real HTTP).
 * Covers "numbered", "brand_story" (The Brand Saga style),
 * "macro_hero" (Aminul Visuals), "banner_unroll" (Raj Photo Editing),
 * "attar_luxury" (ATTAR attar ad, user-shared 2026-11-11) and
 * "wedding_invite" (wedding video invitations, 2026-11-12).
 * Run: npx tsx scripts/test-script-style.ts
 */
import { generateScript, HINGLISH_ORDINALS } from "../src/lib/pipeline/script";
import type { ProductFactsInput } from "../src/lib/pipeline/types";

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

// Only Pollinations configured (no HF/Groq/Gemini keys) → deterministic route.
delete process.env.HF_TOKEN;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

const facts: ProductFactsInput = {
  productName: "Steel Water Bottle",
  brand: "AquaPure",
  category: "Kitchen",
  verifiedFeatures: ["1 litre capacity", "Stainless steel body", "Leak-proof cap"],
  unverifiedClaims: [],
  sourceUrls: ["https://example.com/product"],
};

function scriptJson(sceneCount: number, badPrice = false): string {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    sceneId: `s${i + 1}`,
    narration:
      badPrice && i === 1
        ? "Ye bottle sirf Rs 999 me milti hai aaj hi"
        : i === sceneCount - 1
          ? `Scene ${i + 1} ke liye natural hinglish narration line hai ye wali, comment me LINK likho`
          : `Scene ${i + 1} ke liye natural hinglish narration line hai ye wali`,
    onScreenText: "Steel Bottle",
    claimsAvoided: [],
  }));
  return JSON.stringify({
    scenes,
    callToAction: "Check product details through the link in the description or profile.",
    dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga." },
  });
}

let lastPrompt = "";
let mockSceneCount = 5;
let mockBadPrice = false;
(globalThis as Record<string, unknown>).fetch = async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    messages?: Array<{ content?: string }>;
  };
  lastPrompt = body.messages?.[0]?.content ?? "";
  return new Response(
    JSON.stringify({ choices: [{ message: { content: scriptJson(mockSceneCount, mockBadPrice) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

async function main() {
  check("ordinals exported in order", HINGLISH_ORDINALS[0] === "Pehli" && HINGLISH_ORDINALS[1] === "Dusri" && HINGLISH_ORDINALS[2] === "Teesri");

  // Numbered, 45s → 5 scenes → hook + 3 points + closing
  mockSceneCount = 5;
  const s1 = await generateScript(facts, 45, { style: "numbered" });
  check("numbered 45s returns 5 scenes", s1.scenes.length === 5);
  check("prompt has numbered STRUCTURE block", lastPrompt.includes("STRUCTURE (numbered style"));
  check("prompt instructs hook first", lastPrompt.includes("Scene 1 is the HOOK"));
  check("prompt has Pehli/Dusri/Teesri", lastPrompt.includes("Pehli baat") && lastPrompt.includes("Dusri baat") && lastPrompt.includes("Teesri baat"));
  check("prompt does NOT ask for Chauthi (only 3 points)", !lastPrompt.includes("Chauthi baat"));
  check("prompt instructs closing scene", lastPrompt.includes("CLOSING"));

  // Numbered, 15s → 3 scenes → hook + 1 point + closing
  mockSceneCount = 3;
  const s2 = await generateScript(facts, 15, { style: "numbered" });
  check("numbered 15s returns 3 scenes", s2.scenes.length === 3);
  check("short numbered has Pehli only", lastPrompt.includes("Pehli baat") && !lastPrompt.includes("Dusri baat"));

  // Standard style → no numbered block
  mockSceneCount = 5;
  await generateScript(facts, 45, { style: "standard" });
  check("standard prompt has no numbered block", !lastPrompt.includes("STRUCTURE (numbered style"));
  check("standard prompt has no ordinal instruction", !lastPrompt.includes("Pehli baat"));

  // Default (no opts) → standard
  await generateScript(facts, 45);
  check("default style is standard", !lastPrompt.includes("STRUCTURE (numbered style"));

  // Compliance still enforced in numbered mode: price in narration → throw
  mockSceneCount = 5;
  mockBadPrice = true;
  let threw = false;
  try {
    await generateScript(facts, 45, { style: "numbered" });
  } catch {
    threw = true;
  }
  check("price in numbered narration still rejected", threw);
  mockBadPrice = false;

  // ---- brand_story (The Brand Saga style) ----
  // 60s → 5 scenes: Hook → Origin → Twist → Proof → Lesson+Closing
  mockSceneCount = 5;
  const b1 = await generateScript(facts, 60, { style: "brand_story" });
  check("brand_story 60s returns 5 scenes", b1.scenes.length === 5);
  check("prompt has brand-story STRUCTURE block", lastPrompt.includes("STRUCTURE (brand-story style"));
  check("prompt has Hook question beat", lastPrompt.includes("HOOK") && lastPrompt.includes("QUESTION"));
  check("prompt has Origin beat", lastPrompt.includes("ORIGIN"));
  check("prompt has Twist beat", lastPrompt.includes("TWIST"));
  check("prompt has Proof beat", lastPrompt.includes("PROOF"));
  check("prompt has Lesson beat", lastPrompt.includes("LESSON"));
  check("prompt forbids invented sales/revenue numbers", lastPrompt.includes("NEVER invent sales, revenue"));
  check("prompt asks hook onScreenText (max 40 chars)", lastPrompt.includes("max 40 characters"));
  check("brand-story prompt has no numbered block", !lastPrompt.includes("STRUCTURE (numbered style"));

  // 90s → 6 scenes: Hook → Origin → Twist → Proof → Lesson → Closing
  mockSceneCount = 6;
  const b2 = await generateScript(facts, 90, { style: "brand_story" });
  check("brand_story 90s returns 6 scenes", b2.scenes.length === 6);
  check("brand-story 90s has separate Closing scene", lastPrompt.includes("Scene 6 is the CLOSING"));

  // 15s → 3 scenes: short mapping (Hook → Twist+Proof → Lesson+Closing)
  mockSceneCount = 3;
  const b3 = await generateScript(facts, 15, { style: "brand_story" });
  check("brand_story 15s returns 3 scenes", b3.scenes.length === 3);
  check("brand-story short has Twist+Proof combined", lastPrompt.includes("TWIST + PROOF in one"));

  // Compliance still enforced in brand_story mode
  mockSceneCount = 5;
  mockBadPrice = true;
  let threwB = false;
  try {
    await generateScript(facts, 60, { style: "brand_story" });
  } catch {
    threwB = true;
  }
  check("price in brand-story narration still rejected", threwB);
  mockBadPrice = false;

  // ---- macro_hero (Aminul Visuals style) ----
  // 15s → 3 scenes: Ingredient → Craft+Hero → Closing
  mockSceneCount = 3;
  const m1 = await generateScript(facts, 15, { style: "macro_hero" });
  check("macro_hero 15s returns 3 scenes", m1.scenes.length === 3);
  check("prompt has macro-hero STRUCTURE block", lastPrompt.includes("STRUCTURE (macro-hero style"));
  check("prompt has Ingredient beat", lastPrompt.includes("INGREDIENT"));
  check("prompt has Craft beat", lastPrompt.includes("CRAFT"));
  check("prompt has Hero beat", lastPrompt.includes("HERO"));
  check("prompt forbids redesigning the pack", lastPrompt.includes("never redesign, relabel, or change the pack"));
  check("prompt has no faces rule", lastPrompt.includes("No faces"));
  check("prompt has one colour rule", lastPrompt.includes("One dominant colour"));

  // 45s → 4 scenes: Ingredient → Craft → Hero → Closing
  mockSceneCount = 4;
  const m2 = await generateScript(facts, 45, { style: "macro_hero" });
  check("macro_hero 45s returns 4 scenes", m2.scenes.length === 4);
  check("macro-hero 45s has separate Hero scene", lastPrompt.includes("Scene 3 is the HERO"));
  check("macro-hero 45s has separate Closing scene", lastPrompt.includes("Scene 4 is the CLOSING"));

  // Compliance still enforced in macro_hero mode
  mockSceneCount = 3;
  mockBadPrice = true;
  let threwM = false;
  try {
    await generateScript(facts, 15, { style: "macro_hero" });
  } catch {
    threwM = true;
  }
  check("price in macro-hero narration still rejected", threwM);
  mockBadPrice = false;

  // ---- banner_unroll (Raj Photo Editing style) ----
  // Always 3 scenes: Hook → unroll → hold + CTA
  mockSceneCount = 3;
  const u1 = await generateScript(facts, 15, { style: "banner_unroll" });
  check("banner_unroll 15s returns 3 scenes", u1.scenes.length === 3);
  check("prompt has banner-unroll STRUCTURE block", lastPrompt.includes("STRUCTURE (banner-unroll style"));
  check("prompt has Hook beat", lastPrompt.includes("Scene 1 is the HOOK"));
  check("prompt has Unroll beat", lastPrompt.includes("Scene 2 is the UNROLL"));
  check("prompt has Hold+Closing beat", lastPrompt.includes("Scene 3 is the HOLD + CLOSING"));
  check("prompt forbids price/discount on the banner", lastPrompt.includes("Never mention a price, discount, or offer on the banner"));
  check("prompt asks brand-name onScreenText", lastPrompt.includes("brand name, max 40 characters"));

  // 45s still → 3 scenes (banner ads are one unroll, not more scenes)
  mockSceneCount = 3;
  const u2 = await generateScript(facts, 45, { style: "banner_unroll" });
  check("banner_unroll 45s still returns 3 scenes", u2.scenes.length === 3);

  // ---- attar_luxury (ATTAR attar ad, user-shared 2026-11-11) ----
  // Always 4 scenes: Hero → Drop → Ritual → End card
  mockSceneCount = 4;
  const a1 = await generateScript(facts, 15, { style: "attar_luxury" });
  check("attar_luxury 15s returns 4 scenes", a1.scenes.length === 4);
  check("prompt has attar-luxury STRUCTURE block", lastPrompt.includes("STRUCTURE (attar-luxury style"));
  check("prompt has Hero beat", lastPrompt.includes("Scene 1 is the HERO"));
  check("prompt has Drop beat", lastPrompt.includes("Scene 2 is the DROP"));
  check("prompt has Ritual beat", lastPrompt.includes("Scene 3 is the RITUAL"));
  check("prompt has End Card beat", lastPrompt.includes("Scene 4 is the END CARD"));
  check("prompt forbids invented longevity claims", lastPrompt.includes("never invent a longevity"));
  check("prompt asks tagline onScreenText", lastPrompt.includes("Scene 4 onScreenText"));

  // 45s still → 4 scenes (the 4-beat structure IS the style)
  mockSceneCount = 4;
  const a2 = await generateScript(facts, 45, { style: "attar_luxury" });
  check("attar_luxury 45s still returns 4 scenes", a2.scenes.length === 4);

  // Compliance still enforced in attar_luxury mode: price → throw
  mockSceneCount = 4;
  mockBadPrice = true;
  let threwAttar = false;
  try {
    await generateScript(facts, 15, { style: "attar_luxury" });
  } catch {
    threwAttar = true;
  }
  check("price in attar_luxury narration still rejected", threwAttar);
  mockBadPrice = false;

  // ---- wedding_invite (wedding video invitations, 2026-11-12) ----
  // Always 4 scenes: Names → Functions → Date & Venue → Closing + RSVP
  const weddingFacts: ProductFactsInput = {
    productName: "Aisha & Rohan",
    brand: "Sharma Family",
    category: "Wedding",
    verifiedFeatures: ["Shaadi: pandrah December", "Venue: Jaipur", "Functions: Haldi, Mehndi, Sangeet"],
    unverifiedClaims: [],
    sourceUrls: ["https://example.com/invite"],
  };
  mockSceneCount = 4;
  const w1 = await generateScript(weddingFacts, 45, { style: "wedding_invite" });
  check("wedding_invite 45s returns 4 scenes", w1.scenes.length === 4);
  check("prompt has wedding-invite STRUCTURE block", lastPrompt.includes("STRUCTURE (wedding-invite style"));
  check("prompt has Names beat", lastPrompt.includes("Scene 1 is the NAMES"));
  check("prompt has Functions beat", lastPrompt.includes("Scene 2 is the FUNCTIONS"));
  check("prompt has Date & Venue beat", lastPrompt.includes("Scene 3 is the DATE & VENUE"));
  check("prompt has Closing + RSVP beat", lastPrompt.includes("Scene 4 is the CLOSING + RSVP"));
  check("prompt sets RSVP as the dmCta keyword", lastPrompt.includes("dmCta keyword for this style is RSVP"));
  check("prompt forbids inventing names/dates", lastPrompt.includes("Never invent a name") && lastPrompt.includes("Never invent or change a date"));
  check("prompt has no-music rule", lastPrompt.includes("No music: voiceover + captions only"));
  check("prompt forbids faces / AI avatars of the couple", lastPrompt.includes("No faces, no AI avatars"));

  // 15s still → 4 scenes (the 4-beat structure IS the style)
  mockSceneCount = 4;
  const w2 = await generateScript(weddingFacts, 15, { style: "wedding_invite" });
  check("wedding_invite 15s still returns 4 scenes", w2.scenes.length === 4);

  // ---- storyboard chain: winning concept feeds the script ----
  mockSceneCount = 9;
  const c1 = await generateScript(facts, 60, {
    style: "standard",
    storyboardChain: true,
    concept: { title: "Subah ki taazgi", hook: "Subah ki pehli ghadi, taazgi bhari.", angle: "Morning freshness angle" },
  });
  check("storyboard chain returns 9 scenes", c1.scenes.length === 9);
  check("prompt has WINNING AD CONCEPT block", lastPrompt.includes("WINNING AD CONCEPT"));
  check("prompt carries the concept hook", lastPrompt.includes("Subah ki pehli ghadi"));
  check("prompt instructs scene 1 to open with the hook", lastPrompt.includes("Scene 1 MUST open with the hook line"));

  // No concept → no concept block
  mockSceneCount = 5;
  await generateScript(facts, 45, { style: "standard" });
  check("no concept → no WINNING AD CONCEPT block", !lastPrompt.includes("WINNING AD CONCEPT"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL SCRIPT-STYLE TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
