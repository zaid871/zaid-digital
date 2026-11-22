/**
 * Phase 6 — storage abstraction.
 *
 * The pipeline writes to a StorageBackend behind this interface so the
 * deployment can move from local disk to S3-compatible object storage
 * without touching render/QA/delivery code.
 *
 * Current deployment: LocalStorageBackend rooted at ASSETS_DIR
 * (default `<project>/storage/jobs`). Keys are relative paths like
 * `<jobId>/final.mp4`.
 *
 * S3-compatible backend: implemented as S3StorageBackend below (Phase 7,
 * 2026-11-12). It throws `not_configured` until S3_BUCKET /
 * S3_ACCESS_KEY / S3_SECRET_KEY are set. S3_ENDPOINT is optional
 * (empty = AWS default endpoint) — R2/Floci set it explicitly.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname, normalize, resolve, sep } from "path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assetsRoot } from "./pipeline/assets";

export interface StorageBackend {
  readonly kind: "local" | "s3";
  /** Copy a local file into storage under `key`. Returns the stored key. */
  put(localPath: string, key: string): Promise<string>;
  /** Read a stored object into memory. */
  get(key: string): Promise<Buffer>;
  /** True when the object exists and is readable. */
  exists(key: string): Promise<boolean>;
  /** Resolve the absolute local path for a key (local backend only). */
  resolveLocalPath?(key: string): string;
  /**
   * URL a client can use to download the object. For the local backend
   * this is the app's download route (no direct filesystem exposure).
   */
  signedUrl(jobId: string, key: string, expiresSec?: number): Promise<string>;
}

/** Guard: a storage key must stay inside the assets root (no `..` escapes). */
export function assertSafeKey(key: string): string {
  const clean = normalize(key).replace(/\\/g, "/");
  if (
    !clean ||
    clean.startsWith("/") ||
    clean.startsWith("..") ||
    clean.split("/").includes("..")
  ) {
    throw new Error(`Unsafe storage key rejected: ${key}`);
  }
  return clean;
}

export class LocalStorageBackend implements StorageBackend {
  readonly kind = "local" as const;
  private root: string;

  constructor(root?: string) {
    this.root = root ?? assetsRoot();
  }

  private abs(key: string): string {
    const safe = assertSafeKey(key);
    const abs = resolve(this.root, safe);
    // Belt-and-braces: resolved path must stay under the root.
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes assets root: ${key}`);
    }
    return abs;
  }

  async put(localPath: string, key: string): Promise<string> {
    const dest = this.abs(key);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(localPath, dest);
    return assertSafeKey(key);
  }

  async get(key: string): Promise<Buffer> {
    return readFileSync(this.abs(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      const abs = this.abs(key);
      return existsSync(abs) && statSync(abs).isFile();
    } catch {
      return false;
    }
  }

  resolveLocalPath(key: string): string {
    return this.abs(key);
  }

  async signedUrl(jobId: string, key: string): Promise<string> {
    const safe = assertSafeKey(key);
    // Served by GET /api/v1/jobs/:id/download?key=… which re-validates
    // that the key belongs to the job before streaming bytes.
    return `/api/v1/jobs/${encodeURIComponent(jobId)}/download?key=${encodeURIComponent(safe)}`;
  }
}

/**
 * S3-compatible backend (Phase 7 — IMPLEMENTED 2026-11-12).
 *
 * Talks to any S3-compatible store: real AWS S3, Cloudflare R2,
 * Backblaze B2, or a local Floci emulator (docs/floci-s3-testing.md).
 * Throws until S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY are set —
 * the platform must never claim S3 is configured when it is not.
 *
 * Env:
 *   S3_BUCKET (required), S3_ACCESS_KEY (required),
 *   S3_SECRET_KEY (required)
 *   S3_ENDPOINT (optional — empty = AWS default endpoint)
 *   S3_REGION (optional — default us-east-1; "auto" passes through for R2)
 *   S3_FORCE_PATH_STYLE (optional — "true" for Floci / R2-style endpoints)
 *
 * The optional `client` constructor arg exists for tests only —
 * production always builds the client from env.
 */
export class S3StorageBackend implements StorageBackend {
  readonly kind = "s3" as const;
  private client: S3Client;
  private bucket: string;

  constructor(client?: S3Client) {
    if (client) {
      // Test injection: bucket still comes from env so tests configure it.
      this.client = client;
      this.bucket = process.env.S3_BUCKET ?? "";
      if (!this.bucket) {
        throw new Error(
          "S3 storage not configured — missing: S3_BUCKET. " +
            "Set it in .env (see .env.example) to enable S3 delivery.",
        );
      }
      return;
    }
    const cfg = S3StorageBackend.resolveConfig();
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: cfg.credentials,
      forcePathStyle: cfg.forcePathStyle,
    });
  }

  private static resolveConfig(): {
    bucket: string;
    endpoint: string | undefined;
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    forcePathStyle: boolean;
  } {
    const bucket = process.env.S3_BUCKET ?? "";
    const accessKeyId = process.env.S3_ACCESS_KEY ?? "";
    const secretAccessKey = process.env.S3_SECRET_KEY ?? "";
    const missing = (
      [
        ["S3_BUCKET", bucket],
        ["S3_ACCESS_KEY", accessKeyId],
        ["S3_SECRET_KEY", secretAccessKey],
      ] as const
    )
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(
        `S3 storage not configured — missing: ${missing.join(", ")}. ` +
          `Set them in .env (see .env.example) to enable S3 delivery.`,
      );
    }
    const endpointRaw = process.env.S3_ENDPOINT ?? "";
    return {
      bucket,
      endpoint: endpointRaw ? endpointRaw : undefined,
      region: process.env.S3_REGION ?? "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle:
        (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    };
  }

  private static contentTypeFor(key: string): string | undefined {
    const ext = key.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      mp4: "video/mp4",
      gif: "image/gif",
      srt: "application/x-subrip",
      vtt: "text/vtt",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      json: "application/json",
    };
    return ext ? map[ext] : undefined;
  }

  async put(localPath: string, key: string): Promise<string> {
    const safe = assertSafeKey(key);
    const body = readFileSync(localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safe,
        Body: body,
        ContentType: S3StorageBackend.contentTypeFor(safe),
      }),
    );
    return safe;
  }

  async get(key: string): Promise<Buffer> {
    const safe = assertSafeKey(key);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safe }),
    );
    if (!res.Body) throw new Error(`S3 object empty: ${safe}`);
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async exists(key: string): Promise<boolean> {
    const safe = assertSafeKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: safe }),
      );
      return true;
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "NotFound" || e.name === "NoSuchKey")
      ) {
        return false;
      }
      const status = (e as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw e;
    }
  }

  async signedUrl(
    _jobId: string,
    key: string,
    expiresSec = 3600,
  ): Promise<string> {
    const safe = assertSafeKey(key);
    if (!Number.isFinite(expiresSec) || expiresSec <= 0) {
      throw new Error(`Invalid signed URL expiry: ${expiresSec}`);
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: safe }),
      { expiresIn: expiresSec },
    );
  }
}

/** Backend selected by STORAGE_BACKEND env ("local" default, "s3" opt-in). */
export function getStorage(): StorageBackend {
  if ((process.env.STORAGE_BACKEND ?? "local").toLowerCase() === "s3") {
    return new S3StorageBackend();
  }
  return new LocalStorageBackend();
}

/** Absolute local path for a storage key (local backend only). */
export function resolveKeyLocal(key: string, root?: string): string {
  return new LocalStorageBackend(root).resolveLocalPath!(key);
}
