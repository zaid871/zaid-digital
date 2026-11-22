/**
 * test-storage-s3-floci: S3 smoke test against a LOCAL Floci emulator.
 *
 * What this proves: the Floci emulator speaks S3 (bucket create, put,
 * head, get, delete) with the SDK config this project will use.
 *
 * What it does NOT prove: the app's S3 lane. src/lib/storage.ts
 * S3StorageBackend is still a Phase-7 STUB (put/get/signedUrl throw
 * "not yet implemented"). This test talks to Floci DIRECTLY via the
 * AWS SDK, bypassing storage.ts. When Phase 7 implements the backend,
 * this script becomes its integration test.
 *
 * Floci = MIT local AWS emulator (LocalStack Community replacement),
 * port 4566, image floci/floci:2.4.0 (pinned). Runs on the Oracle VM's
 * Docker for testing — NEVER on the user's PC (cloud-only rule).
 *
 * Start it:  docker compose --profile test up -d floci
 * Run this:  npx tsx scripts/test-storage-s3-floci.ts
 * Stop it:   docker compose --profile test down
 *
 * Env (all optional, Floci defaults shown):
 *   S3_ENDPOINT (default http://127.0.0.1:4566)
 *   S3_BUCKET   (default floci-smoke-<timestamp>, unique per run)
 *   S3_ACCESS_KEY / S3_SECRET_KEY (default "test" / "test")
 *   S3_REGION   (default us-east-1)
 */
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:4566";
const BUCKET = process.env.S3_BUCKET ?? `floci-smoke-${Date.now()}`;
const REGION = process.env.S3_REGION ?? "us-east-1";
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? "test";
const SECRET_KEY = process.env.S3_SECRET_KEY ?? "test";
const KEY = "smoke/hello.txt";
const PAYLOAD = `floci-smoke-${Date.now()}\n`;

const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

let pass = 0;
let fail = 0;

async function check(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function waitForEndpoint(tries = 10): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      // Any HTTP response (even a 4xx XML error) means the emulator is up.
      await fetch(`${ENDPOINT}/`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

function isNotFound(e: unknown): boolean {
  if (e instanceof Error && e.name === "NotFound") return true;
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return status === 404;
}

async function main(): Promise<void> {
  console.log(`endpoint=${ENDPOINT} bucket=${BUCKET} region=${REGION}`);
  const up = await waitForEndpoint();
  if (!up) {
    console.log("FAIL endpoint reachable: Floci is not running.");
    console.log("Start it first: docker compose --profile test up -d floci");
    console.log("Then re-run: npx tsx scripts/test-storage-s3-floci.ts");
    process.exitCode = 1;
    return;
  }
  pass++;
  console.log("ok   endpoint reachable");

  try {
    await check("create bucket", async () => {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    });
    await check("put object", async () => {
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: PAYLOAD }),
      );
    });
    await check("head object (size matches)", async () => {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }),
      );
      if (head.ContentLength !== Buffer.byteLength(PAYLOAD)) {
        throw new Error(
          `ContentLength ${head.ContentLength}, expected ${Buffer.byteLength(PAYLOAD)}`,
        );
      }
    });
    await check("get object (bytes match)", async () => {
      const got = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: KEY }),
      );
      const body = await got.Body?.transformToString();
      if (body !== PAYLOAD) {
        throw new Error(`body mismatch: ${JSON.stringify(body)}`);
      }
    });
    await check("delete object (head then 404s)", async () => {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }));
        throw new Error("head succeeded after delete");
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    });
    await check("delete bucket", async () => {
      await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    });
  } finally {
    // Best-effort cleanup of whatever remains — never fails the run.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
    } catch {
      /* already deleted */
    }
    try {
      await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    } catch {
      /* already deleted */
    }
  }

  console.log(`\n${pass} passed, ${fail} failed (bucket ${BUCKET})`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(
    `FAIL unexpected: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 1;
});
