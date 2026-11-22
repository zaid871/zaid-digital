import { lookup } from "dns/promises";
import { connect } from "net";
import { execFile } from "child_process";
import { promisify } from "util";
import { success, failure, redactSecrets } from "@/lib/envelope";
import { getProvider } from "@/lib/providers";
import { db } from "@/lib/db";

/**
 * POST /api/v1/providers/:provider/test — test provider connectivity.
 *
 * What this actually checks (Phase 3):
 *  1. Are the required credential env vars present? If not → `configured:
 *     false`, `reachable: false`, with the missing vars listed.
 *  2. If credentials ARE present, can we resolve + TCP-connect to the
 *     provider's API host? Reachable → `reachable: true` but still
 *     `configured: false` ("reachable but unconfigured") until an
 *     authenticated probe validates the credentials (Phase 4).
 *
 * This endpoint NEVER claims a provider is configured without validated
 * credentials, and it never echoes credential values.
 */

const API_HOSTS: Record<string, string> = {
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  elevenlabs: "api.elevenlabs.io",
  fal: "api.fal.ai",
  replicate: "api.replicate.com",
  hf: "router.huggingface.co",
  pollinations: "image.pollinations.ai",
  "edge-tts": "speech.platform.bing.com",
  "hf-spaces-video": "huggingface.co",
};

const execFileAsync = promisify(execFile);

/** Local providers (kind === "local") are probed via their binary, not TCP. */
async function localReachable(providerKey: string): Promise<{ reachable: boolean; detail: string }> {
  if (providerKey === "ffmpeg") {
    try {
      const { stdout } = await execFileAsync("ffmpeg", ["-version"], { timeout: 10_000 });
      const ver = stdout.split("\n")[0]?.slice(0, 60) || "ffmpeg";
      return { reachable: true, detail: `Local binary OK: ${ver}` };
    } catch {
      return { reachable: false, detail: "ffmpeg binary not found on PATH." };
    }
  }
  return { reachable: false, detail: `No local probe defined for ${providerKey}.` };
}

function s3Host(): string | null {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) return null;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

async function tcpReachable(
  host: string,
  port = 443,
  timeoutMs = 6000
): Promise<{ reachable: boolean; detail: string }> {
  try {
    await lookup(host);
  } catch {
    return { reachable: false, detail: `DNS lookup failed for ${host}.` };
  }
  return new Promise((resolve) => {
    const socket = connect(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ reachable: false, detail: `TCP connect to ${host}:${port} timed out after ${timeoutMs}ms.` });
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve({ reachable: true, detail: `TCP connect to ${host}:${port} succeeded.` });
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({ reachable: false, detail: `TCP connect to ${host}:${port} failed: ${err.message}` });
    });
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const def = getProvider(provider ?? "");
  if (!def) return failure("unknown_provider", `Unknown provider: ${provider}.`, 404);

  const missingEnv = def.requiredEnv.filter((k) => !process.env[k]);
  if (missingEnv.length > 0) {
    await db.providerConfig
      .upsert({
        where: { providerKey: def.key },
        update: { displayName: def.name, capabilities: def.capabilities, configured: false, lastHealthCheck: new Date(), lastHealthStatus: "unconfigured_missing_credentials" },
        create: { providerKey: def.key, displayName: def.name, capabilities: def.capabilities, configured: false, lastHealthCheck: new Date(), lastHealthStatus: "unconfigured_missing_credentials" },
      })
      .catch((e) => console.error("[provider test] db write failed:", redactSecrets(e)));
    return success({
      provider: def.key,
      reachable: false,
      configured: false,
      missingEnv,
      message: `Missing credentials: ${missingEnv.join(", ")}. Add them to .env, then re-test. Provider is NOT configured.`,
    });
  }

  const host = def.key === "s3" ? s3Host() : API_HOSTS[def.key];
  if (!host && def.kind !== "local") {
    return success({
      provider: def.key,
      reachable: false,
      configured: false,
      missingEnv: [],
      message:
        "Credentials are present but no API host is known for this provider (S3_ENDPOINT is not a valid URL). Provider is NOT configured.",
    });
  }

  let probe: { reachable: boolean; detail: string };
  try {
    probe = def.kind === "local" ? await localReachable(def.key) : await tcpReachable(host as string);
  } catch (err) {
    console.error(`[POST /api/v1/providers/${def.key}/test] probe error:`, redactSecrets(err));
    return failure("internal_error", "Connectivity probe failed.", 500);
  }

  const healthStatus = probe.reachable ? "reachable_unconfigured" : "unreachable";
  await db.providerConfig
    .upsert({
      where: { providerKey: def.key },
      update: { displayName: def.name, capabilities: def.capabilities, configured: false, lastHealthCheck: new Date(), lastHealthStatus: healthStatus },
      create: { providerKey: def.key, displayName: def.name, capabilities: def.capabilities, configured: false, lastHealthCheck: new Date(), lastHealthStatus: healthStatus },
    })
    .catch((e) => console.error("[provider test] db write failed:", redactSecrets(e)));

  return success({
    provider: def.key,
    reachable: probe.reachable,
    configured: false,
    missingEnv: [],
    checkedHost: def.kind === "local" ? "localhost (local binary)" : host,
    detail: probe.detail,
    message: probe.reachable
      ? def.kind === "local"
        ? `Local dependency OK: ${probe.detail} Provider is available for local rendering.`
        : `Host ${host} is reachable, but credentials have not been validated yet — provider stays UNCONFIGURED. An authenticated probe lands in Phase 4.`
      : def.kind === "local"
        ? `Local dependency missing: ${probe.detail} Provider is NOT configured.`
        : `Host ${host} is unreachable: ${probe.detail} Provider is NOT configured.`,
  });
}
