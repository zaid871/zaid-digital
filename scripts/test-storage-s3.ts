/**
 * test-storage-s3: S3StorageBackend (Phase 7) checks.
 *
 * Unit tests run WITHOUT any network, against an in-memory fake S3
 * client injected into the backend (put/get/exists, unsafe keys,
 * missing-env error, signed-URL expiry validation).
 *
 * Live tests run ONLY with S3_LIVE_TEST=1, against a REAL backend built
 * from env (defaults point at a local Floci emulator). They also cover
 * signedUrl end to end: the presigned URL is fetched and its bytes are
 * compared. Start Floci first:
 *   docker compose --profile test up -d floci
 *   S3_LIVE_TEST=1 npx tsx scripts/test-storage-s3.ts
 *
 * Run: npx tsx scripts/test-storage-s3.ts
 */
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { S3StorageBackend } from "../src/lib/storage";

let pass = 0;
let fail = 0;

async function check(
  name: string,
  fn: () => Promise<unknown> | unknown,
  expectThrow?: RegExp,
): Promise<void> {
  try {
    await fn();
    if (expectThrow) {
      fail++;
      console.log(`FAIL ${name}: expected throw ${expectThrow}, got success`);
    } else {
      pass++;
      console.log(`ok   ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (expectThrow && expectThrow.test(msg)) {
      pass++;
      console.log(`ok   ${name} (threw as expected)`);
    } else {
      fail++;
      console.log(`FAIL ${name}: threw ${msg}`);
    }
  }
}

/** In-memory fake S3: answers Put/Get/Head from a Map. */
class FakeS3 {
  store = new Map<string, { body: Buffer; contentType?: string }>();
  lastPutContentType?: string;

  async send(cmd: unknown): Promise<unknown> {
    if (cmd instanceof PutObjectCommand) {
      const key = cmd.input.Key as string;
      const body = Buffer.from(cmd.input.Body as unknown as Uint8Array);
      this.store.set(key, {
        body,
        contentType: cmd.input.ContentType,
      });
      this.lastPutContentType = cmd.input.ContentType;
      return {};
    }
    if (cmd instanceof GetObjectCommand) {
      const hit = this.store.get(cmd.input.Key as string);
      if (!hit) throw notFound();
      return {
        Body: {
          transformToByteArray: async () =>
            new Uint8Array(hit.body),
        },
      };
    }
    if (cmd instanceof HeadObjectCommand) {
      const hit = this.store.get(cmd.input.Key as string);
      if (!hit) throw notFound();
      return { ContentLength: hit.body.length };
    }
    throw new Error(
      `FakeS3: unexpected command ${(cmd as { constructor?: { name?: string } })?.constructor?.name}`,
    );
  }
}

function notFound(): Error {
  const e = new Error("The specified key does not exist.") as Error & {
    $metadata?: { httpStatusCode?: number };
  };
  e.name = "NotFound";
  e.$metadata = { httpStatusCode: 404 };
  return e;
}

async function waitForEndpoint(endpoint: string, tries = 10): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(`${endpoint}/`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function runUnitTests(): Promise<void> {
  console.log("--- unit tests (fake S3, no network) ---");
  const saved = {
    bucket: process.env.S3_BUCKET,
    key: process.env.S3_ACCESS_KEY,
    secret: process.env.S3_SECRET_KEY,
  };

  await check("missing env throws not_configured", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    try {
      new S3StorageBackend();
    } finally {
      if (saved.bucket !== undefined) process.env.S3_BUCKET = saved.bucket;
      if (saved.key !== undefined) process.env.S3_ACCESS_KEY = saved.key;
      if (saved.secret !== undefined)
        process.env.S3_SECRET_KEY = saved.secret;
    }
  }, /S3 storage not configured — missing: S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY/);

  process.env.S3_BUCKET = "test-bucket";
  const fake = new FakeS3();
  const backend = new S3StorageBackend(fake as unknown as S3Client);

  const payload = Buffer.from("hello s3\n");
  await check("put returns key + sets video/mp4 ContentType", async () => {
    const key = await backend.put(
      writeTmp("put-test.mp4", payload),
      "job-1/final.mp4",
    );
    if (key !== "job-1/final.mp4") throw new Error(`key was ${key}`);
    if (fake.lastPutContentType !== "video/mp4") {
      throw new Error(`ContentType was ${fake.lastPutContentType}`);
    }
  });
  await check("put sets image/gif ContentType", async () => {
    await backend.put(writeTmp("put-test.gif", payload), "job-1/preview.gif");
    if (fake.lastPutContentType !== "image/gif") {
      throw new Error(`ContentType was ${fake.lastPutContentType}`);
    }
  });
  await check("get returns exact bytes", async () => {
    const got = await backend.get("job-1/final.mp4");
    if (!got.equals(payload)) throw new Error("bytes differ");
  });
  await check("exists true for stored, false for missing", async () => {
    if (!(await backend.exists("job-1/final.mp4"))) {
      throw new Error("stored object reported missing");
    }
    if (await backend.exists("job-1/nope.mp4")) {
      throw new Error("missing object reported present");
    }
  });
  await check("get missing throws NotFound", async () => {
    await backend.get("job-1/nope.mp4");
  }, /does not exist/);
  await check("unsafe key rejected on put", async () => {
    await backend.put(writeTmp("evil.txt", payload), "../evil.txt");
  }, /Unsafe storage key/);
  await check("unsafe key rejected on get", async () => {
    await backend.get("../../etc/passwd");
  }, /Unsafe storage key/);
  await check("signedUrl rejects bad expiry before signing", async () => {
    await backend.signedUrl("job-1", "job-1/final.mp4", 0);
  }, /Invalid signed URL expiry/);
}

function writeTmp(name: string, data: Buffer): string {
  const p = join(tmpdir(), `s3-test-${Date.now()}-${name}`);
  writeFileSync(p, data);
  tmpFiles.push(p);
  return p;
}
const tmpFiles: string[] = [];

async function runLiveTests(userBucket?: string): Promise<void> {
  console.log("--- live tests (real backend, Floci defaults) ---");
  const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:4566";
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_BUCKET = userBucket ?? `s3-live-${Date.now()}`;
  process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? "test";
  process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? "test";
  process.env.S3_REGION = process.env.S3_REGION ?? "us-east-1";
  process.env.S3_FORCE_PATH_STYLE = "true";
  console.log(
    `endpoint=${endpoint} bucket=${process.env.S3_BUCKET} region=${process.env.S3_REGION}`,
  );

  const up = await waitForEndpoint(endpoint);
  if (!up) {
    console.log("FAIL live endpoint reachable: Floci is not running.");
    console.log("Start it first: docker compose --profile test up -d floci");
    fail++;
    return;
  }
  pass++;
  console.log("ok   live endpoint reachable");

  const backend = new S3StorageBackend();
  const payload = Buffer.from(`live-s3-${Date.now()}\n`);
  const localPath = writeTmp("live.mp4", payload);
  const key = "live/final.mp4";

  await check("live put returns key", async () => {
    const k = await backend.put(localPath, key);
    if (k !== key) throw new Error(`key was ${k}`);
  });
  await check("live exists true", async () => {
    if (!(await backend.exists(key))) throw new Error("not found after put");
  });
  await check("live get returns exact bytes", async () => {
    const got = await backend.get(key);
    if (!got.equals(payload)) throw new Error("bytes differ");
  });
  await check("live signedUrl fetches 200 with matching bytes", async () => {
    const url = await backend.signedUrl("live-job", key, 300);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`presigned fetch status ${res.status}`);
    const text = await res.text();
    if (text !== payload.toString("utf-8")) {
      throw new Error("presigned body differs");
    }
  });
  console.log(
    `(live objects left in bucket ${process.env.S3_BUCKET} — Floci state is in-memory and wipes on restart)`,
  );
}

async function main(): Promise<void> {
  // Snapshot the user's S3_BUCKET before unit tests set their own.
  const userBucket = process.env.S3_BUCKET;
  await runUnitTests();
  if (process.env.S3_LIVE_TEST === "1") {
    await runLiveTests(userBucket);
  } else {
    console.log("--- live tests skipped (set S3_LIVE_TEST=1 + start Floci) ---");
  }
  for (const f of tmpFiles) {
    try {
      unlinkSync(f);
    } catch {
      /* best effort */
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(
    `FAIL unexpected: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 1;
});
