/**
 * Visual-direction tests: direction->template mapping + storyboard
 * passthrough (visualDirection preserved, camera steered, comparison
 * purpose override). Run: npx tsx scripts/test-visual-direction.ts
 */
import { templateForDirection } from "../src/lib/pipeline/camera-templates";
import { buildStoryboard } from "../src/lib/pipeline/storyboard";
import type { ScriptObjectT } from "../src/lib/pipeline/schemas";

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

function main() {
  check("dolly-in -> classic_dolly (standard)", templateForDirection("slow dolly-in", false)?.id === "classic_dolly");
  check("dolly-in -> rush_push (premium)", templateForDirection("slow dolly-in", true)?.id === "rush_push");
  check("360 orbit -> orbit_luxury", templateForDirection("camera rotates 360 around product", false)?.id === "orbit_luxury");
  check("macro close-up -> macro_detail", templateForDirection("extreme macro close-up", false)?.id === "macro_detail");
  check("pan -> saga_pan", templateForDirection("smooth lateral pan", false)?.id === "saga_pan");
  check("no cue -> null (purpose fallback)", templateForDirection("something vague", false) === null);
  check("price in direction is ignored by mapper (no crash)", templateForDirection("zoom", false)?.id === "classic_dolly");

  const script = {
    schemaVersion: "1.0.0",
    language: "hinglish",
    scenes: [
      { sceneId: "s1", narration: "Ye mixer har kaam asaan kar deta hai.", estimatedSeconds: 8, evidenceClaimIds: [], pronunciationHints: {} },
      { sceneId: "s2", narration: "Pehle haath se mehnat, ab ek button.", estimatedSeconds: 8, evidenceClaimIds: [], pronunciationHints: {} },
      { sceneId: "s3", narration: "Link description me check karein.", estimatedSeconds: 5, evidenceClaimIds: [], pronunciationHints: {} },
    ],
    totalEstimatedSeconds: 21,
    callToAction: "Check product details through the link in the description or profile.",
    dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga." },
    _extras: [
      { sceneId: "s1", onScreenText: null, claimsAvoided: [], visualDirection: { cameraNote: "slow dolly-in", colorNote: "deep blacks with one warm accent" }, comparison: null },
      { sceneId: "s2", onScreenText: null, claimsAvoided: [], visualDirection: null, comparison: { leftLabel: "Pehle", rightLabel: "Ab" } },
      { sceneId: "s3", onScreenText: null, claimsAvoided: [], visualDirection: null, comparison: null },
    ],
  } as unknown as ScriptObjectT;

  const sb = buildStoryboard(script, { canonicalName: "Test Mixer", colors: [], materials: [], distinctiveDetails: [], visualConsistencyNotes: "" }, 30);
  const s1 = sb.scenes[0];
  const s2 = sb.scenes[1];
  check("s1 visualDirection preserved", s1.visualDirection?.cameraNote === "slow dolly-in" && s1.visualDirection?.colorNote?.includes("deep blacks") === true);
  check("s1 camera steered by direction", s1.cameraTemplate === "classic_dolly", s1.cameraTemplate ?? "");
  check("s1 direction note in motionGraphicsNotes", (s1.motionGraphicsNotes ?? "").includes("deep blacks"));
  check("s2 purpose overridden to comparison", s2.purpose === "comparison", s2.purpose);
  check("s2 comparison labels preserved", s2.comparison?.leftLabel === "Pehle" && s2.comparison?.rightLabel === "Ab");
  check("s2 motion note mentions split-screen", (s2.motionGraphicsNotes ?? "").includes("Split-screen"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL VISUAL-DIRECTION TESTS PASSED");
}

main();
