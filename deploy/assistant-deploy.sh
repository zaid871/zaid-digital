#!/usr/bin/env bash
# assistant-deploy.sh — deploy the product-video-platform stack to a cloud VM
# from THIS machine over SSH. Idempotent: safe to re-run.
#
# Two modes:
#   deploy   full first-time deploy (docker, code, .env, compose up, migrate, verify)
#   update   push code changes and rebuild app+worker (later changes, no .env rewrite)
#
# Required environment (never put secrets in chat — pass them here):
#   VM_IP        public IP of the VM
#   DOMAIN       your domain, e.g. videos.example.com (DNS A-record -> VM_IP).
#                Pre-DNS testing: set DOMAIN=$VM_IP (plain HTTP; n8n editor then
#                reachable only via SSH tunnel, see runbook).
#   ACME_EMAIL   email for Let's Encrypt notices
#   HF_TOKEN     Hugging Face token (Inference permission). OPTIONAL since
#                2026-10-21: HF Inference Providers has no free credits for free
#                accounts, so HF legs are last-resort unless you add credits/PRO.
#                Leave unset to run 100% free without HF. Token value never
#                leaves this shell.
#
# Optional:
#   SSH_USER     default: ubuntu
#   SSH_KEY      default: ~/workspace/user/ssh-keys/oracle-a1
#   N8N_API_KEY  if set, workflows are imported into compose-n8n via its API;
#                otherwise the script prints exact manual import steps.
#   GROQ_API_KEY optional; if set, written into the server .env as the 1st
#                script-chain fallback. Create free at console.groq.com/keys.
#   GEMINI_API_KEY
#                optional; if set, written into the server .env as the 2nd
#                script-chain fallback. Create free at aistudio.google.com/apikey.
#
# Example:
#   VM_IP=1.2.3.4 DOMAIN=videos.example.com ACME_EMAIL=you@example.com \
#     GROQ_API_KEY=<your-groq-key> GEMINI_API_KEY=<your-gemini-key> ./deploy/assistant-deploy.sh deploy
#
set -euo pipefail

MODE="${1:-deploy}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/workspace/user/ssh-keys/oracle-a1}"
REMOTE_DIR="/opt/product-video-platform"

need() { [[ -n "${!1:-}" ]] || { echo "ERROR: $1 is not set." >&2; exit 1; }; }

need VM_IP
need DOMAIN
need ACME_EMAIL
[[ "$MODE" == "deploy" || "$MODE" == "update" ]] || { echo "ERROR: mode must be deploy|update" >&2; exit 1; }
[[ -f "$SSH_KEY" ]] || { echo "ERROR: SSH key not found: $SSH_KEY" >&2; exit 1; }
if [[ "$MODE" == "deploy" ]]; then
  if [[ -z "${HF_TOKEN:-}" ]]; then
    echo "NOTE: HF_TOKEN is unset — Hugging Face legs will be skipped (free HF accounts" >&2
    echo "      have no Inference Providers credits since 2026-10-21). The system runs 100%" >&2
    echo "      free on Groq/Gemini/Pollinations/edge-tts." >&2
  fi
fi

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${SSH_USER}@${VM_IP}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> pre-flight: $SSH_USER@$VM_IP (mode: $MODE)"
$SSH 'set -e
  . /etc/os-release 2>/dev/null || true
  echo "os=$PRETTY_NAME arch=$(uname -m)"
  mem=$(free -g | awk "/^Mem:/{print \$2}"); echo "mem_gb=$mem"
  df -BG / | awk "NR==2{print \"disk_free=\" \$4}"
  [ "$(uname -m)" = "aarch64" ] || echo "WARN: not aarch64 — FFmpeg images are multi-arch, fine"
  [ "$mem" -ge 8 ] 2>/dev/null || echo "WARN: <8GB RAM — 60s renders will be slow"'

install_docker() {
  echo "==> docker + firewall"
  $SSH 'set -e
    if ! command -v docker >/dev/null; then
      sudo apt-get update -qq
      sudo apt-get install -y -qq ca-certificates curl gnupg
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
      sudo usermod -aG docker "$USER"
    fi
    docker --version; docker compose version
    sudo ufw --force reset >/dev/null 2>&1 || true
    sudo ufw default deny incoming >/dev/null
    sudo ufw default allow outgoing >/dev/null
    sudo ufw allow 22/tcp >/dev/null; sudo ufw allow 80/tcp >/dev/null; sudo ufw allow 443/tcp >/dev/null
    echo "y" | sudo ufw enable >/dev/null 2>&1 || true
    sudo ufw status | head -8
    echo "NOTE: also open 80/443/22 in the Oracle VCN security list (console, user-side) or traffic never reaches the VM."'
}

sync_code() {
  echo "==> syncing code to $REMOTE_DIR"
  $SSH "mkdir -p $REMOTE_DIR"
  rsync -az --delete \
    --exclude 'node_modules' --exclude '.git' --exclude '.next' \
    --exclude 'storage' --exclude '.env' --exclude '*.log' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
    "$PROJECT_DIR"/ "${SSH_USER}@${VM_IP}:${REMOTE_DIR}/"
}

write_env() {
  echo "==> generating .env on the server (secrets stay in this shell only)"
  # Generate all random values locally; HF_TOKEN is passed in env (never logged).
  local pg_pw n8n_enc n8n_secret basic_pw
  pg_pw="$(openssl rand -base64 24)"
  n8n_enc="$(openssl rand -base64 32)"
  n8n_secret="$(openssl rand -base64 32)"
  basic_pw="$(openssl rand -base64 18)"
  # Hash the basic-auth password inside a throwaway caddy container on the server.
  local basic_hash
  basic_hash="$($SSH "docker run --rm caddy:2-alpine caddy hash-password --plaintext '$basic_pw'" 2>/dev/null || true)"
  [[ -n "$basic_hash" ]] || { echo "ERROR: could not generate basic-auth hash (docker/caddy pull failed?)" >&2; exit 1; }
  # Write .env via stdin heredoc over SSH — nothing is echoed back.
  # shellcheck disable=SC2087
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${SSH_USER}@${VM_IP}" \
    "cat > $REMOTE_DIR/.env" <<EOF
NODE_ENV=production
APP_URL=https://$DOMAIN
POSTGRES_PASSWORD=$pg_pw
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
DATABASE_URL=
REDIS_URL=redis://localhost:6379
STORAGE_BACKEND=local
ASSETS_DIR=/app/storage/jobs
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=product-video-assets
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_FORCE_PATH_STYLE=false
# CAPTION_FONT=  (leave unset: the worker image sets it automatically)
N8N_WEBHOOK_URL=https://n8n.$DOMAIN/webhook/product-video/job
N8N_WEBHOOK_SECRET=$n8n_secret
BACKEND_URL=https://$DOMAIN
# Instagram Graph API identity for the repost sweep's insights reads
# (same values the n8n workflows already use).
IG_USER_ID=
IG_ACCESS_TOKEN=
N8N_ENCRYPTION_KEY=$n8n_enc
N8N_BASIC_AUTH_USER=n8nadmin
N8N_BASIC_AUTH_HASH='$basic_hash'
HF_TOKEN=${HF_TOKEN:-}
GROQ_API_KEY=${GROQ_API_KEY:-}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
HF_INFERENCE_BASE_URL=
POLLINATIONS_MODEL=flux
EDGE_TTS_VOICE=hi-IN-SwaraNeural
EDGE_TTS_RATE=+0%
EDGE_TTS_PITCH=
EDGE_TTS_VOLUME=
HF_SPACES_VIDEO_ENABLED=false
HF_SPACE_ID=Lightricks/LTX-Video
HF_SPACE_API_NAME=/predict
HF_SPACE_EXTRA_ARGS_JSON=
HF_SPACES_TIMEOUT_SEC=120
HF_SPACES_BRIDGE_PATH=
EOF
  echo "n8n editor basic-auth password (save this, shown once): $basic_pw"
  echo "N8N_WEBHOOK_SECRET is in the server .env; the main n8n workflow needs it as the x-n8n-secret credential."
}

compose_up() {
  echo "==> starting stack"
  $SSH "cd $REMOTE_DIR && docker compose up -d --build"
  echo "==> waiting for postgres/redis health (up to 3 min)"
  $SSH "cd $REMOTE_DIR && for i in \$(seq 1 36); do
    ok=\$(docker compose ps --format json 2>/dev/null | grep -ci '\"health\":\"healthy\"' || true)
    [ \"\$ok\" -ge 2 ] && break; sleep 5; done; docker compose ps"
}

migrate() {
  echo "==> prisma migrate deploy"
  $SSH "cd $REMOTE_DIR && docker compose run --rm app npx prisma migrate deploy"
}

verify() {
  echo "==> verifying"
  $SSH "cd $REMOTE_DIR && docker compose exec worker ls -l /usr/share/fonts/TTF/DejaVuSans.ttf"
  sleep 3
  local scheme="https"
  [[ "$DOMAIN" == "$VM_IP" ]] && scheme="http"
  echo "--- GET $scheme://$DOMAIN/api/v1/health"
  curl -sk --max-time 20 "$scheme://$DOMAIN/api/v1/health" | head -c 400; echo
  echo "--- GET $scheme://$DOMAIN/api/v1/providers"
  curl -sk --max-time 20 "$scheme://$DOMAIN/api/v1/providers" | head -c 600; echo
}

import_workflows() {
  echo "==> n8n workflow import"
  if [[ -n "${N8N_API_KEY:-}" && "$DOMAIN" != "$VM_IP" ]]; then
    for wf in main-workflow error-workflow; do
      echo "--- importing n8n/workflows/$wf.json"
      curl -sk --max-time 30 -X POST "https://n8n.$DOMAIN/api/v1/workflows" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'content-type: application/json' \
        -d @"$PROJECT_DIR/n8n/workflows/$wf.json" | head -c 200; echo
    done
    echo "Activate both workflows in the n8n editor afterwards."
  else
    cat <<'EOF'
Manual import (2 min) — https://n8n.<DOMAIN> (basic-auth: n8nadmin + the password shown above):
  1. If n8n prompts, create its owner account first (separate from basic-auth).
  2. Workflows → ⋯ → Import from file → n8n/workflows/main-workflow.json, then error-workflow.json.
  3. (Optional, for the API path) Settings → n8n API → create key → re-run this script with N8N_API_KEY set.
  4. Credentials → add Header Auth 'backend-callback-secret' (header x-n8n-secret = N8N_WEBHOOK_SECRET from server .env); attach to HTTP nodes.
  5. Activate both workflows; set N8N_WEBHOOK_URL in server .env to the production webhook URL n8n shows; restart app+worker.
EOF
  fi
}

case "$MODE" in
  deploy)
    install_docker
    sync_code
    write_env
    compose_up
    migrate
    verify
    import_workflows
    echo "==> DONE. Dashboard: https://$DOMAIN   n8n: https://n8n.$DOMAIN"
    ;;
  update)
    sync_code
    echo "==> rebuilding app+worker and re-running migrations"
    $SSH "cd $REMOTE_DIR && docker compose up -d --build app worker && docker compose run --rm app npx prisma migrate deploy && docker compose restart app worker"
    verify
    echo "==> DONE."
    ;;
esac
