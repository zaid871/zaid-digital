/**
 * Structured intermediate objects passed between pipeline stages.
 * These TypeScript interfaces are the v1 schemas; Prisma models mirror them.
 * Schema versions are explicit so jobs can evolve without breaking replays.
 */

export const SCHEMA_VERSION = "1.0.0";

export type EvidenceStatus = "verified" | "unverified" | "ai_inference";

export interface EvidenceObject {
  schemaVersion: string;
  id: string;
  claim: string;
  status: EvidenceStatus;
  sourceUrl: string | null;
  sourceTitle: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  excerpt: string | null;
}

export interface ProductResearchObject {
  schemaVersion: string;
  productName: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  description: string | null;
  specifications: Record<string, string>;
  features: string[];
  intendedUse: string | null;
  compatibility: string[];
  packageContents: string[];
  warranty: string | null;
  sourceUrls: string[];
  extractedAt: string;
}

export interface MediaAnalysisObject {
  schemaVersion: string;
  assetId: string;
  orientation: string | null;
  cameraAngle: string | null;
  visibleDetails: string[];
  background: string | null;
  lighting: string | null;
  obstructions: string[];
  embeddedClaims: string[];
  misleadingDifferences: string[];
  analyzedAt: string;
}

export interface ProductIdentityObject {
  schemaVersion: string;
  canonicalName: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  appearance: {
    shape: string | null;
    colors: string[];
    materials: string[];
    buttons: string[];
    ports: string[];
    logos: string[];
    distinctiveDetails: string[];
  };
  verifiedFeatures: string[];
  knownUncertainty: string[];
  referenceAssetIds: string[];
  visualConsistencyNotes: string;
}

export interface ComplianceReportObject {
  schemaVersion: string;
  verdict: "APPROVED" | "NEEDS_REVIEW" | "REJECTED";
  productCategory: string | null;
  checks: { name: string; passed: boolean; note: string }[];
  reviewReasons: string[];
  assessedAt: string;
}

export interface CreativePlanObject {
  schemaVersion: string;
  targetAudience: string;
  objective: string;
  hook: string;
  sellingPoints: string[];
  narrativeStructure: string;
  sceneOrder: string[];
  visualApproach: string;
  callToAction: string;
  claimsToAvoid: string[];
}

export interface ScriptScene {
  sceneId: string;
  narration: string;
  estimatedSeconds: number;
  evidenceClaimIds: string[];
  pronunciationHints: Record<string, string>;
}

export interface ScriptObject {
  schemaVersion: string;
  language: "hinglish" | "hindi" | "english";
  scenes: ScriptScene[];
  totalEstimatedSeconds: number;
  callToAction: string;
}

export interface StoryboardScene {
  sceneId: string;
  purpose: string;
  durationSeconds: number;
  narrationSegment: string;
  onScreenText: string[];
  visualPrompt: string;
  videoPrompt: string;
  cameraMovement: string;
  transition: string;
  motionGraphicsNotes: string;
  captionCues: { startSeconds: number; endSeconds: number; text: string }[];
  complianceNotes: string;
}

export interface StoryboardObject {
  schemaVersion: string;
  scenes: StoryboardScene[];
  totalDurationSeconds: number;
}

export interface SceneAssetObject {
  schemaVersion: string;
  sceneId: string;
  assetType: "image" | "video" | "audio" | "caption";
  storageKey: string;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  generatedAt: string;
  costUsd: number | null;
  contentHash: string | null;
}

export interface RenderJobObject {
  schemaVersion: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  videoCodec: string;
  audioCodec: string;
  captionFile: string | null;
  outputKey: string;
}

export interface QualityReportObject {
  schemaVersion: string;
  verdict: "PASS" | "PASS_WITH_WARNINGS" | "NEEDS_REVIEW" | "FAILED";
  technicalChecks: { name: string; passed: boolean; detail: string }[];
  contentChecks: { name: string; passed: boolean; detail: string }[];
  warnings: string[];
  actualSpecs: {
    width: number | null;
    height: number | null;
    fps: number | null;
    durationSeconds: number | null;
  };
  assessedAt: string;
}

export interface FinalVideoObject {
  schemaVersion: string;
  storageKey: string;
  downloadUrl: string | null;
  captionSrtKey: string | null;
  captionVttKey: string | null;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  renderedAt: string;
}
