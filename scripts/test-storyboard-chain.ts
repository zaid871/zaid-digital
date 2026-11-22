/**
 * Storyboard-chain tests: generateAdConcepts with an injected fake
 * textGen (zero real HTTP) + scene-count rules for the 9-scene chain.
 * Covers: 5 concepts + best pick, compliance drops, all-dropped
 * failure, unparseable failure, out-of-range bestIndex.
 * Run: npx tsx scripts/test-storyboard-chain.ts
 */
import { generateAdConcepts, type AdConcept } from "../src/lib/pipeline/concepts";
import { sceneCountForStyle } from "../src/lib/pipeline/script";

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

const input = {
  productName: "Steel Water Bottle",
  brand: "AquaPure",
  category: "Kitchen",
  verifiedFeatures: ["1 litre capacity", "Stainless steel body", "Leak-proof cap"],
};

function conceptsJson(
  overrides?: Partial<{ concepts: AdConcept[]; bestIndex: number; bestReason: string }>
): string {
  const concepts: AdConcept[] = overrides?.concepts ?? [
    { title: "Subah ki taazgi", hook: "Subah ki pehli ghadi, taazgi bhari.", angle: "Morning freshness angle" },
    { title: "Gym ka saathi", hook: "Workout ke baad, ek ghunt.", angle: "Fitness companion angle" },
    { title: "Leak-proof bharosa", hook: "Bag me rakho, bilkul fikar nahi.", angle: "Trust angle" },
    { title: "Steel ki mazbooti", hook: "Girega, par tootega nahi.", angle: "Durability angle" },
    { title: "Ek litre, poora din", hook: "Ek baar bharo, din bhar chale.", angle: "Capacity angle" },
  ];
  return JSON.stringify({
    concepts,
    bestIndex: overrides?.bestIndex ?? 1,
    bestReason: overrides?.bestReason ?? "Strongest hook and best fit to the verified features.",
  });
}

async function main() {
  // Happy path: 5 concepts, bestIndex 1 wins.
  const r1 = await generateAdConcepts(input, async () => conceptsJson());
  check("5 concepts returned", r1.concepts.length === 5);
  check("best is the ranked winner", r1.best.title === "Gym ka saathi");
  check("best reason carried through", r1.bestReason.includes("Strongest hook"));
  check("no warnings on clean run", r1.warnings.length === 0 && r1.droppedCount === 0);

  // Compliance drop: the ranked best mentions a price → dropped, next best wins.
  const priced: AdConcept[] = [
    { title: "Subah ki taazgi", hook: "Subah ki pehli ghadi, taazgi bhari.", angle: "Morning freshness angle" },
    { title: "Sasta wala offer", hook: "Sirf Rs 999 me, aaj hi le lo.", angle: "Price angle" },
    { title: "Leak-proof bharosa", hook: "Bag me rakho, bilkul fikar nahi.", angle: "Trust angle" },
    { title: "Steel ki mazbooti", hook: "Girega, par tootega nahi.", angle: "Durability angle" },
    { title: "Ek litre, poora din", hook: "Ek baar bharo, din bhar chale.", angle: "Capacity angle" },
  ];
  const r2 = await generateAdConcepts(input, async () =>
    conceptsJson({ concepts: priced, bestIndex: 1 })
  );
  check("price concept dropped", r2.concepts.length === 4 && r2.droppedCount === 1);
  check("dropped concept is gone", !r2.concepts.some((c) => c.title === "Sasta wala offer"));
  check("best falls to next survivor", r2.best.title === "Leak-proof bharosa");
  check("drop is warned, not silent", r2.warnings.length === 1 && r2.warnings[0].includes("dropped"));

  // Banned-claim drop: "#1" style claim in a hook.
  const claimed: AdConcept[] = [
    { title: "Best bottle", hook: "India ki #1 bottle, sabse best.", angle: "Top claim angle" },
    { title: "Gym ka saathi", hook: "Workout ke baad, ek ghunt.", angle: "Fitness companion angle" },
    { title: "Leak-proof bharosa", hook: "Bag me rakho, bilkul fikar nahi.", angle: "Trust angle" },
    { title: "Steel ki mazbooti", hook: "Girega, par tootega nahi.", angle: "Durability angle" },
    { title: "Ek litre, poora din", hook: "Ek baar bharo, din bhar chale.", angle: "Capacity angle" },
  ];
  const r3 = await generateAdConcepts(input, async () =>
    conceptsJson({ concepts: claimed, bestIndex: 0 })
  );
  check("banned-claim concept dropped", r3.droppedCount === 1);
  check("best moves past the dropped claim", r3.best.title === "Gym ka saathi");

  // All dropped → hard error, nothing invented.
  const allBad: AdConcept[] = priced.map((c, i) => ({
    ...c,
    hook: i === 0 ? "Sirf Rs 499 me." : "Sirf Rs 999 me, aaj hi le lo.",
  }));
  let threwAll = false;
  try {
    await generateAdConcepts(input, async () => conceptsJson({ concepts: allBad, bestIndex: 0 }));
  } catch (e) {
    threwAll = true;
    check("all-dropped error names the cause", String(e).includes("All 5 ad concepts failed"));
  }
  check("all-dropped throws", threwAll);

  // Unparseable output → hard error.
  let threwParse = false;
  try {
    await generateAdConcepts(input, async () => "yeh koi JSON nahi hai");
  } catch {
    threwParse = true;
  }
  check("unparseable output throws", threwParse);

  // Out-of-range bestIndex → first survivor wins, reason is the fallback note.
  const r4 = await generateAdConcepts(input, async () => conceptsJson({ bestIndex: 4 }));
  check("bestIndex 4 wins the 5th concept", r4.best.title === "Ek litre, poora din");

  // Scene-count rules: chain always means 9 scenes.
  check("chain 45s → 9 scenes", sceneCountForStyle(45, "standard", { storyboardChain: true }) === 9);
  check("chain 60s → 9 scenes", sceneCountForStyle(60, "brand_story", { storyboardChain: true }) === 9);
  check("chain 15s → 9 scenes", sceneCountForStyle(15, "standard", { storyboardChain: true }) === 9);
  check("no chain 45s standard → 5 scenes", sceneCountForStyle(45, "standard") === 5);
  check("macro_hero 45s → 4 scenes", sceneCountForStyle(45, "macro_hero") === 4);
  check("macro_hero 15s → 3 scenes", sceneCountForStyle(15, "macro_hero") === 3);
  check("banner_unroll 45s → 3 scenes", sceneCountForStyle(45, "banner_unroll") === 3);
  check("banner_unroll 15s → 3 scenes", sceneCountForStyle(15, "banner_unroll") === 3);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL STORYBOARD-CHAIN TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
