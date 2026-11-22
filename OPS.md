# Operations Guide — AI Product-to-Video Automation Platform

Day-2 runbook: backups, logs, disk, retention, upgrades, troubleshooting.
Deployment itself is covered in [DEPLOY.md](DEPLOY.md).

## Backup & restore

What matters: **Postgres** (jobs, research, evidence, reports) and the
**assets volume** (final MP4s, captions). Redis holds only the queue
(BullMQ rebuilds it); n8n's own DB lives in the same Postgres.

```bash
cd /opt/product-video-platform   # wherever you cloned the repo

# --- Backup Postgres (nightly recommended) ---
docker compose exec -T postgres \
  pg_dump -U pv -d product_video | gzip > backups/pv-$(date +%F).sql.gz

# --- Backup assets volume ---
docker run --rm \
  -v product-video-platform_assets:/assets:ro \
  -v "$(pwd)/backups:/backup" \
  alpine tar czf /backup/assets-$(date +%F).tar.gz -C /assets .

# --- Backup n8n credentials (encrypted with N8N_ENCRYPTION_KEY) ---
docker compose exec -T postgres \
  pg_dump -U pv -d n8n | gzip > backups/n8n-$(date +%F).sql.gz
```

Restore (destructive — stops the stack first):

```bash
docker compose down
docker volume rm product-video-platform_pgdata product-video-platform_assets
docker compose up -d postgres
sleep 8
gunzip -c backups/pv-YYYY-MM-DD.sql.gz | \
  docker compose exec -T postgres psql -U pv -d product_video
docker run --rm \
  -v product-video-platform_assets:/assets \
  -v "$(pwd)/backups:/backup" \
  alpine tar xzf /backup/assets-YYYY-MM-DD.tar.gz -C /assets
docker compose up -d
docker compose run --rm app npx prisma migrate deploy
```

Keep 7 daily + 4 weekly backups; `N8N_ENCRYPTION_KEY` must be the same
value as when the backup was taken or n8n credentials won't decrypt.

## Log rotation

Compose's default `json-file` driver grows unbounded. Cap it per service
in `docker-compose.yml` (add under each service) or globally in
`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

then `sudo systemctl restart docker`. (Restarting docker restarts the
stack — schedule it; in-flight renders are lost, queued jobs resume.)

## Disk-usage monitoring & media retention

Video work eats disk. Watch three things:

```bash
# Host disk
df -h /
# Named volumes
docker system df -v | grep -A2 product-video-platform
# Biggest job dirs inside the assets volume
docker run --rm -v product-video-platform_assets:/assets alpine \
  du -sh /assets/* 2>/dev/null | sort -rh | head
```

**Retention policy** (enforced by `scripts/cleanup-assets.sh`):

| Data | Kept | Rationale |
|---|---|---|
| Intermediate scene files, end-cards, `*.tmp` | 7 days | Reproducible from the job record |
| Finished job dirs (`final.mp4` + captions) | 90 days | Reels have a long tail; then purge |
| Postgres job history / reports | forever | Tiny; needed for usage & audit |

Weekly cron (runs the script in **dry-run** unless `--apply` is passed):

```bash
# /etc/cron.d/pv-cleanup — Sundays 03:00
0 3 * * 0 root ASSETS_DIR=/var/lib/docker/volumes/product-video-platform_assets/_data \
  /opt/product-video-platform/scripts/cleanup-assets.sh --apply >> /var/log/pv-cleanup.log 2>&1
```

> Prefer mounting the `assets` volume at a host path (compose `driver_opts`
> or a bind mount) so cron can reach it without guessing Docker's volume dir.
> Alert threshold: page yourself when `/` exceeds 80%.

## Upgrade procedure

Watchtower is **deliberately not installed** — unattended restarts can kill
a mid-render job. Upgrades are manual:

```bash
cd /opt/product-video-platform
git pull
# 1. Backup first (see above)
# 2. Rebuild + migrate
docker compose build app worker
docker compose up -d
docker compose run --rm app npx prisma migrate deploy
# 3. Verify
curl -s https://videos.example.com/api/v1/health
docker compose ps
```

If a migration fails: `docker compose down`, restore the Postgres backup,
`git stash` / checkout the previous tag, `docker compose up -d`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl …/health` → connection refused | Caddy has no cert yet / DNS not propagated | `docker compose logs proxy`; confirm DNS A-records; wait for LE issuance |
| `proxy` 502 on `/api/v1/*` | `app` unhealthy | `docker compose logs app`; check `DATABASE_URL`/`REDIS_URL`; `docker compose ps` health |
| Job stuck in `QUEUED` | worker down or Redis unreachable | `docker compose logs worker`; `docker compose exec redis redis-cli ping` |
| Job creation → 500 | Postgres down / migrations not applied | `docker compose exec postgres pg_isready`; run `migrate deploy` (DEPLOY.md §6) |
| `enqueueWarning` on job create | Redis down; job stays QUEUED in DB | recorded as a JobEvent — start Redis, job will be picked up |
| Captions missing / render error "No caption font found" | font missing in worker image | `docker compose exec worker ls /usr/share/fonts/TTF/DejaVuSans.ttf`; rebuild worker |
| edge-tts 401/429 or empty audio | unofficial endpoint throttled/changed | typed error in JobEvent; pipeline falls back to hf-inference TTS when `HF_TOKEN` set |
| HF Inference 429 / model loading | free-tier rate limit / cold start | backoff + retry is built in; reduce concurrent jobs; never share one token across heavy parallel use |
| Tier A (Spaces) always falls back | Space queued/removed, no python3 | expected — Tier B FFmpeg motion is the reliable default; see DEPLOY.md §9 |
| n8n webhook 401s | `N8N_WEBHOOK_SECRET` mismatch | compare `.env` value with the n8n Header Auth credential |
| Disk full mid-render | retention not running | run `scripts/cleanup-assets.sh --apply` manually; set up the cron above |
| `prisma migrate deploy` fails | DB drift / old migration | restore Postgres backup, then retry; never hand-edit `_prisma_migrations` |

## Known limitations (honest)

- **Free-tier rate limits are real.** HF Serverless Inference (~hundreds of
  req/hr, cold starts), edge-tts (unofficial, can throttle), Pollinations
  (best-effort). The pipeline retries with backoff and degrades gracefully,
  but this is not an SLA-backed stack.
- **Tier A image-to-video is experimental.** HF Spaces are third-party,
  queue-bound, and can disappear. Tier B (FFmpeg cinematic motion) is the
  default for a reason.
- **No GPU in this architecture.** Rendering is CPU FFmpeg; a 60s 1080×1920
  video takes minutes on 2 vCPUs. AI video models are intentionally *not*
  self-hosted (cost + complexity).
- **Research quality depends on the source site.** Anti-bot pages, paywalls
  and CAPTCHAs are never bypassed — extraction fails loudly and asks the
  user for the missing facts instead of inventing them.
- **This repo's dev VM has no Docker daemon, Postgres, or Redis**, so
  compose-level validation here is static (`docker compose config` needs a
  daemon). Run the DEPLOY.md verification steps on the target VM.

## Cost estimate

| Item | Cost |
|---|---|
| AI providers (free stack: HF Inference + Pollinations + edge-tts + FFmpeg) | **$0/mo** |
| Cloud VM (2 vCPU / 4 GB, e.g. Oracle Ampere or equivalent) | **$0–25/mo** (Oracle's always-free tier can cover a small shape; paid shapes ~$15–25) |
| Domain | ~$10/yr |
| Let's Encrypt TLS | $0 |
| S3-compatible storage | $0 (local volume default; S3 only if you opt in) |

With the default free stack, **per-video marginal cost is $0**. The only
real money is the VM + domain. Paid providers (fal.ai, ElevenLabs, …) are
supported as opt-in fallbacks with per-job budget caps
(`MAX_COST_USD_PER_JOB`), but nothing in the default path spends a cent.
