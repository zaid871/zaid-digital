/**
 * Provider registry — capability-aware routing for all hosted services.
 *
 * Phase 2: the registry shape and capability model are real; entries are
 * marked `configured: false` until their credentials are validated via
 * POST /api/v1/providers/:provider/test. No provider is ever treated as
 * available without a successful health check.
 */

export type ProviderCapability =
  | "llm"
  | "search"
  | "extraction"
  | "vision"
  | "image_generation"
  | "video_generation"
  | "tts"
  | "stt"
  | "background_removal"
  | "object_storage";

export interface ProviderDefinition {
  /** Stable registry key used in /api/v1/providers/:provider/test */
  key: string;
  name: string;
  capabilities: ProviderCapability[];
  /** Env var(s) required before the provider can be tested */
  requiredEnv: string[];
  commercialUseNotes: string;
  /** "local" providers run on the deployment host (e.g. FFmpeg), not a remote API. */
  kind: "cloud" | "local";
  /** Experimental adapters are never the default path and must be labeled as such. */
  experimental?: boolean;
  /** Runtime status — replaced by DB-backed ProviderConfig in Phase 3 */
  configured: boolean;
  lastHealthCheck: string | null;
}

export const PROVIDER_REGISTRY: ProviderDefinition[] = [
  {
    key: "openai",
    name: "OpenAI",
    capabilities: ["llm", "vision", "image_generation", "tts", "stt"],
    requiredEnv: ["OPENAI_API_KEY"],
    commercialUseNotes:
      "Check the current OpenAI terms for commercial use and data-retention policies before production use.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "anthropic",
    name: "Anthropic",
    capabilities: ["llm", "vision"],
    requiredEnv: ["ANTHROPIC_API_KEY"],
    commercialUseNotes: "Verify current Anthropic usage policy and commercial terms.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    capabilities: ["tts"],
    requiredEnv: ["ELEVENLABS_API_KEY"],
    commercialUseNotes: "Verify voice-cloning consent and commercial licensing terms.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "fal",
    name: "fal.ai",
    capabilities: ["image_generation", "video_generation"],
    requiredEnv: ["FAL_API_KEY"],
    commercialUseNotes:
      "Model licenses vary per model on fal.ai — confirm commercial-use terms per model.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "replicate",
    name: "Replicate",
    capabilities: ["image_generation", "video_generation", "stt", "background_removal"],
    requiredEnv: ["REPLICATE_API_TOKEN"],
    commercialUseNotes: "Model licenses vary per model — confirm per-model commercial terms.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "s3",
    name: "S3-compatible storage",
    capabilities: ["object_storage"],
    requiredEnv: ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"],
    commercialUseNotes: "Self-managed or provider-managed storage; no model licensing applies.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  // ---- Free-tier stack (Phase 5 adapters) ----
  {
    key: "hf",
    name: "Hugging Face Inference (free tier)",
    capabilities: ["llm", "image_generation", "tts", "stt"],
    requiredEnv: ["HF_TOKEN"],
    commercialUseNotes:
      "Model licenses vary per model on the Hub — confirm the chosen model's license (e.g. FLUX.1-schnell, MMS-TTS) allows commercial use.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "pollinations",
    name: "Pollinations.ai",
    capabilities: ["image_generation"],
    requiredEnv: [],
    commercialUseNotes:
      "Community-run free service, no key required. Best-effort: no SLA, verify current terms before production use.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "edge-tts",
    name: "Edge TTS",
    capabilities: ["tts"],
    requiredEnv: [],
    commercialUseNotes:
      "Unofficial Microsoft Edge endpoint via the edge-tts package. Verify terms for production/commercial use.",
    kind: "cloud",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "ffmpeg",
    name: "FFmpeg motion (Tier B)",
    capabilities: ["video_generation"],
    requiredEnv: [],
    commercialUseNotes: "Local rendering on the deployment host — no model licensing applies.",
    kind: "local",
    configured: false,
    lastHealthCheck: null,
  },
  {
    key: "hf-spaces-video",
    name: "HF Spaces video (Tier A)",
    capabilities: ["video_generation"],
    requiredEnv: [],
    commercialUseNotes:
      "EXPERIMENTAL: calls third-party public Gradio Spaces. No SLA; Spaces can change or disappear. Verify per-Space terms.",
    kind: "cloud",
    experimental: true,
    configured: false,
    lastHealthCheck: null,
  },
];

/** Capability-aware fallback: never routes a task to a provider lacking the capability. */
export function providersFor(capability: ProviderCapability): ProviderDefinition[] {
  return PROVIDER_REGISTRY.filter((p) => p.capabilities.includes(capability));
}

export function getProvider(key: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY.find((p) => p.key === key.toLowerCase());
}
