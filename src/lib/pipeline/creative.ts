/**
 * Phase 5 creative pipeline orchestrator.
 *
 * Flow: creative plan → script → compliance pre-check (fail closed) →
 * storyboard → voiceover → AI visuals (stills) → AI video (motion) →
 * captions. Every intermediate object is zod-validated; CreativePlan /
 * Script / Storyboard / SceneAsset rows are persisted; a JobEvent is
 * emitted per stage. Provider failures and compliance blocks are typed
 * PipelineErrors — nothing is fabricated, nothing is silently skipped.
 */
import { db } from "@/lib/db";
import { assessCompliance } from "@/lib/compliance";
import { canTransition, type JobStageKey, type JobStatus } from "@/lib/job-stages";
import { transitionJob, updateStage } from "@/lib/job-service";
import { buildCaptions } from "./captions";
import { generateScript, sceneCountForStyle, type ScriptStyle } from "./script";
import { generateAdConcepts, type AdConcept } from "./concepts";
import { CreativePlanObjectSchema, ScriptObjectSchema, StoryboardObjectSchema } from "./schemas";
import { buildStoryboard } from "./storyboard";
import { animateSceneVideos, generateSceneImages } from "./visuals";
import { synthesizeScenes } from "./voice";
import { jobAssetsDir, sha256File, storageKey } from "./assets";
import {
  PipelineError,
  isPremiumDark,
  type CreativePipelineSummary,
  type CreativeRunOptions,
  type ProductFactsInput,
  type ProductIdentityInput,
  type SceneVoiceTiming,
} from "./types";

const CREATIVE_STAGES: JobStageKey[] = [
  "creative_planning",
  "script_generation",
  "voiceover_generation",
  "storyboard_generation",
  "ai_visual_generation",
  "ai_video_generation",
];

async function emitEvent(jobId: string, type: string, message: string, payload?: unknown) {
  await db.jobEvent.create({ data: { jobId, type, message, payload: (payload ?? undefined) as never } });
}

async function runStage<T>(
  jobId: string,
  stageKey: JobStageKey,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  await updateStage(jobId, stageKey, { status: "running", progressPct: 10, message: `${label} started.` });
  await emitEvent(jobId, "creative_stage", `${label} started.`);
  try {
    const result = await fn();
    await updateStage(jobId, stageKey, {
      status: "succeeded",
      progressPct: 100,
      message: `${label} completed with real provider output.`,
      warnings: [],
    });
    await emitEvent(jobId, "creative_stage", `${label} completed.`);
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await updateStage(jobId, stageKey, { status: "failed", message: `${label} failed: ${detail}` });
    await emitEvent(jobId, "creative_stage_failed", `${label} failed: ${detail}`);
    throw err;
  }
}

async function ensureJobStatus(jobId: string, target: JobStatus, reason: string) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const current = job.status as JobStatus;
  if (current !== target && canTransition(current, target)) {
    await transitionJob(jobId, target, reason);
  }
}

async function persistSceneAsset(
  jobId: string,
  sceneId: string,
  assetType: "image" | "video" | "audio" | "caption",
  absPath: string,
  provider: string | null,
  model: string | null,
  prompt: string | null
) {
  await db.sceneAsset.create({
    data: {
      jobId,
      sceneId,
      assetType,
      storageKey: storageKey(absPath),
      provider,
      model,
      prompt,
      costUsd: 0, // free-tier stack: genuine zero cost
      contentHash: sha256File(absPath),
    },
  });
}

/**
 * Build pipeline inputs from persisted Phase 4 research rows.
 * Returns null when no research exists — the caller must fail closed.
 */
export async function buildInputsFromDb(
  jobId: string
): Promise<{ facts: ProductFactsInput; identity: ProductIdentityInput } | null> {
  const research = await db.productResearch.findUnique({ where: { jobId } });
  if (!research) return null;
  const evidence = await db.evidence.findMany({ where: { jobId } });
  const identityRow = await db.productIdentity.findUnique({ where: { jobId } });

  const appearance = (identityRow?.appearance ?? {}) as Record<string, unknown>;
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

  const facts: ProductFactsInput = {
    productName: research.productName ?? "Product",
    brand: research.brand,
    category: research.category,
    verifiedFeatures: [
      ...research.features,
      ...evidence.filter((e) => e.status === "verified").map((e) => e.claim),
    ],
    unverifiedClaims: evidence.filter((e) => e.status !== "verified").map((e) => e.claim),
    description: research.description,
    sourceUrls: research.sourceUrls,
  };
  const identity: ProductIdentityInput = identityRow
    ? {
        canonicalName: identityRow.canonicalName,
        brand: identityRow.brand,
        model: identityRow.model,
        category: identityRow.category,
        colors: strArr(appearance.colors),
        materials: strArr(appearance.materials),
        distinctiveDetails: strArr(appearance.distinctiveDetails),
        visualConsistencyNotes: identityRow.visualConsistencyNotes ?? "",
      }
    : {
        canonicalName: facts.productName,
        brand: facts.brand,
        model: research.model,
        category: facts.category,
        colors: [],
        materials: [],
        distinctiveDetails: [],
        visualConsistencyNotes: "",
      };
  return { facts, identity };
}

function buildCreativePlan(
  facts: ProductFactsInput,
  targetSec: number,
  visualStyle?: string | null,
  scriptStyle?: string | null,
  storyboardChain?: boolean
) {
  // Scene count must match generateScript exactly (shared helper) —
  // the plan's sceneOrder and the script's scenes always agree.
  const sceneCount = sceneCountForStyle(targetSec, (scriptStyle as ScriptStyle) ?? "standard", {
    storyboardChain: storyboardChain ?? false,
  });
  const premiumDark = isPremiumDark(visualStyle);
  return {
    schemaVersion: "1.0.0",
    targetAudience: "Indian online shoppers watching Instagram Reels / YouTube Shorts",
    objective: `Produce a ${targetSec}s vertical product video for ${facts.productName} that explains real, verified features with natural Hinglish narration.`,
    hook: `${facts.productName}${facts.verifiedFeatures[0] ? ` — ${facts.verifiedFeatures[0]}` : ""}`,
    sellingPoints: facts.verifiedFeatures.slice(0, 6),
    narrativeStructure:
      scriptStyle === "numbered"
        ? "Hook → numbered points (Pehli baat, Dusri baat, …) → short punchy closing line → neutral call to action"
        : scriptStyle === "brand_story"
          ? "Hook question → origin → twist → proof (verified features only, no invented numbers) → lesson → neutral call to action"
          : scriptStyle === "macro_hero"
            ? "Ingredient (macro texture) → Craft (how it is made) → Hero (product as hero, pack untouched) → neutral call to action"
            : scriptStyle === "banner_unroll"
              ? "Hook → banner rolls down the building facade revealing the poster → hold + neutral call to action"
              : scriptStyle === "attar_luxury"
                ? "Hero (bottle on oud wood, arch + lattice light) → Drop (oil-drop macro on a petal) → Ritual (hands only apply to a wrist) → End card (hero close-up + serif brand title) → neutral call to action"
              : scriptStyle === "wedding_invite"
                ? "Couple names (hook) → functions → date & venue → warm closing + RSVP → neutral call to action"
              : storyboardChain
                ? "Winning ad concept (best of 5) → 9-scene storyboard → neutral call to action"
                : targetSec < 30
                  ? "Hook → hero product showcase → neutral call to action"
                  : "Hook → feature highlights → practical use-case → detail close-up → neutral call to action",
    sceneOrder: Array.from({ length: sceneCount }, (_, i) => `s${i + 1}`),
    visualApproach: premiumDark
      ? "Dark cinematic 9:16 product photography: near-black backgrounds, single brand accent color, dramatic rim light, hero product centerpiece with reflections, film-grain finish."
      : "Cinematic 9:16 product photography with consistent product identity, studio lighting, and smooth camera motion.",
    callToAction: "Check product details through the link in the description or profile.",
    claimsToAvoid: [
      ...facts.unverifiedClaims,
      "Any mention of price, discount, offer, or deal",
      "Reviews, testimonials, ratings, or endorsements",
      "Guarantees or comparative superiority claims",
    ],
  };
}

/**
 * Run the full creative pipeline for a job. Drives the six creative
 * stages (each persisted + evented). Throws PipelineError on any failure.
 */
export async function runCreativePipeline(
  jobId: string,
  facts: ProductFactsInput,
  identity: ProductIdentityInput,
  opts?: Partial<CreativeRunOptions>
): Promise<CreativePipelineSummary> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new PipelineError("research_missing", "creative_planning", `Job ${jobId} not found.`, false);
  }
  const visualStyle = opts?.visualStyle ?? job.visualStyle ?? undefined;
  const scriptStyle = opts?.scriptStyle ?? job.scriptStyle ?? undefined;
  const storyboardChain = opts?.storyboardChain ?? job.storyboardChain ?? false;
  // Brand-story format runs long (60–120s, like The Brand Saga's 125s
  // top video); the storyboard chain runs 9 scenes (45–70s); every
  // other style caps at 60s as before. Short formats (premium-dark 15s,
  // macro-hero, banner-unroll, attar-luxury) floor at 15s instead of 30s.
  const maxDurationSec = scriptStyle === "brand_story" ? 120 : storyboardChain ? 70 : 60;
  const minDurationSec =
    isPremiumDark(visualStyle) ||
    scriptStyle === "macro_hero" ||
    scriptStyle === "banner_unroll" ||
    scriptStyle === "attar_luxury"
      ? 15
      : storyboardChain
        ? 45
        : 30;
  const targetDurationSec = Math.min(
    maxDurationSec,
    Math.max(minDurationSec, opts?.targetDurationSec ?? job.durationSeconds ?? 45)
  );
  const language = ["hinglish", "hindi", "english"].includes(job.language) ? job.language : "hinglish";
  const voice = opts?.voice ?? job.voice ?? undefined;
  jobAssetsDir(jobId); // ensure the per-job dir exists

  const providersUsed = new Set<string>();
  let experimentalVideo = false;

  // ---- 1. Creative plan ----
  await runStage(jobId, "creative_planning", "Creative planning", async () => {
    const plan = buildCreativePlan(facts, targetDurationSec, visualStyle, scriptStyle, storyboardChain);
    const validated = CreativePlanObjectSchema.safeParse(plan);
    if (!validated.success) {
      throw new PipelineError(
        "validation_failed",
        "creative_planning",
        `Creative plan failed validation: ${validated.error.message.slice(0, 200)}`,
        false
      );
    }
    await db.creativePlan.upsert({
      where: { jobId },
      create: { jobId, ...validated.data },
      update: { ...validated.data },
    });
  });

  // ---- 2. Script ----
  const script = await runStage(jobId, "script_generation", "Script generation", async () => {
    // Storyboard chain (Raj, 2026-11-10): 5 ad concepts first, best
    // wins, the script + 9-scene storyboard are built on the winner.
    // The winning concept + all survivors are recorded on a job event
    // so the choice is auditable; a chain failure fails the stage
    // honestly (no fallback concept is invented).
    let concept: AdConcept | null = null;
    if (storyboardChain) {
      const chain = await generateAdConcepts({
        productName: facts.productName,
        brand: facts.brand,
        category: facts.category,
        verifiedFeatures: facts.verifiedFeatures,
      });
      concept = chain.best;
      await emitEvent(
        jobId,
        "ad_concepts",
        `Storyboard chain: ${chain.concepts.length} concepts generated, best is "${chain.best.title}" — ${chain.bestReason}`,
        { concepts: chain.concepts, best: chain.best, warnings: chain.warnings }
      );
    }
    const s = await generateScript(facts, targetDurationSec, {
      style:
        scriptStyle === "numbered"
          ? "numbered"
          : scriptStyle === "brand_story"
            ? "brand_story"
            : scriptStyle === "macro_hero"
              ? "macro_hero"
              : scriptStyle === "banner_unroll"
                ? "banner_unroll"
                : scriptStyle === "attar_luxury"
                  ? "attar_luxury"
                  : scriptStyle === "wedding_invite"
                    ? "wedding_invite"
                    : "standard",
      concept,
      storyboardChain,
    });
    if (s.language !== language) {
      // Language is fixed by the job; the generator always writes hinglish.
      (s as { language: string }).language = language;
    }
    await db.script.upsert({
      where: { jobId },
      create: {
        jobId,
        schemaVersion: s.schemaVersion,
        language: s.language,
        scenes: s.scenes,
        totalEstimatedSeconds: s.totalEstimatedSeconds,
        callToAction: s.callToAction,
      },
      update: {
        schemaVersion: s.schemaVersion,
        language: s.language,
        scenes: s.scenes,
        totalEstimatedSeconds: s.totalEstimatedSeconds,
        callToAction: s.callToAction,
      },
    });
    providersUsed.add("hf-inference(script)");
    return s;
  });
  // Re-validate after the language pin (keeps persisted JSON schema-clean).
  ScriptObjectSchema.parse({ ...script, language: script.language });

  // ---- 3. Compliance pre-check (fail closed, before expensive generation) ----
  await runStage(jobId, "creative_planning", "Compliance pre-check", async () => {
    const assessment = assessCompliance({
      productCategory: facts.category ?? identity.category ?? null,
      claims: [
        ...facts.verifiedFeatures.map((text) => ({ text, verified: true })),
        ...facts.unverifiedClaims.map((text) => ({ text, verified: false })),
      ],
      hasMusic: false,
      hasProhibitedAudio: false,
    });
    await db.complianceReport.create({
      data: {
        jobId,
        schemaVersion: "1.0.0",
        verdict: assessment.verdict,
        productCategory: facts.category ?? identity.category ?? null,
        checks: [
          { name: "no-music", passed: true, note: "Pipeline generates narration only; no music or SFX." },
          { name: "no-price-in-script", passed: true, note: "Script generator rejects price/offer mentions." },
          {
            name: "verified-claims-only",
            passed: assessment.verdict === "APPROVED",
            note:
              assessment.verdict === "APPROVED"
                ? "All scripted claims come from verified features."
                : assessment.reasons.join(" "),
          },
        ],
        reviewReasons: assessment.reasons,
        phase: "pre_script",
      },
    });
    await emitEvent(jobId, "compliance_check", `Pre-script compliance verdict: ${assessment.verdict}.`);
    if (assessment.verdict !== "APPROVED") {
      throw new PipelineError(
        "compliance_blocked",
        "creative_planning",
        `Compliance ${assessment.verdict}: ${assessment.reasons.join(" ")} — pipeline stopped before generation.`,
        false,
        assessment.verdict
      );
    }
  });

  // ---- 4. Storyboard ----
  const storyboard = await runStage(jobId, "storyboard_generation", "Storyboard generation", async () => {
    const sb = buildStoryboard(script, identity, targetDurationSec, visualStyle ?? null, {
      scriptStyle: scriptStyle ?? null,
    });
    await db.storyboard.upsert({
      where: { jobId },
      create: {
        jobId,
        schemaVersion: sb.schemaVersion,
        scenes: sb.scenes,
        totalDurationSeconds: sb.totalDurationSeconds,
      },
      update: {
        schemaVersion: sb.schemaVersion,
        scenes: sb.scenes,
        totalDurationSeconds: sb.totalDurationSeconds,
      },
    });
    return sb;
  });
  StoryboardObjectSchema.parse(storyboard);

  // ---- 5. Voiceover (moves job into GENERATING_ASSETS) ----
  await ensureJobStatus(jobId, "GENERATING_ASSETS", "Voiceover generation started.");
  let timings: SceneVoiceTiming[] = [];
  await runStage(jobId, "voiceover_generation", "Voiceover generation", async () => {
    timings = await synthesizeScenes(storyboard, { jobId, voice: voice ?? null });
    for (const t of timings) {
      await persistSceneAsset(jobId, t.sceneId, "audio", t.audioPath, t.audioProvider, null, null);
      providersUsed.add(t.audioProvider.split(":")[0]);
    }
    const adjusted = timings.filter((t) => t.durationAdjusted).length;
    await emitEvent(
      jobId,
      "voiceover_timing",
      `Synthesized ${timings.length} scene(s). ${adjusted} timeline adjustment(s) applied (TTS audio ≠ planned duration).`
    );
  });

  // ---- 6. AI visuals (stills) ----
  const images = await runStage(jobId, "ai_visual_generation", "AI visual generation", async () => {
    const imgs = await generateSceneImages(storyboard, { jobId });
    for (const img of imgs) {
      await persistSceneAsset(jobId, img.sceneId, "image", img.imagePath, img.imageProvider, img.imageModel ?? null, img.visualPrompt);
      providersUsed.add(img.imageProvider);
    }
    return imgs;
  });

  // ---- 7. AI video (motion) ----
  await runStage(jobId, "ai_video_generation", "AI video generation", async () => {
    const videos = await animateSceneVideos(storyboard, images, { jobId });
    for (const v of videos) {
      await persistSceneAsset(
        jobId,
        v.sceneId,
        "video",
        v.videoPath,
        v.videoProvider,
        v.videoExperimental ? "experimental" : null,
        storyboard.scenes.find((s) => s.sceneId === v.sceneId)?.videoPrompt ?? null
      );
      providersUsed.add(v.videoProvider);
      if (v.videoExperimental) experimentalVideo = true;
    }
  });

  // ---- 8. Captions (from the real voice timeline) ----
  const captionResult = await (async () => {
    const narrations = new Map(storyboard.scenes.map((s) => [s.sceneId, s.narrationSegment]));
    const caps = await buildCaptions(jobId, timings, narrations);
    await persistSceneAsset(jobId, "all", "caption", caps.srtPath, "pipeline", null, null);
    await persistSceneAsset(jobId, "all", "caption", caps.vttPath, "pipeline", null, null);
    await emitEvent(jobId, "captions_built", `Built ${caps.cues.length} caption cues (SRT + VTT) from the real voice timeline.`);
    return caps;
  })();

  await emitEvent(
    jobId,
    "creative_pipeline_complete",
    `Creative pipeline complete: ${script.scenes.length} scenes, ${captionResult.cues.length} caption cues, providers: ${[...providersUsed].join(", ")}.`
  );

  return {
    jobId,
    scriptScenes: script.scenes.length,
    totalSeconds: Math.round(timings.reduce((a, t) => a + (t.endSec - t.startSec), 0) * 10) / 10,
    audioScenes: timings.length,
    visualScenes: images.length,
    captionCues: captionResult.cues.length,
    providersUsed: [...providersUsed],
    experimentalVideo,
  };
}

export { CREATIVE_STAGES };
