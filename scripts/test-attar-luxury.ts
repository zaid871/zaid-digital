/**
 * Attar-luxury tests: the ATTAR attar ad the user shared (2026-11-11,
 * 12s, 4 shots: hero push-in → oil-drop macro → wrist ritual →
 * serif end card). Covers storyboard purposes + visual prompts,
 * camera mapping, and the serif title-card ASS events (price guards,
 * Fraunces font, wide tracking, italic tagline).
 * Run: npx tsx scripts/test-attar-luxury.ts
 */
import { buildStoryboard } from "../src/lib/pipeline/storyboard";
import type { ScriptObjectT } from "../src/lib/pipeline/schemas";
import { templateForPurpose } from "../src/lib/pipeline/camera-templates";
import {
  serifTitleAssEvents,
  SERIF_TITLE_FONT,
  SERIF_TITLE_GOLD_ASS,
} from "../src/lib/pipeline/motion";
import { createJobSchema } from "../src/lib/schemas";

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

function scriptOf(n: number): ScriptObjectT {
  return {
    schemaVersion: "1.0.0",
    language: "hinglish",
    scenes: Array.from({ length: n }, (_, i) => ({
      sceneId: `s${i + 1}`,
      narration: `Scene ${i + 1} ke liye natural hinglish narration line hai ye wali, comment me LINK likho`,
      estimatedSeconds: 5,
      evidenceClaimIds: [],
      pronunciationHints: {},
    })),
    totalEstimatedSeconds: n * 5,
    callToAction: "Check product details through the link in the description or profile.",
    dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga." },
  };
}

const identity = {
  canonicalName: "Oud Rose Attar",
  brand: "ATTAR",
  model: null,
  category: "Fragrance",
  colors: ["amber"],
  materials: ["glass", "gold"],
  distinctiveDetails: ["faceted crystal bottle", "ornate gold cap"],
  visualConsistencyNotes: "",
};

async function main() {
  // ---- storyboard: 4 scenes, Hero → Drop → Ritual → End card ----
  const sb = buildStoryboard(scriptOf(4), identity, 15, null, { scriptStyle: "attar_luxury" });
  check("storyboard has 4 scenes", sb.scenes.length === 4);
  check(
    "scene purposes are hero/ingredient/ritual/cta",
    sb.scenes.map((s) => s.purpose).join(",") === "hero,ingredient,ritual,call_to_action",
    sb.scenes.map((s) => s.purpose).join(",")
  );

  // Hero: arch + lattice + oud wood + rose petals + pack untouched.
  const hero = sb.scenes[0].visualPrompt;
  check("hero prompt has scalloped arch", hero.includes("scalloped arch"));
  check("hero prompt has lattice shadows", hero.includes("lattice"));
  check("hero prompt has oud wood + rose petals", hero.includes("oud wood") && hero.includes("rose petals"));
  check("hero prompt is pack-untouched", hero.includes("do not redesign"));
  check("hero prompt has no faces", hero.includes("no faces"));

  // Drop (ingredient): dropper + drop + petal, extreme macro.
  const drop = sb.scenes[1].visualPrompt;
  check("drop prompt is extreme macro", drop.includes("Extreme macro"));
  check("drop prompt has dropper + drop + petal", drop.includes("dropper") && drop.includes("drop") && drop.includes("petal"));
  check("drop prompt is pack-untouched", drop.includes("do not redesign"));

  // Ritual: hands + wrist, no faces, bottle in background.
  const ritual = sb.scenes[2].visualPrompt;
  check("ritual prompt is hands-only on a wrist", ritual.includes("Hands only") && ritual.includes("wrist"));
  check("ritual prompt has no faces", ritual.includes("no faces"));
  check("ritual prompt keeps bottle in background", ritual.includes("soft-focus in the background"));

  // End card: hero close-up + warm bokeh.
  const end = sb.scenes[3].visualPrompt;
  check("end-card prompt is a hero close-up", end.includes("hero close-up"));
  check("end-card prompt has warm bokeh", end.includes("bokeh"));
  check("end-card prompt is pack-untouched", end.includes("do not redesign"));

  // Motion + compliance notes.
  check(
    "end-card notes mention the serif title",
    sb.scenes[3].motionGraphicsNotes.includes("serif brand title")
  );
  check(
    "ritual notes forbid faces",
    sb.scenes[2].motionGraphicsNotes.includes("no faces")
  );
  check(
    "compliance notes demand verified taglines",
    sb.scenes[3].complianceNotes.includes("verified feature only")
  );
  check(
    "compliance notes warn about pack artefacts",
    sb.scenes[0].complianceNotes.includes("AI artefacts")
  );

  // ---- camera mapping ----
  check("ingredient motion is macro_zoom", sb.scenes[1].cameraMovement === "macro_zoom");
  check("hero motion is a slow dolly-in", sb.scenes[0].cameraMovement === "zoom_in");
  check("ritual motion is a slow dolly-in", sb.scenes[2].cameraMovement === "zoom_in");
  check("ritual template is classic_dolly", templateForPurpose("ritual", false).id === "classic_dolly");

  // ---- serif title-card ASS events ----
  const ev = serifTitleAssEvents("ATTAR", "the essence that stays", 10, 15);
  check("serif card returns 2 events (title + tagline)", ev.length === 2, `got ${ev.length}`);
  check("title uses the Fraunces font", ev[0].includes(`\\fn${SERIF_TITLE_FONT}`));
  check("title is wide-tracked caps", ev[0].includes("\\fsp14") && ev[0].includes("ATTAR"));
  check("title is gold", ev[0].includes(`\\1c${SERIF_TITLE_GOLD_ASS}`));
  check("title spans the scene window", ev[0].includes("0:00:10.00") && ev[0].includes("0:00:15.00"));
  check("tagline is italic serif", ev[1].includes("\\i1") && ev[1].includes(`\\fn${SERIF_TITLE_FONT}`));
  check("tagline lands after the title", ev[1].includes("0:00:10.40"));

  // Title is uppercased even when given lowercase.
  const lower = serifTitleAssEvents("attar", null, 0, 3);
  check("lowercase brand becomes spaced caps", lower.length === 1 && lower[0].includes("ATTAR"));

  // Guards: price in the tagline drops the tagline only; price in the
  // title (or an empty title / reversed window) drops everything.
  const priceTag = serifTitleAssEvents("ATTAR", "sirf Rs 999 me", 0, 3);
  check("price tagline dropped, title kept", priceTag.length === 1 && priceTag[0].includes("ATTAR"));
  check("price title drops the whole card", serifTitleAssEvents("ATTAR Rs 999", "tagline", 0, 3).length === 0);
  check("empty title drops the whole card", serifTitleAssEvents("   ", "tagline", 0, 3).length === 0);
  check("reversed window drops the whole card", serifTitleAssEvents("ATTAR", "tagline", 5, 5).length === 0);

  // ---- job schema accepts the new style ----
  const ok = createJobSchema.safeParse({
    productUrl: "https://example.com/product",
    scriptStyle: "attar_luxury",
  });
  check("createJobSchema accepts attar_luxury", ok.success);
  const bad = createJobSchema.safeParse({
    productUrl: "https://example.com/product",
    scriptStyle: "attar",
  });
  check("createJobSchema rejects a bogus style", !bad.success);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL ATTAR-LUXURY TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
