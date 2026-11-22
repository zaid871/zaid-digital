/**
 * Video provider POOL — spreads AI-video load across endpoints so no single
 * free endpoint gets hammered (and flagged).
 *
 * Why a pool instead of a fixed chain: free video endpoints (HF ZeroGPU
 * Spaces, Pollinations) have per-account daily quotas and fair-use limits.
 * A fixed chain burns one endpoint until it 429s, then moves on — the pool
 * rotates (least-recently-used) with per-endpoint cooldowns, so load is
 * spread from the start. Nothing here multiplies quota: the daily ZeroGPU
 * budget is tracked in a ledger and the pool stops offering Spaces endpoints
 * when it is spent (fail-safe: we may UNDER-use quota, never over).
 *
 * Endpoint kinds:
 *  - spaces:       HF ZeroGPU Gradio Space (own or public), image-to-video.
 *  - pollinations: Pollinations.ai video model (wan, ltx-2, ...).
 *  - remotion:     code-based motion graphics rendered on our own VM
 *                  (no quota — only local CPU). See ./remotion-motion.
 *  - ffmpeg:       always-available local fallback, always last.
 *
 * Configuration (env):
 *  - HF_SPACES_VIDEO_ENABLED=true   master gate for ALL spaces endpoints
 *  - HF_SPACES_VIDEO_POOL           comma-separated Space ids, e.g.
 *                                   "myuser/my-wan21-space,myuser/my-ltx-space"
 *                                   Falls back to HF_SPACE_ID (single) for
 *                                   backward compatibility.
 *  - POLLINATIONS_VIDEO_MODELS      comma-separated, default "ltx-2".
 *                                   (POLLINATIONS_VIDEO_MODEL still works as
 *                                   a single-model fallback.)
 *  - REMOTION_ENABLED=true          enables the remotion code-motion tier.
 *  - VIDEO_POOL_COOLDOWN_SEC        per-endpoint rest after a use (default 300).
 *  - VIDEO_POOL_FAIL_BACKOFF_MIN    backoff after 3 consecutive failures
 *                                   (default 30).
 *  - VIDEO_POOL_MAX_FAILS           consecutive failures before backoff
 *                                   (default 3).
 *  - ZERO_GPU_DAILY_MINUTES         daily ZeroGPU budget, free = 5 (default 5).
 *  - VIDEO_POOL_LEDGER_PATH         quota ledger file
 *                                   (default storage/video-pool/ledger.json).
 *
 * Honesty notes:
 *  - GPU minutes are ESTIMATED from wall-clock time of the bridge call.
 *    Hugging Face is the source of truth; the ledger exists to keep us
 *    safely under quota, not to account precisely.
 *  - A Space that 429s / queues / vanishes is recorded as a failure with
 *    backoff — the pool never retries a dead endpoint in a tight loop.
 *  - This module is worker-side. It never throws for pool-state reasons;
 *    selection helpers are pure and unit-tested.
 */

export type PoolEndpointKind = "spaces" | "pollinations" | "remotion" | "ffmpeg";

export interface PoolEndpoint {
  kind: PoolEndpointKind;
  /** Stable key used for cooldown / failure / LRU bookkeeping. */
  key: string;
  /** Human label for logs and stage notes. */
  label: string;
  /** For spaces: the Gradio Space id. For pollinations: the model id. */
  ref: string;
}

export interface PoolLedger {
  /** Epoch ms of the first GPU use in the current window. */
  windowStart: number;
  /** Estimated GPU minutes consumed in the current window. */
  minutesUsed: number;
}

const DEFAULT_COOLDOWN_SEC = 300;
const DEFAULT_FAIL_BACKOFF_MIN = 30;
const DEFAULT_MAX_FAILS = 3;
const DEFAULT_ZERO_GPU_DAILY_MINUTES = 5;

function numEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/** Split a comma-separated env var into trimmed non-empty entries. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Spaces pool: HF_SPACES_VIDEO_POOL, falling back to the legacy single
 * HF_SPACE_ID. Empty when the master gate is off.
 */
export function spacesPoolEntries(): string[] {
  if (process.env.HF_SPACES_VIDEO_ENABLED !== "true") return [];
  const pool = parseList(process.env.HF_SPACES_VIDEO_POOL);
  if (pool.length > 0) return pool;
  const single = (process.env.HF_SPACE_ID || "").trim();
  return single ? [single] : [];
}

/** Pollinations video models to rotate: list env, else single env, else ltx-2. */
export function pollinationsModelEntries(): string[] {
  const list = parseList(process.env.POLLINATIONS_VIDEO_MODELS);
  if (list.length > 0) return list;
  const single = (process.env.POLLINATIONS_VIDEO_MODEL || "").trim();
  return [single || "ltx-2"];
}

export function remotionEnabled(): boolean {
  return process.env.REMOTION_ENABLED === "true";
}

/** Build the full endpoint pool from env. Order = configured preference. */
export function buildVideoPool(): PoolEndpoint[] {
  const pool: PoolEndpoint[] = [];
  for (const spaceId of spacesPoolEntries()) {
    pool.push({
      kind: "spaces",
      key: `spaces:${spaceId}`,
      label: `HF Space ${spaceId}`,
      ref: spaceId,
    });
  }
  for (const model of pollinationsModelEntries()) {
    pool.push({
      kind: "pollinations",
      key: `pollinations:${model}`,
      label: `Pollinations ${model}`,
      ref: model,
    });
  }
  if (remotionEnabled()) {
    pool.push({ kind: "remotion", key: "remotion", label: "Remotion code-motion", ref: "remotion" });
  }
  pool.push({ kind: "ffmpeg", key: "ffmpeg", label: "FFmpeg motion", ref: "ffmpeg" });
  return pool;
}

/** Mutable per-endpoint runtime state. Kept in a class so tests get isolation. */
export class VideoPoolState {
  private lastUsedAt = new Map<string, number>();
  private consecFails = new Map<string, number>();
  private backoffUntil = new Map<string, number>();
  private ledger: PoolLedger;
  private ledgerPath: string;
  private ledgerLoaded = false;

  constructor(ledgerPath?: string) {
    this.ledgerPath = ledgerPath || defaultLedgerPath();
    this.ledger = { windowStart: 0, minutesUsed: 0 };
  }

  private cooldownMs(): number {
    return numEnv("VIDEO_POOL_COOLDOWN_SEC", DEFAULT_COOLDOWN_SEC) * 1000;
  }
  private backoffMs(): number {
    return numEnv("VIDEO_POOL_FAIL_BACKOFF_MIN", DEFAULT_FAIL_BACKOFF_MIN) * 60 * 1000;
  }
  private maxFails(): number {
    return Math.max(1, Math.floor(numEnv("VIDEO_POOL_MAX_FAILS", DEFAULT_MAX_FAILS)));
  }
  private dailyBudgetMin(): number {
    return numEnv("ZERO_GPU_DAILY_MINUTES", DEFAULT_ZERO_GPU_DAILY_MINUTES);
  }

  // ---- ZeroGPU quota ledger (persisted) ----

  private loadLedger(): void {
    if (this.ledgerLoaded) return;
    this.ledgerLoaded = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      if (!fs.existsSync(this.ledgerPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.ledgerPath, "utf8")) as Partial<PoolLedger>;
      if (typeof raw.windowStart === "number" && typeof raw.minutesUsed === "number") {
        this.ledger = { windowStart: raw.windowStart, minutesUsed: raw.minutesUsed };
      }
    } catch {
      // Corrupt/missing ledger → start fresh. Fail-safe, never fatal.
      this.ledger = { windowStart: 0, minutesUsed: 0 };
    }
  }

  private saveLedger(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("path") as typeof import("path");
      fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
      fs.writeFileSync(this.ledgerPath, JSON.stringify(this.ledger), "utf8");
    } catch {
      // Ledger is best-effort; a failed write must not break rendering.
    }
  }

  /** Minutes of ZeroGPU budget remaining (estimate). Resets 24h after windowStart. */
  quotaRemainingMin(nowMs: number = Date.now()): number {
    this.loadLedger();
    if (this.ledger.windowStart === 0 || nowMs - this.ledger.windowStart >= 24 * 60 * 60 * 1000) {
      return this.dailyBudgetMin();
    }
    return Math.max(0, this.dailyBudgetMin() - this.ledger.minutesUsed);
  }

  /**
   * Record estimated GPU minutes consumed by one Spaces call.
   * The estimate comes from wall-clock time of the bridge call — HF is the
   * source of truth; we keep the estimate conservative (fail-safe).
   */
  recordSpacesUsage(minutes: number, nowMs: number = Date.now()): void {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.loadLedger();
    if (this.ledger.windowStart === 0 || nowMs - this.ledger.windowStart >= 24 * 60 * 60 * 1000) {
      this.ledger = { windowStart: nowMs, minutesUsed: 0 };
    }
    this.ledger.minutesUsed += minutes;
    this.saveLedger();
  }

  // ---- endpoint health ----

  /** True when the endpoint may be offered right now. */
  isEligible(ep: PoolEndpoint, nowMs: number = Date.now()): boolean {
    if (ep.kind === "ffmpeg") return true;
    const backoff = this.backoffUntil.get(ep.key);
    if (backoff !== undefined && nowMs < backoff) return false;
    if (ep.kind === "spaces" && this.quotaRemainingMin(nowMs) <= 0) return false;
    const lastUsed = this.lastUsedAt.get(ep.key);
    if (lastUsed !== undefined && nowMs - lastUsed < this.cooldownMs()) return false;
    return true;
  }

  /**
   * Order eligible endpoints least-recently-used first (never-used first),
   * keeping ffmpeg last as the final fallback. `pool` preserves the
   * configured preference for ties.
   */
  orderedEndpoints(pool: PoolEndpoint[], nowMs: number = Date.now()): PoolEndpoint[] {
    const eligible = pool.filter((ep) => this.isEligible(ep, nowMs));
    const rank = (ep: PoolEndpoint): number => {
      if (ep.kind === "ffmpeg") return Number.POSITIVE_INFINITY;
      return this.lastUsedAt.get(ep.key) ?? Number.NEGATIVE_INFINITY;
    };
    return eligible.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return pool.indexOf(a) - pool.indexOf(b);
    });
  }

  recordUse(key: string, nowMs: number = Date.now()): void {
    this.lastUsedAt.set(key, nowMs);
  }

  recordSuccess(key: string): void {
    this.consecFails.delete(key);
    this.backoffUntil.delete(key);
  }

  recordFailure(key: string, nowMs: number = Date.now()): void {
    const fails = (this.consecFails.get(key) ?? 0) + 1;
    this.consecFails.set(key, fails);
    if (fails >= this.maxFails()) {
      this.backoffUntil.set(key, nowMs + this.backoffMs());
      this.consecFails.delete(key);
    }
  }

  /** Test/ops introspection. */
  debugState(): { lastUsedAt: Record<string, number>; backoffUntil: Record<string, number>; ledger: PoolLedger } {
    this.loadLedger();
    return {
      lastUsedAt: Object.fromEntries(this.lastUsedAt),
      backoffUntil: Object.fromEntries(this.backoffUntil),
      ledger: { ...this.ledger },
    };
  }
}

function defaultLedgerPath(): string {
  const base = process.env.VIDEO_POOL_LEDGER_PATH;
  if (base) return base;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    return path.join(process.cwd(), "storage", "video-pool", "ledger.json");
  } catch {
    return "storage/video-pool/ledger.json";
  }
}

/** Module-level singleton for the worker. Tests construct their own state. */
let singleton: VideoPoolState | null = null;
export function getVideoPoolState(): VideoPoolState {
  if (!singleton) singleton = new VideoPoolState();
  return singleton;
}
