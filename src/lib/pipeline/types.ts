/**
 * Phase 5 creative pipeline — shared types.
 *
 * The creative pipeline turns verified product facts into a script,
 * storyboard, voiceover, visuals, and captions. It NEVER fabricates:
 * provider failures and compliance blocks are typed PipelineErrors.
 */
import type { JobStageKey } from "@/lib/job-stages";

/** Verified product facts handed to the creative pipeline (Phase 4 output). */
export interface ProductFactsInput {
  productName: string;
  brand?: string | null;
  category?: string | null;
  /** Claims backed by trustworthy evidence — the ONLY claims the script may state. */
  verifiedFeatures: string[];
  /** Seller claims without independent evidence — tracked, never stated as fact. */
  unverifiedClaims: string[];
  description?: string | null;
  sourceUrls: string[];
}

/** Product identity handed to the creative pipeline (Phase 4 output). */
export interface ProductIdentityInput {
  canonicalName: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  colors: string[];
  materials: string[];
  distinctiveDetails: string[];
  visualConsistencyNotes: string;
}

export interface CreativeRunOptions {
  /** Target total seconds; clamped to 30–60 by the orchestrator. */
  targetDurationSec: number;
  language: string;
  voice?: string | null;
  visualStyle?: string | null;
  /** Script structure: "standard" (default), "numbered" (hook → Pehli/Dusri baat points → closing line), "brand_story" (Hook question → Origin → Twist → Proof → Lesson → CTA; 5 scenes at 45–60s, 6 at 75–120s), "macro_hero" (Ingredient → Craft → Hero, pack untouched, no faces; 3 scenes when short, 4 at 30–60s), "banner_unroll" (Hook → banner rolls down the facade → hold + CTA; always 3 scenes), or "attar_luxury" (Hero → oil Drop macro → Ritual wrist apply → serif end card; always 4 scenes; warm golden light, arch + lattice, no faces). */
  scriptStyle?: string | null;
  /**
   * Opt-in storyboard chain (Raj, 2026-11-10): 5 ad concepts first,
   * best wins, script + 9-scene storyboard built on the winner.
   */
  storyboardChain?: boolean;
}

/**
 * Named visual-style presets recognized by the pipeline.
 *
 * - "standard": the default clean-studio look (any other free-form
 *   visualStyle string keeps the legacy generic prompt treatment).
 * - "premium_dark": dark cinematic ad look (near-black backgrounds, single
 *   brand accent color, rim light, film grain, bold display captions,
 *   short 15s format allowed). Inspired by AI motion-graphics ad studios.
 */
export const VISUAL_STYLE_PRESETS = ["standard", "premium_dark"] as const;
export type VisualStylePreset = (typeof VISUAL_STYLE_PRESETS)[number];

/**
 * True when the job's visualStyle selects the premium-dark cinematic
 * preset. Accepts "premium_dark", "premium-dark", "premium dark"
 * (case-insensitive). Unknown strings are NOT premium dark — they keep
 * the legacy generic prompt treatment in the storyboard.
 */
export function isPremiumDark(visualStyle: string | null | undefined): boolean {
  if (!visualStyle) return false;
  const s = visualStyle.trim().toLowerCase();
  return s === "premium_dark" || s === "premium-dark" || s === "premium dark";
}

export type PipelineErrorCode =
  | "provider_unavailable"
  | "compliance_blocked"
  | "research_missing"
  | "validation_failed"
  | "media_failed";

/**
 * Typed pipeline failure. The worker maps `stage` to the correct
 * JobStage row and `verdict` to WAITING_FOR_REVIEW vs FAILED.
 */
export class PipelineError extends Error {
  code: PipelineErrorCode;
  stage: JobStageKey;
  retryable: boolean;
  verdict?: "APPROVED" | "NEEDS_REVIEW" | "REJECTED";

  constructor(
    code: PipelineErrorCode,
    stage: JobStageKey,
    message: string,
    retryable: boolean,
    verdict?: "APPROVED" | "NEEDS_REVIEW" | "REJECTED"
  ) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
    this.verdict = verdict;
  }
}

/** Per-scene voiceover result with the real (possibly adjusted) timeline. */
export interface SceneVoiceTiming {
  sceneId: string;
  audioPath: string;
  audioProvider: string;
  plannedSec: number;
  actualSec: number;
  /** True when actual TTS audio differed from the planned duration by >15%. */
  durationAdjusted: boolean;
  startSec: number;
  endSec: number;
}

/** Per-scene visual result (still image + motion video). */
export interface SceneVisualResult {
  sceneId: string;
  imagePath: string;
  imageProvider: string;
  imageModel?: string;
  videoPath: string;
  videoProvider: string;
  /** True when the video came from the experimental Tier A path. */
  videoExperimental: boolean;
}

export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface CreativePipelineSummary {
  jobId: string;
  scriptScenes: number;
  totalSeconds: number;
  audioScenes: number;
  visualScenes: number;
  captionCues: number;
  providersUsed: string[];
  experimentalVideo: boolean;
}
