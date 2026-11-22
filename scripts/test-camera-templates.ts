/**
 * Camera-template tests: template validity + storyboard wiring.
 * Run: npx tsx scripts/test-camera-templates.ts
 */
import { CAMERA_TEMPLATES, templateForPurpose } from "../src/lib/pipeline/camera-templates";
import { buildStoryboard } from "../src/lib/pipeline/storyboard";
import type { ScriptObjectT } from "../src/lib/pipeline/schemas";
import type { ProductIdentityInput } from "../src/lib/pipeline/types";

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

const STORYBOARD_MOTIONS = [
  "zoom_in", "zoom_out", "pan_left", "pan_right",
  "pan_up", "pan_down", "zoom_in_fast", "macro_zoom",
];

// Template validity
{
  const templates = Object.values(CAMERA_TEMPLATES);
  check("8 camera templates registered", templates.length === 8, String(templates.length));
  check(
    "every template motion is a storyboard motion",
    templates.every((t) => STORYBOARD_MOTIONS.includes(t.motion))
  );
  check(
    "every template has prompts + purposes",
    templates.every((t) => t.videoPrompt.length > 10 && t.imagePromptSuffix.length > 10 && t.purposes.length > 0)
  );
  check(
    "template ids match their keys",
    Object.entries(CAMERA_TEMPLATES).every(([k, t]) => k === t.id)
  );
}

// Purpose selection
check("premium hook → rush_push", templateForPurpose("hook", true).id === "rush_push");
check("premium hook motion is zoom_in_fast", templateForPurpose("hook", true).motion === "zoom_in_fast");
check("premium detail → macro_detail", templateForPurpose("detail_closeup", true).id === "macro_detail");
check("standard detail → macro_detail too", templateForPurpose("detail_closeup", false).id === "macro_detail");
check("premium feature → orbit_luxury", templateForPurpose("feature_highlight", true).id === "orbit_luxury");
check("standard feature → a classic", templateForPurpose("feature_highlight", false).id.startsWith("classic"));
check("unknown purpose → classic_dolly fallback", templateForPurpose("something_else", true).id === "classic_dolly");

// Storyboard integration
const identity: ProductIdentityInput = {
  canonicalName: "Steel Water Bottle",
  brand: "AquaPure",
  colors: ["steel silver"],
  materials: ["stainless steel"],
  distinctiveDetails: ["matte finish"],
  visualConsistencyNotes: "",
};
function scriptOf(n: number): ScriptObjectT {
  return {
    schemaVersion: "1.0.0",
    language: "hinglish",
    scenes: Array.from({ length: n }, (_, i) => ({
      sceneId: `s${i + 1}`,
      narration: `Scene ${i + 1} ki narration line hai ye wali doston`,
      estimatedSeconds: 9,
      evidenceClaimIds: [],
      pronunciationHints: {},
    })),
    totalEstimatedSeconds: n * 9,
    callToAction: "Check product details through the link in the description or profile.",
    dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga." },
  } as ScriptObjectT;
}

{
  const sb = buildStoryboard(scriptOf(5), identity, 45, "premium_dark");
  const byPurpose = new Map(sb.scenes.map((s) => [s.purpose, s]));
  check("premium storyboard validates (5 scenes)", sb.scenes.length === 5);
  check("hook scene uses rush template", byPurpose.get("hook")?.cameraTemplate === "rush_push", byPurpose.get("hook")?.cameraTemplate);
  check("hook motion is zoom_in_fast", byPurpose.get("hook")?.cameraMovement === "zoom_in_fast");
  check("detail scene uses macro template", byPurpose.get("detail_closeup")?.cameraTemplate === "macro_detail");
  check("detail motion is macro_zoom", byPurpose.get("detail_closeup")?.cameraMovement === "macro_zoom");
  check(
    "video prompt carries template language",
    (byPurpose.get("hook")?.videoPrompt ?? "").includes("aggressive fast push-in")
  );
  check(
    "visual prompt carries camera direction",
    (byPurpose.get("hook")?.visualPrompt ?? "").includes("Camera direction:")
  );
}
{
  const sb = buildStoryboard(scriptOf(5), identity, 45, null);
  const hook = sb.scenes.find((s) => s.purpose === "hook");
  const detail = sb.scenes.find((s) => s.purpose === "detail_closeup");
  check("standard hook stays classic zoom_in", hook?.cameraMovement === "zoom_in", hook?.cameraMovement);
  check("standard detail still gets macro", detail?.cameraMovement === "macro_zoom");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL CAMERA-TEMPLATE TESTS PASSED");
