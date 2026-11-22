# Floci — local S3 emulator for testing the S3 lane (added 2026-11-12)

Floci (`floci-io/floci`, MIT, ~31K stars) is a local AWS emulator — the
free replacement for LocalStack Community, which went auth-token-only
in March 2026. One container speaks the AWS APIs on port 4566, no
account, no token, no telemetry.

## What it is for in THIS setup — and what it is not

- **FOR:** testing the S3 storage lane (`STORAGE_BACKEND=s3`) against a
  local emulator before pointing it at real R2/B2 (or any S3-compatible
  store).
- **NOT:** a host or a deploy target. It never runs in production, never
  stores real videos, and never runs on the user's PC (cloud-only rule)
  — it runs on the Oracle VM's Docker, only while a test is running.

## How it is wired in

- `docker-compose.override.yml` adds a `floci` service: image
  `floci/floci:2.4.0` (pinned — never `latest`), port `127.0.0.1:4566`,
  `FLOCI_SERVICES=s3` (S3 only, keeps it light), profile `test`.
  Production `docker compose up -d` never starts it; only
  `docker compose --profile test up -d floci` does.
- State is in-memory by default — a restart wipes test buckets. That is
  fine for smoke tests; nothing real is stored there.
- The native-binary route does NOT work right now: the 2.4.0 release
  page ships no `floci-aws-linux-amd64` binary (404, verified 2026-11-12;
  two independent guides report the same). Docker is the only working
  route until the project fixes its release artifacts.

## Running the smoke test

```sh
docker compose --profile test up -d floci
npx tsx scripts/test-storage-s3-floci.ts
docker compose --profile test down
```

The script talks to Floci DIRECTLY via the AWS SDK (dummy creds
test/test) and checks: endpoint reachable → bucket create → put → head
(size) → get (bytes match) → delete object (head then 404s) → delete
bucket. If Floci is not running it fails cleanly with the exact start
command instead of a cryptic SDK error.

## Phase 7 — the backend is implemented (2026-11-12)

`src/lib/storage.ts` `S3StorageBackend` is now real: `put` / `get` /
`exists` / `signedUrl` (presigned GET, default 1h) against any
S3-compatible store. `@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner` are runtime dependencies (they survive
`npm prune --omit=dev` in the Dockerfiles). Env: S3_BUCKET /
S3_ACCESS_KEY / S3_SECRET_KEY required; S3_ENDPOINT optional (empty =
AWS default); S3_REGION default us-east-1 ("auto" passes through for
R2); S3_FORCE_PATH_STYLE=true for Floci/R2-style endpoints.

`scripts/test-storage-s3.ts` covers it: 9 unit tests against an
in-memory fake S3 (no network) + live tests behind `S3_LIVE_TEST=1`:

```sh
S3_LIVE_TEST=1 npx tsx scripts/test-storage-s3.ts
```

Live mode also fetches the presigned URL and compares its bytes — the
full publish path (upload → presigned public URL) proven against
Floci. Delivery (`src/lib/pipeline/delivery.ts`) already calls `put` +
`signedUrl`, so with STORAGE_BACKEND=s3 the final MP4 uploads to S3
and the result/download URL becomes the presigned link; the local
`/download` route keeps serving local-backend jobs only (501 for S3 —
by design, use the presigned URL instead).

## Honest limit — read this before trusting a green run

A green Floci smoke test proves **Floci's S3 works**; a green backend
live test proves **the app's S3 lane works against Floci**. Neither has
run live yet — no Docker in the sandbox, and the 2.4.0 native binary
404s. First live pass is on the VM (has Docker) at deploy. Real R2/B2
still need their own first live call (same test, different endpoint +
creds) before STORAGE_BACKEND=s3 is switched on for real.

## Real R2/B2

The same test pattern works against real Cloudflare R2 / Backblaze B2
by changing `S3_ENDPOINT` + creds — no code change. Note the scale:
10 GB free ≈ 1 month of video output, and the user's own 6TB Drive
archive (rclone plan, 2026-11-12) supersedes R2/B2 for archive. The S3
lane remains the publishing-store option, not the archive.
