/**
 * Capability-aware provider router for the free-tier stack.
 *
 * The router NEVER sends a task to a provider that lacks the capability,
 * and NEVER claims a provider is usable without its prerequisites:
 *  - configured:   credentials present (or none required) AND dependency OK
 *  - unconfigured: missing env / missing dependency / explicitly disabled
 *  - rate_limited: observed 429s recently (in-memory, best-effort signal)
 *  - circuit_open:  3 consecutive failures in 30 min → skipped for 1 hour
 *
 * Task → provider preference order (HF no longer free for free accounts —
 * 2026-10-21, so billed HF legs sit LAST in every chain and fail fast with
 * `billing` unless the user adds credits/PRO):
 *  - script (llm):  groq → gemini → pollinations (text) → hf (last)
 *  - image:          pollinations (flux) → pollinations-turbo (model variant) →
 *                    hf (FLUX.1-schnell) → hf-sdxl (model variant, last free-ish)
 *  - tts:            edge-tts → hf → pollinations-tts → espeak (local, last resort)
 *  - video:          pool — hf-spaces-video (one entry per Space in
 *                    HF_SPACES_VIDEO_POOL, experimental, gated) →
 *                    pollinations-video (one entry per model in
 *                    POLLINATIONS_VIDEO_MODELS, experimental) →
 *                    remotion code-motion (gated, quota-free, on-VM) →
 *                    ffmpeg (always last)
 *
 * Variant entries (pollinations-turbo, hf-sdxl, pollinations-tts) are separate
 * chain links so the failover runner reports each attempt honestly; they share
 * the underlying adapter with a different model/endpoint.
 *
 * Failure handling: each attempt is recorded with the circuit breaker
 * (recordProviderSuccess / recordProviderFailure). Three consecutive
 * failures inside 30 minutes open the provider's circuit for 1 hour, so a
 * dead provider is skipped instead of retried on every scene. Use
 * attemptWithFallback() (./fallback) so stages fail over to the next
 * provider instead of throwing on the first one's failure.
 */
import * as edgeTts from "./edge-tts";
import * as espeakTts from "./espeak-tts";
import * as ffmpegMotion from "./ffmpeg-motion";
import * as gemini from "./gemini";
import * as groq from "./groq";
import * as hfInference from "./hf-inference";
import * as hfSpacesVideo from "./hf-spaces-video";
import * as pollinations from "./pollinations";
import * as pollinationsVideo from "./pollinations-video";
import * as remotionMotion from "./remotion-motion";

export type TaskType = "script" | "image" | "tts" | "video";

export type ProviderStatus = "configured" | "unconfigured" | "rate_limited" | "experimental" | "circuit_open";

export interface ProviderStatusEntry {
  key: string;
  name: string;
  capabilities: TaskType[];
  status: ProviderStatus;
  detail: string;
  experimental?: boolean;
}

/** In-memory 429 signal: provider key → timestamp of last rate-limit observation. */
const rateLimitedAt = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export function markRateLimited(providerKey: string): void {
  rateLimitedAt.set(providerKey, Date.now());
}

function isRateLimited(providerKey: string): boolean {
  const ts = rateLimitedAt.get(providerKey);
  return ts !== undefined && Date.now() - ts < RATE_LIMIT_WINDOW_MS;
}

/**
 * Circuit breaker: per-provider consecutive failure timestamps (pruned to a
 * rolling window) plus the time until which the circuit stays open.
 *
 * Policy: 3 consecutive failures within 30 minutes → circuit opens for 1 hour.
 * A success resets the failure count immediately. This is the mechanism that
 * turns "provider is down" into "stop hammering it and use the next one".
 */
const CIRCUIT_FAILURE_WINDOW_MS = 30 * 60 * 1000;
const CIRCUIT_TRIP_COUNT = 3;
const CIRCUIT_OPEN_MS = 60 * 60 * 1000;

const failureTimestamps = new Map<string, number[]>();
const circuitOpenUntil = new Map<string, number>();

/** Record a successful provider call: clears consecutive-failure state. */
export function recordProviderSuccess(providerKey: string): void {
  failureTimestamps.delete(providerKey);
}

/** Record a failed provider call; trips the circuit when the threshold is hit. */
export function recordProviderFailure(providerKey: string): void {
  const now = Date.now();
  const recent = (failureTimestamps.get(providerKey) ?? []).filter(
    (ts) => now - ts < CIRCUIT_FAILURE_WINDOW_MS
  );
  recent.push(now);
  failureTimestamps.set(providerKey, recent);
  if (recent.length >= CIRCUIT_TRIP_COUNT) {
    circuitOpenUntil.set(providerKey, now + CIRCUIT_OPEN_MS);
  }
}

/** True while this provider's circuit is open (failures are being skipped, not retried). */
export function isCircuitOpen(providerKey: string): boolean {
  const until = circuitOpenUntil.get(providerKey);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    circuitOpenUntil.delete(providerKey);
    return false;
  }
  return true;
}

/** Manually close a provider's circuit (tests / admin recovery). */
export function resetProviderCircuit(providerKey: string): void {
  circuitOpenUntil.delete(providerKey);
  failureTimestamps.delete(providerKey);
}

const PROVIDERS: Array<{
  key: string;
  name: string;
  capabilities: TaskType[];
  configured: () => boolean;
  experimental?: boolean;
  detail: () => string;
}> = [
  {
    key: hfInference.PROVIDER_KEY,
    name: "Hugging Face Inference Providers (billed on free accounts)",
    capabilities: ["script", "image", "tts"],
    configured: hfInference.isConfigured,
    detail: () =>
      hfInference.isConfigured()
        ? "HF_TOKEN present. Free HF accounts get NO included credits (HF docs, verified 2026-10-21) — this leg fails fast with `billing` and falls through unless credits/PRO are added."
        : "Missing HF_TOKEN — and a token alone isn't enough on a free account: Inference Providers needs credits or PRO.",
  },
  {
    key: pollinations.PROVIDER_KEY,
    name: "Pollinations.ai",
    capabilities: ["image", "script"],
    configured: pollinations.isConfigured,
    detail: () => "No key required. Best-effort community service; failures are normal.",
  },
  {
    key: "pollinations-turbo",
    name: "Pollinations.ai (turbo model variant)",
    capabilities: ["image"],
    configured: pollinations.isConfigured,
    detail: () => "Same free endpoint, faster turbo model. Separate chain link for honest failover reporting.",
  },
  {
    key: "hf-sdxl",
    name: "Hugging Face Inference (SDXL variant)",
    capabilities: ["image"],
    configured: hfInference.isConfigured,
    detail: () =>
      hfInference.isConfigured()
        ? "HF_TOKEN present. SDXL image model as the last image fallback (billed like other HF legs on a free account)."
        : "Missing HF_TOKEN — and a token alone isn't enough on a free account: Inference Providers needs credits or PRO.",
  },
  {
    key: groq.PROVIDER_KEY,
    name: "Groq (free tier)",
    capabilities: ["script"],
    configured: groq.isConfigured,
    detail: () =>
      groq.isConfigured()
        ? `GROQ_API_KEY present. Free tier ≈30 RPM / 1K req/day. Model: ${groq.defaultModel()}.`
        : "Missing GROQ_API_KEY — create a free key at console.groq.com to enable.",
  },
  {
    key: gemini.PROVIDER_KEY,
    name: "Google Gemini (free tier)",
    capabilities: ["script"],
    configured: gemini.isConfigured,
    detail: () =>
      gemini.isConfigured()
        ? `GEMINI_API_KEY present. Free tier Flash models. Model: ${gemini.defaultModel()}.`
        : "Missing GEMINI_API_KEY — create a free key in Google AI Studio to enable.",
  },
  {
    key: "pollinations-tts",
    name: "Pollinations.ai TTS",
    capabilities: ["tts"],
    configured: pollinations.isConfigured,
    detail: () => "No key required. Best-effort community TTS; commercial terms unverified.",
  },
  {
    key: edgeTts.PROVIDER_KEY,
    name: "Edge TTS",
    capabilities: ["tts"],
    configured: edgeTts.isConfigured,
    detail: () =>
      edgeTts.isConfigured()
        ? `edge-tts package installed. Default voice: ${edgeTts.defaultVoice()}.`
        : "edge-tts npm package not installed — run `npm install edge-tts`.",
  },
  {
    key: espeakTts.PROVIDER_KEY,
    name: "espeak-ng (local, last resort)",
    capabilities: ["tts"],
    configured: espeakTts.isConfigured,
    detail: () =>
      espeakTts.isConfigured()
        ? "Local espeak binary found. Robotic quality — last-resort fallback only."
        : "espeak binary not found — `sudo apt install espeak-ng` on the host/VM to enable the last-resort TTS fallback.",
  },
  {
    key: ffmpegMotion.PROVIDER_KEY,
    name: "FFmpeg motion (Tier B)",
    capabilities: ["video"],
    configured: () => true, // verified per-call via `ffmpeg -version`
    detail: () => "Local FFmpeg. Always available as the reliable video fallback; checked per call.",
  },
  {
    key: hfSpacesVideo.PROVIDER_KEY,
    name: "HF Spaces video (Tier A)",
    capabilities: ["video"],
    configured: hfSpacesVideo.isConfigured,
    experimental: true,
    detail: () =>
      hfSpacesVideo.isConfigured()
        ? "Enabled via HF_SPACES_VIDEO_ENABLED=true. Pool: HF_SPACES_VIDEO_POOL (comma-separated Space ids). Experimental: queues, Spaces can vanish."
        : "Disabled. Set HF_SPACES_VIDEO_ENABLED=true to try the experimental path.",
  },
  {
    key: remotionMotion.PROVIDER_KEY,
    name: "Remotion code-motion (Tier C)",
    capabilities: ["video"],
    configured: remotionMotion.isConfigured,
    detail: () =>
      remotionMotion.isConfigured()
        ? "Enabled via REMOTION_ENABLED=true. Deterministic Ken Burns + title card, rendered on-VM; no quota."
        : "Disabled. Set REMOTION_ENABLED=true (needs remotion deps + a Chrome binary) to use the code-motion tier.",
  },
  {
    key: pollinationsVideo.PROVIDER_KEY,
    name: "Pollinations.ai video (experimental)",
    capabilities: ["video"],
    configured: pollinationsVideo.isConfigured,
    experimental: true,
    detail: () => "No key required. Short MP4 clips, best-effort; falls through to FFmpeg on failure.",
  },
];

/** Preference order per task type. Never includes a provider lacking the capability.
 * 2026-10-21: Hugging Face legs moved last — free HF accounts get NO included
 * Inference Providers credits (verified on huggingface.co/docs), so on a free
 * account those legs fail fast with `billing` and the chain falls through.
 * All chains keep 4 links (user requirement); genuinely-free providers lead. */
const PREFERENCE: Record<TaskType, string[]> = {
  script: ["groq", "gemini", "pollinations", "hf"],
  image: ["pollinations", "pollinations-turbo", "hf", "hf-sdxl"],
  tts: ["edge-tts", "hf", "pollinations-tts", "espeak"],
  video: ["hf-spaces-video", "pollinations-video", "remotion", "ffmpeg"],
};

export function getProviderStatus(): ProviderStatusEntry[] {
  return PROVIDERS.map((p) => {
    let status: ProviderStatus;
    if (!p.configured()) status = "unconfigured";
    else if (isCircuitOpen(p.key)) status = "circuit_open";
    else if (isRateLimited(p.key)) status = "rate_limited";
    else if (p.experimental) status = "experimental";
    else status = "configured";
    return {
      key: p.key,
      name: p.name,
      capabilities: p.capabilities,
      status,
      detail: p.detail(),
      experimental: p.experimental,
    };
  });
}

/**
 * Ordered list of USABLE providers for a task: PREFERENCE order filtered to
 * providers that (a) declare the capability and (b) are currently configured,
 * not rate-limited, and not circuit-broken. Returns [] when nothing can serve
 * the task — callers must surface that honestly instead of faking output.
 */
export function providersForTask(task: TaskType): ProviderStatusEntry[] {
  const order = PREFERENCE[task];
  return getProviderStatus()
    .filter(
      (p) =>
        order.includes(p.key) &&
        (p.status === "configured" || p.status === "experimental")
    )
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** First usable provider for a task, or null when none is available. */
export function pickProvider(task: TaskType): ProviderStatusEntry | null {
  return providersForTask(task)[0] ?? null;
}
