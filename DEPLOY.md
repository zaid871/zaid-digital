# Deployment Guide — AI Product-to-Video Automation Platform

Deploy the full stack on a cloud VM with Docker Compose. Tested target:
**Ubuntu 22.04 / 24.04 LTS** (Oracle Cloud Infrastructure compatible).
No AI runs on your laptop — everything here lives on the server.

```
                    ┌───────────── Caddy (proxy) :80/:443 ─────────────┐
                    │  videos.example.com ──► app:3000                 │
Internet ──────────►│  n8n.videos.example.com ──► n8n:5678 (basic-auth) │
                    └──────────────────────────────────────────────────┘
        ┌──────┐   ┌──────┐   ┌──────────┐   ┌───────┐   ┌─────┐
        │ app  │──►│worker│   │ postgres │   │ redis │   │ n8n │
        │:3000 │   │BullMQ│   │   :16    │   │  :7   │   │     │
        └──────┘   │FFmpeg│   └──────────┘   └───────┘   └─────┘
                   └──────┘   ▲ internal network only — no public ports ▲
```

## 0. What you need before you start

| Item | Details |
|---|---|
| A cloud VM | Ubuntu 22.04/24.04. **Minimum 2 vCPU / 4 GB RAM** (FFmpeg rendering is CPU-hungry; 1 vCPU "works" but a 60s video can take 10+ min). 40 GB+ disk. Oracle Cloud free pick: **VM.Standard.A1.Flex with 2 OCPU / 12 GB** — this is the current Always Free allowance (Oracle halved it from 4/24 in June 2026; the 2 OCPU / 12 GB is shared across max 2 instances, so one full-size instance is the simplest choice). VM.Standard.E2.1.Micro is *below* minimum. "Out of capacity" on A1 is common — retry later or try another availability domain. |
| A domain | e.g. `videos.example.com`, DNS A-record → VM public IP. Also add `n8n.videos.example.com` → same IP. Let's Encrypt needs a real hostname (IP-only = HTTP only). |
| A Hugging Face token | Free, no credit card: https://huggingface.co/settings/tokens → **New token → Read**. This is the *only* secret you must obtain by hand for the free stack. |
| SSH access | `ssh ubuntu@<vm-ip>` |

## 1. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER   # re-login after this
docker --version && docker compose version
```

## 2. Get the code

```bash
# replace with your repo URL
git clone <your-repo-url> product-video-platform
cd product-video-platform
```

## 3. Configure `.env`

```bash
cp .env.production.example .env
nano .env
```

Fill in **at minimum**:

| Variable | How to fill |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
| `DOMAIN` | your domain, e.g. `videos.example.com` |
| `ACME_EMAIL` | your email (Let's Encrypt notices) |
| `N8N_ENCRYPTION_KEY` | `openssl rand -base64 32` (keep stable across restarts!) |
| `N8N_WEBHOOK_SECRET` | `openssl rand -base64 32` |
| `N8N_BASIC_AUTH_HASH` | `docker run --rm caddy:2-alpine caddy hash-password` → paste the `$2a$…` output, quoted |
| `HF_TOKEN` | your Hugging Face token (`hf_…`) |
| `APP_URL` / `BACKEND_URL` / `N8N_WEBHOOK_URL` | `https://videos.example.com`, `https://n8n.videos.example.com/...` (match your DOMAIN) |

Everything else ships with working defaults for the **free stack**
(HF Inference + Pollinations + edge-tts + FFmpeg). Paid provider keys stay
empty — the platform reports them honestly as *unconfigured*.

## 4. Firewall (ufw) — allow 22/80/443 only

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

> Oracle Cloud adds a second layer: open ingress rules for 80/443 (and 22)
> in the VCN **security list** attached to your subnet, or traffic never
> reaches the VM. Postgres (5432), Redis (6379) and n8n (5678) stay closed —
> the compose file publishes no ports for them.

## 5. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

This pulls `postgres:16-alpine`, `redis:7-alpine`, `n8nio/n8n:1-latest`,
`caddy:2-alpine` and builds `app` + `worker` from `docker/`.

## 6. Run database migrations

```bash
docker compose run --rm app npx prisma migrate deploy
```

(`db:deploy` = `prisma migrate deploy`. Never run `migrate dev` in production.)

## 7. Import the n8n workflows

1. Open `https://n8n.<your-domain>` → log in with
   `N8N_BASIC_AUTH_USER` / the password you hashed.
2. n8n will prompt you to create its own owner account on first visit —
   do that (this is separate from the proxy basic-auth).
3. **Workflows → ⋯ → Import from file** → upload
   `n8n/workflows/main-workflow.json`, then `error-workflow.json`.
4. In n8n: **Credentials** → add a *Header Auth* credential named
   `backend-callback-secret` with header `x-n8n-secret` =
   your `N8N_WEBHOOK_SECRET`, and attach it to the workflow's
   HTTP nodes that call back into the backend.
5. Activate the main workflow. Copy the production webhook URL it shows
   and set it as `N8N_WEBHOOK_URL` in `.env`, then
   `docker compose up -d app worker` to pick it up.

> Alternative (no public n8n subdomain): keep the editor off the proxy —
> comment out the `n8n.{$DOMAIN}` block in `docker/Caddyfile`,
> `docker compose up -d proxy`, and reach n8n via SSH tunnel:
> `ssh -L 5678:localhost:5678 ubuntu@<vm-ip>` then open
> `http://localhost:5678`. Set `N8N_WEBHOOK_URL=http://n8n:5678/...`
> (compose-internal) in that case.

## 8. Verify

```bash
# Health (through Caddy + HTTPS)
curl -s https://videos.example.com/api/v1/health | head -c 400; echo

# Providers — free stack should show edge-tts/pollinations available,
# HF configured once HF_TOKEN is set, everything paid "unconfigured"
curl -s https://videos.example.com/api/v1/providers | head -c 600; echo

# Create a real job
curl -s -X POST https://videos.example.com/api/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"productUrl":"https://example.com/product","durationSeconds":45}'

# Watch it move through the 15 stages (dashboard or API polling)
```

Also verify the caption font landed in the worker image (needed for
burned-in subtitles):

```bash
docker compose exec worker ls -l /usr/share/fonts/TTF/DejaVuSans.ttf
```

## 9. Enabling Tier A experimental video (optional)

Tier A (HF Spaces image-to-video via `gradio_client`) is **off** by
default. To enable it, extend the worker image:

```dockerfile
# docker/Dockerfile.worker.tier-a  (example)
FROM product-video-platform-worker
RUN apk add --no-cache python3 py3-pip && pip install --no-cache gradio-client
```

then in `.env`:

```
HF_SPACES_VIDEO_ENABLED=true
HF_SPACE_ID=<a public image-to-video Space>
HF_SPACE_API_NAME=/predict
```

The pipeline tries Tier A first and falls back to Tier B (FFmpeg motion)
automatically on queue timeout or failure — a dead Space never kills a job.

## 10. What "done" looks like

- `https://videos.example.com` serves the dashboard; `/api/v1/health`
  returns `ok: true` with postgres + redis reported healthy.
- A submitted product URL produces a Job with 15 stages progressing in
  the UI, ending in a downloadable `final.mp4` (1080×1920, 30fps).
- `https://n8n.videos.example.com` asks for basic-auth before showing n8n.
- `sudo ufw status` shows only 22/80/443 open.

---

**Next:** day-2 operations (backups, log rotation, retention, upgrades,
troubleshooting) live in [OPS.md](OPS.md).
