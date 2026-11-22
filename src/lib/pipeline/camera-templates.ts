/**
 * Camera templates — named cinematic moves for product scenes.
 *
 * Each template is an honest recipe, not a promise of physics: our motion
 * is either (a) a Tier A AI video prompt (the template's videoPrompt text)
 * or (b) a Tier B FFmpeg 2D move (the template's base `motion`). A still
 * image cannot truly orbit, fly through, or splash — templates named after
 * those looks map to the closest real move we can render, and the prompt
 * text says what the AI tier should attempt.
 *
 * Inspired by the camera-template idea in Higgsfield-style tools, rebuilt
 * for this pipeline's free stack. All templates are vertical 9:16 first.
 */
import type { Motion } from "../providers/ffmpeg-motion";

export interface CameraTemplate {
  id: string;
  label: string;
  /** Base FFmpeg motion (Tier B) this template renders as. */
  motion: Motion;
  /** Light-sweep overlay on Tier B. */
  lightSweep: boolean;
  /** Motion description used in the Tier A image-to-video prompt. */
  videoPrompt: string;
  /** Extra direction appended to the still-image prompt. */
  imagePromptSuffix: string;
  /** Scene purposes this template suits best. */
  purposes: string[];
}

export const CAMERA_TEMPLATES: Record<string, CameraTemplate> = {
  rush_push: {
    id: "rush_push",
    label: "Rush push-in (hook energy)",
    motion: "zoom_in_fast",
    lightSweep: true,
    videoPrompt: "aggressive fast push-in toward the product with speed-ramp energy, slight motion streaks, high-retention hook feel",
    imagePromptSuffix: "dynamic forward-leaning composition with strong depth, product rushing toward the viewer",
    purposes: ["hook"],
  },
  orbit_luxury: {
    id: "orbit_luxury",
    label: "Luxury orbit (slow, moody)",
    motion: "pan_right",
    lightSweep: true,
    videoPrompt: "ultra-smooth slow orbital drift around the product, floating suspension feel, anamorphic highlights, volumetric moody shadows",
    imagePromptSuffix: "luxury hero composition, product floating slightly above a reflective dark surface, moody volumetric light",
    purposes: ["feature_highlight", "call_to_action"],
  },
  swoop_reveal: {
    id: "swoop_reveal",
    label: "Top-down swoop reveal",
    motion: "pan_down",
    lightSweep: false,
    videoPrompt: "dramatic top-down aerial swoop descending onto the product, realistic parallax, epic reveal",
    imagePromptSuffix: "elevated top-down-friendly composition with clear space above the product for a descending reveal",
    purposes: ["use_case", "feature_highlight"],
  },
  macro_detail: {
    id: "macro_detail",
    label: "Macro detail drift",
    motion: "macro_zoom",
    lightSweep: false,
    videoPrompt: "extreme macro close-up with a slow floating push-in, microscopic depth of field, glistening surface texture",
    imagePromptSuffix: "extreme macro detail framing, visible material texture, glistening highlights on the surface",
    purposes: ["detail_closeup"],
  },
  saga_pan: {
    id: "saga_pan",
    label: "Documentary saga pan",
    motion: "pan_left",
    lightSweep: false,
    videoPrompt: "cinematic slow lateral pan with a dramatic documentary angle, moody volumetric lighting, rich contrast, subtle film grain",
    imagePromptSuffix: "wide documentary composition with layered depth, moody contrast, storytelling framing",
    purposes: ["use_case"],
  },
  classic_dolly: {
    id: "classic_dolly",
    label: "Classic dolly-in",
    motion: "zoom_in",
    lightSweep: true,
    videoPrompt: "slow cinematic dolly-in toward the product",
    imagePromptSuffix: "clean centered composition with gentle depth",
    purposes: ["feature_highlight"],
  },
  classic_pullback: {
    id: "classic_pullback",
    label: "Classic pull-back reveal",
    motion: "zoom_out",
    lightSweep: false,
    videoPrompt: "slow pull-back revealing more of the scene",
    imagePromptSuffix: "composition with generous surrounding context for a pull-back reveal",
    purposes: ["call_to_action"],
  },
  rise_reveal: {
    id: "rise_reveal",
    label: "Rising reveal",
    motion: "pan_up",
    lightSweep: true,
    videoPrompt: "smooth rising camera reveal lifting toward the product, weighty premium movement",
    imagePromptSuffix: "low-angle composition looking up at the product with headroom above",
    purposes: ["hook", "use_case"],
  },
};

/** Standard-style assignment per purpose (calmer classics). */
const STANDARD_BY_PURPOSE: Record<string, string> = {
  hook: "classic_dolly",
  feature_highlight: "classic_dolly",
  use_case: "saga_pan",
  detail_closeup: "macro_detail",
  call_to_action: "classic_pullback",
  // Aminul macro-hero beats.
  ingredient: "macro_detail",
  craft: "saga_pan",
  hero: "classic_dolly",
  // ATTAR attar-luxury beats: ritual = calm dolly-in on the wrist shot.
  ritual: "classic_dolly",
  // Raj banner-unroll: carried for the schema, the unroll renderer
  // (animateBannerUnroll) ignores camera movement, like comparison.
  banner_unroll: "classic_dolly",
};

/**
 * Template for a scene purpose. Premium-dark gets the expressive set
 * (first template registered for the purpose); standard style gets the
 * calmer classic assignment above.
 */
export function templateForPurpose(purpose: string, premiumDark: boolean): CameraTemplate {
  if (premiumDark) {
    const expressive = Object.values(CAMERA_TEMPLATES).find((t) => t.purposes.includes(purpose));
    if (expressive) return expressive;
  }
  return CAMERA_TEMPLATES[STANDARD_BY_PURPOSE[purpose] ?? "classic_dolly"];
}

/**
 * Template steered by a scene's commercial visual direction (AdGen-style
 * scene treatment). Keyword-matches the direction text (transition +
 * camera note) to the closest real template; returns null when nothing
 * matches so the caller falls back to templateForPurpose. Order matters:
 * specific moves (orbit, macro) are checked before generic ones (zoom).
 */
export function templateForDirection(directionText: string, premiumDark: boolean): CameraTemplate | null {
  const t = directionText.toLowerCase();
  const pick = (id: string): CameraTemplate => CAMERA_TEMPLATES[id];
  if (/orbit|360|rotat|revolv/.test(t)) return pick("orbit_luxury");
  if (/macro|close[- ]?up|detail|texture/.test(t)) return pick("macro_detail");
  if (/swoop|drop|descend|top[- ]?down/.test(t)) return pick("swoop_reveal");
  if (/rise|lifting|lift|from below|upward/.test(t)) return pick("rise_reveal");
  if (/zoom|push|dolly|rush|fast/.test(t)) return pick(premiumDark ? "rush_push" : "classic_dolly");
  if (/pull|back|wide|reveal/.test(t)) return pick("classic_pullback");
  if (/pan|slide|swipe|sweep|lateral/.test(t)) return pick("saga_pan");
  return null;
}
