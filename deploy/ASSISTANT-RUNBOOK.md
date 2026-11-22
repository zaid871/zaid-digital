# Assistant-led deploy runbook — product-video-platform

This document is the operator-side companion to [DEPLOY.md](../DEPLOY.md).
DEPLOY.md is the "you do it yourself" walkthrough; this is the checklist the
assistant follows when it deploys **itself** (and makes later changes) over SSH.

Status: **groundwork only — nothing has been deployed.** Handover DONE
2026-11-13 (see §0) — SSH works with the user's own key. Deploy is blocked
only on Groq + Gemini keys (user-side, secure card) and the §3 n8n fork
decision.

## 0. Handover — DONE 2026-11-13 (verified live by SSH)

- **VM public IP:** `158.180.19.153` (user-supplied in chat 2026-11-13).
- **SSH:** works with the user's own key file
  `~/workspace/user/files/ssh-key-2026-10-16.key` (RSA 2048, perms 600;
  path only — never paste its value). The assistant's `oracle-a1` key was
  NOT used at VM creation and does NOT log in — the deploy script's
  default `SSH_KEY` (`~/workspace/user/ssh-keys/oracle-a1`) is WRONG for
  this VM. Always invoke the script with
  `SSH_KEY=$HOME/workspace/user/files/ssh-key-2026-10-16.key`.
- **n8n owner email:** `preaitools@gmail.com`. n8n UP, HTTP 200 on
  `localhost:5678`, bound to 127.0.0.1 only (no browser access from
  outside until the bind changes or a tunnel is used).
- **VM survey 2026-11-13:** hostname `n8n-instance-20261017-0006`, up 27
  days, sudo passwordless OK; ONLY container is `n8n-n8n-1`; NO Postgres
  (n8n runs on default SQLite — Postgres must be added at deploy); disk
  39G free, RAM 10G free.
- **Still needed from the user:** `GROQ_API_KEY` + `GEMINI_API_KEY`
  (free, via secure entry card — never chat). HF_TOKEN optional
  (HF legs last-resort since 2026-10-21).

## 1. The four access items (all user-side)

| # | Item | How the user provides it | Secret policy |
|---|------|--------------------------|---------------|
| 1 | VM public IP | in chat | not a secret |
| 2 | SSH key confirm | answer: "was the provided public key used at VM creation?" (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOUSJzTtcy3RTZKw6ih122kHiCFGEiFy8Xw2eRGEQcNj oracle-a1-deploy`) | not a secret |
| 3 | n8n URL + login | URL in chat; **password only via secure entry card**, never chat | handled via vault/card |
| 4 | HF_TOKEN | user puts it in the server `.env` themselves, OR hands it via secure entry card at deploy time so the script can write it | **never in chat** |

### Decision tree on item 2 — SUPERSEDED by §0 (2026-11-13): the user's own
key works; `oracle-a1` does NOT log in. Kept below for reference only.

- **"Haan, key use ki thi"** → the private key at
  `~/workspace/user/ssh-keys/oracle-a1` already works. Assistant SSHes in and
  deploys. Nothing more needed from the user.
- **"Nahi / pata nahi"** → user runs ONE command in their own SSH session:
  `echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOUSJzTtcy3RTZKw6ih122kHiCFGEiFy8Xw2eRGEQcNj oracle-a1-deploy' >> ~/.ssh/authorized_keys`
  Then the assistant can deploy. (Reversible: remove the line later.)

Oracle console access stays **as previously agreed**: only when needed
(e.g. opening 80/443/22 in the VCN security list — a step the script cannot
do and will flag, see §5).

## 2. How the deploy runs

Script: `deploy/assistant-deploy.sh` (idempotent — safe to re-run).

```
VM_IP=… DOMAIN=… ACME_EMAIL=… HF_TOKEN=… ./deploy/assistant-deploy.sh deploy
```

What it does, in order:

1. **Pre-flight** — SSH reachable; Ubuntu; aarch64; warns if <8 GB RAM
   (the A1 spec is 2 OCPU / 12 GB — fine) or low disk.
2. **Docker + ufw** — installs Docker CE + compose plugin if missing;
   ufw: deny incoming except 22/80/443.
3. **Code sync** — rsync this repo to `/opt/product-video-platform`
   (excludes node_modules, .git, .next, storage, .env).
4. **`.env` generation** — all random secrets (`POSTGRES_PASSWORD`,
   `N8N_ENCRYPTION_KEY`, `N8N_WEBHOOK_SECRET`, basic-auth password) are
   generated with `openssl rand` **on the operator side and written over
   SSH without echo**; `HF_TOKEN` comes from the environment only. The
   n8n editor basic-auth password is printed **once** — save it for the user.
5. **`docker compose up -d --build`** — pulls postgres:16-alpine,
   redis:7-alpine, n8nio/n8n:1-latest, caddy:2-alpine; builds app + worker.
6. **Migrations** — `prisma migrate deploy` (never `migrate dev`).
7. **Verify** — caption font present in worker; `GET /api/v1/health`;
   `GET /api/v1/providers` (free stack should show edge-tts/pollinations
   available, HF configured).
8. **n8n workflows** — imported via n8n API if `N8N_API_KEY` is set;
   otherwise prints the exact 2-minute manual steps.

Pre-DNS mode: set `DOMAIN=$VM_IP` — Caddy serves plain HTTP so the API can
be smoke-tested before the domain points at the VM. Caveat: `n8n.<IP>` is
not a valid host, so the compose n8n editor is then reachable only via
`ssh -L 5678:localhost:5678 ubuntu@<ip>` (DEPLOY.md §7 alternative).

## 3. The n8n fork — one decision before deploy

The user already runs **n8n standalone on the VM** (with the v2.0.0 main
workflow, error workflow, and possibly the mock backend). The compose stack
ships its **own** n8n service (postgres-backed, `N8N_ENCRYPTION_KEY`
stable, editor behind basic-auth on `n8n.<DOMAIN>`).

**Recommended: move n8n into compose** (single stack, single owner,
survives reboots, one place to update). Migration is cheap because the
canonical workflow files live in this repo:

1. In the user's current n8n: **each workflow → ⋯ → Download** (safety copy
   of any tweaks, e.g. BACKEND_URL env, credentials).
2. Stop the standalone n8n on the VM after the compose one is verified.
3. Import `n8n/workflows/main-workflow.json` + `error-workflow.json` into
   the compose n8n; re-create the Header Auth credential
   `backend-callback-secret` (`x-n8n-secret` = `N8N_WEBHOOK_SECRET` from the
   server `.env`); activate both.

Alternative (keep standalone n8n): deploy only app/worker/postgres/redis +
Caddy pointing at the host's n8n — this splits ownership and is NOT covered
by the script. Prefer the compose path unless the user objects.

## 4. Later changes (the "baad me changes" promise)

```
./deploy/assistant-deploy.sh update
```

rsync → rebuild app + worker → `prisma migrate deploy` → restart. No `.env`
rewrite, no data loss (postgres/redis volumes persist). Typical changes the
user has mentioned or will likely want:

- Prompt / preset tweaks (`src/lib/pipeline/*`, `premium_dark` style)
- n8n workflow edits (re-import the JSON, re-activate)
- New provider adapter (e.g. the unbuilt FreeLLMAPI experimental tier —
  still **not started** until the user says go)

## 5. Things the assistant cannot do (user-side, flagged not hidden)

- **Oracle VCN security list**: ingress rules for 80/443/22 (console).
  The script warns every run.
- **DNS A-records**: `videos.example.com` + `n8n.videos.example.com` → VM IP
  (or a free DuckDNS-style domain — see
  `docs/deploy-prep-checklist.md` §3).
- **n8n owner account + API key**: created once in the n8n UI.
- **HF_TOKEN**: user-side, always (see §1).

## 6. Verification checklist ("done" = all green)

- [ ] `https://videos.example.com/api/v1/health` → `ok: true`,
      postgres + redis healthy
- [ ] `/api/v1/providers` → edge-tts/pollinations available, HF configured
- [ ] A real job runs end-to-end → downloadable `final.mp4`
      (1080×1920, 30fps, burned-in captions, no music/prices/fake claims)
- [ ] `https://n8n.videos.example.com` asks for basic-auth; both workflows
      active; test webhook → job → COMPLETED
- [ ] `sudo ufw status` shows only 22/80/443; compose `ps` all healthy

## 7. Rollback

- Config mistake: fix `.env` on the server, `docker compose up -d app worker`.
- Bad build: `docker compose up -d --build app worker` from the previous
  rsync (keep a `releases/` copy if you want true rollback — future work).
- Data: postgres volume `pgdata` + `OPS.md` backup procedure before any
  risky change.
