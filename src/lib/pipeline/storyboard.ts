/**
 * Storyboard construction (Phase 5) — deterministic, no network.
 *
 * Expands each script scene into a full StoryboardScene: purpose, scaled
 * duration, cinematic 9:16 image prompt, image-to-video motion prompt,
 * camera movement, caption cues, and compliance notes. Total duration is
 * scaled to the requested 30–60s target.
 */
import { StoryboardObjectSchema, type StoryboardObjectT, type StoryboardSceneT } from "./schemas";
import { scriptExtras } from "./script";
import type { ScriptObjectT } from "./schemas";
import { PRICE_PATTERN } from "@/lib/compliance";
import { PipelineError, isPremiumDark, type ProductIdentityInput } from "./types";
import { templateForDirection, templateForPurpose } from "./camera-templates";

type CameraMovement = StoryboardSceneT["cameraMovement"];

function purposesFor(count: number, style?: string | null): string[] {
  // Aminul macro-hero beats: Ingredient → Craft → Hero (+ Closing).
  if (style === "macro_hero") {
    if (count <= 3) return ["ingredient", "craft", "hero"];
    return ["ingredient", "craft", "hero", "call_to_action"];
  }
  // Raj banner-unroll shop ad: Hook → unroll → hold + CTA.
  if (style === "banner_unroll") {
    return ["hook", "banner_unroll", "call_to_action"].slice(0, Math.max(count, 1));
  }
  // ATTAR attar ad (user-shared, 2026-11-11): Hero → Drop → Ritual → End card.
  if (style === "attar_luxury") {
    return ["hero", "ingredient", "ritual", "call_to_action"].slice(0, Math.max(count, 1));
  }
  if (count <= 1) return ["hook"];
  const out: string[] = ["hook"];
  const middles = ["feature_highlight", "use_case", "detail_closeup", "feature_highlight"];
  for (let i = 1; i < count - 1; i++) out.push(middles[(i - 1) % middles.length]);
  out.push("call_to_action");
  return out;
}

function describeAppearance(id: ProductIdentityInput): string {
  const bits: string[] = [];
  if (id.colors.length) bits.push(`colors: ${id.colors.join(", ")}`);
  if (id.materials.length) bits.push(`materials: ${id.materials.join(", ")}`);
  if (id.distinctiveDetails.length) bits.push(`details: ${id.distinctiveDetails.join(", ")}`);
  if (id.model) bits.push(`model ${id.model}`);
  return bits.join("; ");
}

/**
 * Single brand accent color for the premium-dark look: the product's own
 * first known color when available, otherwise a vivid cinematic cyan-blue.
 * One accent only — the dark base does the rest of the work.
 */
function accentColorFor(id: ProductIdentityInput): string {
  const c = (id.colors[0] ?? "").trim();
  return c || "vivid cyan-blue";
}

/**
 * Premium-dark cinematic image prompt: near-black studio background, hero
 * product as a floating centerpiece with dramatic rim light, a single
 * brand accent glow, and soft reflections on a dark glossy surface.
 * This is the "premium ad" look (dark foundation + one accent color).
 */
function premiumDarkVisualPromptFor(id: ProductIdentityInput, purpose: string): string {
  const appearance = describeAppearance(id) || "clean modern product design";
  const accent = accentColorFor(id);
  const angle =
    purpose === "detail_closeup"
      ? "extreme macro close-up angle revealing fine details"
      : purpose === "hook"
        ? "dramatic three-quarter hero angle, product slightly larger than life"
        : "clean eye-level product angle";
  const prompt =
    `Cinematic premium product advertisement photograph of ${id.canonicalName} (${appearance}). ` +
    `The product floats as a hero centerpiece against a near-black studio background, ` +
    `lit by dramatic rim lighting with a subtle ${accent} neon accent glow, ` +
    `soft realistic reflections on a dark glossy surface below, faint atmospheric haze. ` +
    `${angle}, vertical 9:16 composition, ultra detailed, photorealistic, sharp focus on the product, ` +
    `dark luxury commercial style like a high-end tech brand ad. ` +
    (id.visualConsistencyNotes ? `Consistency: ${id.visualConsistencyNotes}. ` : "") +
    `No text overlays, no watermark, no people, no bright daylight.`;
  return prompt.slice(0, 900);
}

/**
 * Macro-hero look (Aminul Visuals, 2026-11-10): one colour world, macro
 * texture, slow push-in, pack design untouched. The product's own first
 * colour is the single dominant colour of every scene; faces never
 * appear (hands only when they touch the product). The pack-untouched
 * rule is in EVERY prompt — an AI "redesign" of the pack is a QC fail,
 * not a style choice.
 */
function macroHeroVisualPromptFor(id: ProductIdentityInput, purpose: string): string {
  const appearance = describeAppearance(id) || "clean modern product design";
  const accent = accentColorFor(id);
  const packRule =
    "Keep the product's original design, logo, colours and packaging exactly as shown — do not redesign, relabel, or alter the pack in any way.";
  const oneColour = `One colour world: ${accent} is the single dominant colour of the whole frame.`;
  const base =
    `Cinematic premium product advertisement photograph of ${id.canonicalName} (${appearance}). ` +
    `${oneColour} Dark cinematic background, dramatic rim lighting, soft realistic reflections. ` +
    `Vertical 9:16 composition, ultra detailed, photorealistic, sharp focus on the product. ` +
    `${packRule} No text overlays, no watermark, no faces.`;
  if (purpose === "ingredient") {
    return (
      `Extreme macro close-up of ${id.canonicalName} (${appearance}) — the raw ingredient and fine surface texture in microscopic detail, ` +
      `condensation droplets and glistening highlights, shallow depth of field, slow floating push-in feel. ${oneColour} ` +
      `Dark cinematic background. ${packRule} No text overlays, no watermark, no faces — hands only if they touch the product.`
    ).slice(0, 900);
  }
  if (purpose === "craft") {
    return (
      `The making of ${id.canonicalName} (${appearance}) — hands at work in a dark cinematic workshop, the process in progress, ` +
      `warm practical light against a dark background. ${oneColour} ` +
      `Vertical 9:16 composition, photorealistic, sharp focus on the product and the hands making it. ${packRule} ` +
      `No text overlays, no watermark, no faces.`
    ).slice(0, 900);
  }
  // hero / call_to_action: the product as the floating hero centerpiece.
  return (
    `${base} ` +
    `The product floats as a hero centerpiece, slightly larger than life, dramatic three-quarter hero angle, ` +
    `soft reflections on a dark glossy surface below, faint atmospheric haze.`
  ).slice(0, 900);
}

/**
 * Banner-unroll still, CLOSED state (Raj Photo Editing, 2026-11-10):
 * a tall shop building with the big vertical banner still rolled up
 * and folded at the top of the facade. The OPEN state is generated in
 * visuals.ts as the alternate version of this same prompt.
 */
function bannerUnrollVisualPromptFor(id: ProductIdentityInput): string {
  const appearance = describeAppearance(id) || "clean modern product design";
  const bannerText = (id.brand ?? id.canonicalName).slice(0, 60);
  return (
    `Photorealistic tall shop building in a busy Indian street, daytime, ` +
    `a large vertical advertising banner for ${bannerText} (${appearance}) rolled up and folded closed at the top of the facade, ` +
    `the banner fabric neatly gathered, the shop front visible below. ` +
    `Vertical 9:16 composition, ultra detailed, photorealistic, sharp focus. ` +
    `The banner shows the brand name only — no prices, discounts, or offers. No text overlays besides the banner itself, no watermark, no faces.`
  ).slice(0, 900);
}

/**
 * Attar-luxury look (ATTAR attar ad, user-shared 2026-11-11): warm
 * golden-hour light, a scalloped arch glowing behind the product,
 * mashrabiya lattice shadows across the frame, dark oud wood and rose
 * petals as props, the bottle as a jewel. Hands only in the ritual
 * shot (applying to a wrist); faces never appear. The pack-untouched
 * rule is in EVERY prompt — an AI "redesign" of the bottle is a QC
 * fail, not a style choice. The end-card scene is a hero close-up on
 * a warm bokeh background, ready for the serif brand title.
 */
function attarLuxuryVisualPromptFor(id: ProductIdentityInput, purpose: string): string {
  const appearance = describeAppearance(id) || "clean modern product design";
  const accent = accentColorFor(id);
  const packRule =
    "Keep the product's original design, logo, colours and packaging exactly as shown — do not redesign, relabel, or alter the pack in any way.";
  const warmWorld =
    `Warm golden-hour light, one warm colour world: ${accent} is the single dominant colour of the whole frame. ` +
    `A scalloped arch glows softly behind the product, mashrabiya lattice shadows fall across the scene.`;
  if (purpose === "ingredient") {
    return (
      `Extreme macro close-up of ${id.canonicalName} (${appearance}) — a single golden drop of the oil falling from a glass dropper ` +
      `onto a fresh rose petal, the drop catching the warm light, shallow depth of field, glistening highlights. ${warmWorld} ` +
      `Vertical 9:16 composition, ultra detailed, photorealistic. ${packRule} ` +
      `No text overlays, no watermark, no faces — hands only if they hold the dropper.`
    ).slice(0, 900);
  }
  if (purpose === "ritual") {
    return (
      `Hands only applying ${id.canonicalName} (${appearance}) to a wrist — one hand holds the wrist, the other dabs the product on with a petal, ` +
      `the bottle small and soft-focus in the background on warm wood, rose petals scattered, warm lattice light across the frame. ${warmWorld} ` +
      `Vertical 9:16 composition, ultra detailed, photorealistic. ${packRule} ` +
      `No text overlays, no watermark, no faces, no full body — hands and wrist only.`
    ).slice(0, 900);
  }
  if (purpose === "call_to_action") {
    return (
      `Cinematic hero close-up of ${id.canonicalName} (${appearance}) — the bottle large and centered, faceted glass glowing amber in warm golden light, ` +
      `soft warm bokeh background, gentle reflections on a polished stone surface below, rose petals at the edges of the frame. ${warmWorld} ` +
      `Vertical 9:16 composition, ultra detailed, photorealistic, sharp focus on the product. ${packRule} ` +
      `No text overlays, no watermark, no faces.`
    ).slice(0, 900);
  }
  // hero: the product on oud wood, arch + lattice behind, slow push-in feel.
  // The pack rule sits early — the 900-char cap must never cut it off.
  return (
    `Cinematic premium product advertisement photograph of ${id.canonicalName} (${appearance}) — the product resting on a slab of dark oud wood, ` +
    `rose petals scattered around it, a scalloped arch glowing warm behind it, mashrabiya lattice light falling across the scene. ${packRule} ` +
    `${warmWorld} Three-quarter hero angle, slightly larger than life, soft reflections, faint haze. ` +
    `Vertical 9:16, ultra detailed, photorealistic, sharp focus on the product. No text overlays, no watermark, no faces.`
  ).slice(0, 900);
}

function visualPromptFor(
  id: ProductIdentityInput,
  purpose: string,
  visualStyle: string | null | undefined,
  scriptStyle?: string | null
): string {
  if (scriptStyle === "macro_hero") {
    return macroHeroVisualPromptFor(id, purpose);
  }
  if (scriptStyle === "attar_luxury") {
    return attarLuxuryVisualPromptFor(id, purpose);
  }
  if (scriptStyle === "banner_unroll" && purpose === "banner_unroll") {
    return bannerUnrollVisualPromptFor(id);
  }
  if (isPremiumDark(visualStyle)) {
    return premiumDarkVisualPromptFor(id, purpose);
  }
  const appearance = describeAppearance(id) || "clean modern product design";
  const style = visualStyle || "modern premium";
  const angle =
    purpose === "detail_closeup"
      ? "macro close-up angle revealing fine details"
      : purpose === "hook"
        ? "dramatic three-quarter hero angle"
        : "clean eye-level product angle";
  const prompt =
    `Cinematic product photography of ${id.canonicalName} (${appearance}). ` +
    `Professional studio lighting, soft key light with gentle rim light, clean gradient background, ` +
    `product perfectly centered, ${angle}, vertical 9:16 composition, ultra detailed, ${style} commercial advertisement style. ` +
    (id.visualConsistencyNotes ? `Consistency: ${id.visualConsistencyNotes}. ` : "") +
    `Photorealistic, sharp focus on the product, no text overlays, no watermark.`;
  return prompt.slice(0, 900);
}

const MOTION_DESCRIPTIONS: Record<CameraMovement, string> = {
  zoom_in: "slow cinematic dolly-in toward the product",
  zoom_out: "slow pull-back revealing more of the scene",
  pan_left: "smooth lateral pan from right to left across the product",
  pan_right: "smooth lateral pan from left to right across the product",
  pan_up: "smooth rising camera reveal lifting toward the product",
  pan_down: "dramatic top-down swoop descending onto the product",
  zoom_in_fast: "aggressive fast push-in with speed-ramp energy",
  macro_zoom: "extreme macro close-up, slow floating push-in through fine surface detail",
};

function videoPromptFor(purpose: string, motion: CameraMovement, templateText?: string): string {
  return (
    `Apply ${templateText ?? MOTION_DESCRIPTIONS[motion]} to this product image. ` +
    `Subtle, professional advertisement feel — keep the product sharp, centered and undistorted. ` +
    `Scene purpose: ${purpose.replace(/_/g, " ")}.`
  ).slice(0, 600);
}

/**
 * Build the storyboard. Durations are scaled so the total matches
 * targetDurationSec (already clamped to 30–60 by the caller).
 */
export function buildStoryboard(
  script: ScriptObjectT,
  identity: ProductIdentityInput,
  targetDurationSec: number,
  visualStyle?: string | null,
  opts?: { scriptStyle?: string | null }
): StoryboardObjectT {
  const scriptStyle = opts?.scriptStyle ?? null;
  const purposes = purposesFor(script.scenes.length, scriptStyle);
  const extras = scriptExtras(script);
  const extrasById = new Map(extras.map((e) => [e.sceneId, e]));
  // The auto-DM keyword is a first-class on-screen element on the final
  // CTA scene: viewers must SEE the comment keyword, not just hear it.
  const dmBadge =
    extras[0]?.dmCta?.keyword?.trim()
      ? `💬 ${extras[0].dmCta.keyword.trim().toUpperCase()} comment karo 👇`
      : null;

  const rawTotal = script.scenes.reduce((a, s) => a + s.estimatedSeconds, 0);
  const scale = rawTotal > 0 ? targetDurationSec / rawTotal : 1;

  let cursor = 0;
  const scenes: StoryboardSceneT[] = script.scenes.map((s, i) => {
    const extra = extrasById.get(s.sceneId);
    const onScreenText = extra?.onScreenText ? [extra.onScreenText] : [];
    // Final CTA scene always carries the auto-DM keyword badge on screen.
    if (dmBadge && i === script.scenes.length - 1 && !onScreenText.includes(dmBadge)) {
      onScreenText.push(dmBadge);
    }
    const claimsAvoided = extra?.claimsAvoided ?? [];
    const visualDirection = extra?.visualDirection ?? undefined;
    const comparison = extra?.comparison ?? undefined;
    // A comparison-flagged scene becomes the comparison purpose (at most
    // one per script by prompt rule); it renders as a split-screen wipe.
    const purpose = comparison ? "comparison" : purposes[i];
    // A banner-unroll scene (Raj shop ad, scene 2) carries the banner
    // text so visuals.ts can generate the open-banner second still.
    // The banner shows the brand name only — a price-like brand string
    // falls back to the plain product name.
    const bannerTextRaw = (identity.brand ?? identity.canonicalName).slice(0, 60);
    const bannerUnroll =
      purpose === "banner_unroll"
        ? {
            bannerText: PRICE_PATTERN.test(bannerTextRaw)
              ? identity.canonicalName.slice(0, 60)
              : bannerTextRaw,
          }
        : undefined;
    // Camera template: a visual-direction camera note steers the template
    // (AdGen-style scene treatment); otherwise the purpose default wins.
    const directionText = visualDirection
      ? [visualDirection.transitionIn, visualDirection.transitionOut, visualDirection.cameraNote]
          .filter(Boolean)
          .join(" ")
      : "";
    const template =
      templateForDirection(directionText, isPremiumDark(visualStyle)) ??
      templateForPurpose(purpose, isPremiumDark(visualStyle));
    const motion: CameraMovement = template.motion as CameraMovement;
    // Scale, then fix rounding drift on the final scene so the total is exact.
    let durationSeconds = Math.round(s.estimatedSeconds * scale * 10) / 10;
    if (i === script.scenes.length - 1) {
      durationSeconds = Math.round((targetDurationSec - cursor) * 10) / 10;
    }
    durationSeconds = Math.max(2, durationSeconds);
    const startSeconds = Math.round(cursor * 10) / 10;
    const endSeconds = Math.round((cursor + durationSeconds) * 10) / 10;
    cursor += durationSeconds;

    const directionNote = visualDirection
      ? ` Visual direction: ${[
          visualDirection.transitionIn ? `in: ${visualDirection.transitionIn}` : "",
          visualDirection.transitionOut ? `out: ${visualDirection.transitionOut}` : "",
          visualDirection.colorNote ? `colors: ${visualDirection.colorNote}` : "",
        ]
          .filter(Boolean)
          .join("; ")}.`
      : "";

    return {
      sceneId: s.sceneId,
      purpose,
      durationSeconds,
      narrationSegment: s.narration,
      onScreenText,
      visualPrompt: `${visualPromptFor(identity, purpose, visualStyle, scriptStyle)} Camera direction: ${template.imagePromptSuffix}.`,
      videoPrompt: videoPromptFor(purpose, motion, template.videoPrompt),
      cameraMovement: motion,
      cameraTemplate: template.id,
      visualDirection,
      comparison,
      bannerUnroll,
      transition: i === 0 ? "fade_in" : "cut",
      motionGraphicsNotes:
        (purpose === "call_to_action"
          ? scriptStyle === "attar_luxury"
            ? "Attar end card: hero close-up holds while the serif brand title (wide-tracked caps) and one short verified tagline fade in above the bottle."
            : "End-card: product centered, CTA text animated in from bottom, clean hold."
          : purpose === "comparison"
            ? "Split-screen comparison: left vs right with an animated wipe divider; labels at the bottom corners."
            : purpose === "banner_unroll"
              ? "Banner unroll: closed-banner still wipes down to the open-banner still over ~2s, then holds the open banner. No prices or discounts on the banner."
              : purpose === "ingredient"
                ? scriptStyle === "attar_luxury"
                  ? "Attar drop: extreme macro of the oil drop falling onto the petal; slow push-in; one warm colour world; pack design untouched."
                  : "Macro hero: extreme close-up texture with a slow push-in; one colour world; pack design untouched."
                : purpose === "ritual"
                  ? "Attar ritual: hands only apply the product to a wrist, bottle soft-focus behind; warm lattice light; no faces."
                  : purpose === "craft"
                    ? "Craft: hands at work, process in progress; one colour world; pack design untouched."
                    : purpose === "hero"
                      ? scriptStyle === "attar_luxury"
                        ? "Attar hero: bottle on oud wood, rose petals, arch + lattice light behind; slow push-in; pack design untouched."
                        : "Hero: product as the floating centerpiece, pack design untouched, single accent glow."
                      : "Lower-third feature callout may animate in once; keep product unobstructed.") + directionNote,
      captionCues: [{ startSeconds, endSeconds, text: s.narration }],
      complianceNotes: [
        "On-screen text contains no prices, discounts, or offers.",
        "Narration limited to verified product facts.",
        purpose === "banner_unroll"
          ? "Banner shows the brand name only — no prices, discounts, or offers."
          : "",
        scriptStyle === "macro_hero"
          ? "Pack design must match the source product — AI artefacts (misspelled pack text, redesigned logo) are a review fail."
          : "",
        scriptStyle === "attar_luxury"
          ? "Pack design must match the source product — AI artefacts (misspelled pack text, redesigned logo) are a review fail. End-card tagline must come from a verified feature only — no invented longevity, strength, or efficacy claim."
          : "",
        claimsAvoided.length ? `Claims deliberately avoided: ${claimsAvoided.join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });

  const candidate = {
    schemaVersion: "1.0.0",
    scenes,
    totalDurationSeconds: Math.round(cursor * 10) / 10,
  };
  const validated = StoryboardObjectSchema.safeParse(candidate);
  if (!validated.success) {
    throw new PipelineError(
      "validation_failed",
      "storyboard_generation",
      `Storyboard failed schema validation: ${validated.error.message.slice(0, 300)}`,
      false
    );
  }
  return validated.data;
}
