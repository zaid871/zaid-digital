/**
 * Zod schemas for the Phase 5 intermediate objects.
 *
 * research.ts carries the TypeScript interfaces (v1); these zod schemas are
 * the runtime validators used between pipeline stages. Field names mirror
 * research.ts exactly so persisted JSON stays consistent.
 */
import { z } from "zod";

export const CaptionCueSchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  text: z.string().min(1).max(500),
});

export const ScriptSceneSchema = z.object({
  sceneId: z.string().min(1),
  narration: z.string().min(1).max(2000),
  estimatedSeconds: z.number().positive().max(60),
  evidenceClaimIds: z.array(z.string()).default([]),
  pronunciationHints: z.record(z.string(), z.string()).default({}),
});
export type ScriptSceneT = z.infer<typeof ScriptSceneSchema>;

export const DmCtaSchema = z.object({
  /** Single-word comment keyword, e.g. "LINK". Uppercase enforced. */
  keyword: z.string().min(1).max(20),
  /** The spoken CTA line, e.g. "Comment me LINK likho — link seedha tumhare DM me bhej dunga." */
  ctaLine: z.string().min(1).max(160),
});
export type DmCtaT = z.infer<typeof DmCtaSchema>;

export const ScriptObjectSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  language: z.enum(["hinglish", "hindi", "english"]),
  scenes: z.array(ScriptSceneSchema).min(1).max(12),
  totalEstimatedSeconds: z.number().positive(),
  callToAction: z.string().min(1).max(500),
  /** MANDATORY auto-DM call to action (comment keyword → DM with link). */
  dmCta: DmCtaSchema,
});
export type ScriptObjectT = z.infer<typeof ScriptObjectSchema>;

export const StoryboardSceneSchema = z.object({
  sceneId: z.string().min(1),
  purpose: z.string().min(1),
  durationSeconds: z.number().positive().max(60),
  narrationSegment: z.string().min(1),
  onScreenText: z.array(z.string()),
  visualPrompt: z.string().min(1).max(2000),
  videoPrompt: z.string().min(1).max(1000),
  cameraMovement: z.enum([
    "zoom_in",
    "zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "zoom_in_fast",
    "macro_zoom",
  ]),
  /** Named camera template that produced cameraMovement (see camera-templates.ts). */
  cameraTemplate: z.string().optional(),
  /**
   * Commercial visual-direction treatment (AdGen-style scene treatment):
   * transitions, camera note, color note. Notes only — colorNote is NOT
   * injected into image prompts (it would fight the style preset's own
   * accent logic); cameraNote DOES steer the camera template (see
   * templateForDirection in camera-templates.ts).
   */
  visualDirection: z
    .object({
      transitionIn: z.string().max(200).optional(),
      transitionOut: z.string().max(200).optional(),
      cameraNote: z.string().max(200).optional(),
      colorNote: z.string().max(200).optional(),
    })
    .optional(),
  /** Before/after comparison labels — renders as a split-screen wipe (see animateComparison). */
  comparison: z
    .object({
      leftLabel: z.string().min(1).max(60),
      rightLabel: z.string().min(1).max(60),
    })
    .optional(),
  /**
   * CGI banner-unroll scene (Raj Photo Editing, 2026-11-10): a second
   * still (banner fully open) is generated alongside the main still
   * (banner closed/folded) and the two are rendered as a top-down wipe
   * (see animateBannerUnroll). bannerText is the brand name shown on
   * the banner — never a price, discount, or offer.
   */
  bannerUnroll: z
    .object({
      bannerText: z.string().min(1).max(60),
    })
    .optional(),
  transition: z.string().min(1),
  motionGraphicsNotes: z.string().default(""),
  captionCues: z.array(CaptionCueSchema),
  complianceNotes: z.string().default(""),
});
export type StoryboardSceneT = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardObjectSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  scenes: z.array(StoryboardSceneSchema).min(1).max(12),
  totalDurationSeconds: z.number().positive(),
});
export type StoryboardObjectT = z.infer<typeof StoryboardObjectSchema>;

export const SceneAssetObjectSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  sceneId: z.string().min(1),
  assetType: z.enum(["image", "video", "audio", "caption"]),
  storageKey: z.string().min(1),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  prompt: z.string().nullable(),
  generatedAt: z.string().min(1),
  costUsd: z.number().nullable(),
  contentHash: z.string().nullable(),
});
export type SceneAssetObjectT = z.infer<typeof SceneAssetObjectSchema>;

export const CreativePlanObjectSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  targetAudience: z.string().min(1),
  objective: z.string().min(1),
  hook: z.string().min(1),
  sellingPoints: z.array(z.string()),
  narrativeStructure: z.string().min(1),
  sceneOrder: z.array(z.string()),
  visualApproach: z.string().min(1),
  callToAction: z.string().min(1),
  claimsToAvoid: z.array(z.string()),
});
export type CreativePlanObjectT = z.infer<typeof CreativePlanObjectSchema>;
