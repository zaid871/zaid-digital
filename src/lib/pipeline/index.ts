/** Phase 5 creative pipeline — public surface. */
export * from "./types";
export { generateScript, scriptExtras, type ScriptExtras } from "./script";
export { buildStoryboard } from "./storyboard";
export { synthesizeScenes, type VoiceOptions } from "./voice";
export { generateSceneImages, animateSceneVideos, type VisualsOptions, type SceneImage, type SceneVideo } from "./visuals";
export { buildCaptions, buildCaptionCues, type CaptionFiles, type CaptionInput } from "./captions";
export {
  runCreativePipeline,
  buildInputsFromDb,
  CREATIVE_STAGES,
} from "./creative";
export {
  renderFinalVideo,
  buildRenderInputs,
  runRenderStage,
  probeFull,
  RenderError,
  RENDER_WIDTH,
  RENDER_HEIGHT,
  RENDER_FPS,
  END_CARD_SEC,
  type RenderSceneInput,
  type RenderOptions,
  type RenderResult,
  type RenderSpecs,
} from "./render";
export {
  runQualityChecks,
  runQualityAssuranceStage,
  type QAVerdict,
  type QACheck,
  type QAResult,
  type QAInputs,
} from "./qa";
export { runDeliveryStage, DeliveryError } from "./delivery";
export {
  renderGif,
  wantsGif,
  gifDefaults,
  GifError,
  GIF_DEFAULTS,
  type RenderGifInput,
  type RenderGifResult,
} from "./gif";
export {
  ScriptObjectSchema,
  StoryboardObjectSchema,
  SceneAssetObjectSchema,
  CreativePlanObjectSchema,
  ScriptSceneSchema,
  StoryboardSceneSchema,
} from "./schemas";
