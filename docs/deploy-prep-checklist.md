# Deploy-prep checklist — product-video-platform

Sunday prep for a weekday deploy. Everything here is free; four steps
need the user in a browser (Oracle signup, domain, HF token, Groq/Gemini keys).

## 1. Oracle Cloud account (~15 min, user-side)

- Sign up at oracle.com/cloud/free ("Start for free").
- **Card needed for identity verification:** a valid international
  credit/debit card. Oracle places a ~$1 temporary hold and reverses it —
  never charged if you stay on Always Free. Indian debit cards often fail
  this check; a Wise/Niyo-style international card works more reliably.
- Phone SMS verification follows; tenancy name can't be renamed later.
- **Home region can't be changed** — pick carefully (ap-mumbai-1 or a
  region with Ampere capacity; if the VM step says "out of host capacity",
  retry in another availability domain or region).
- Current Always Free quota (post-June-2026): **2 OCPU / 12 GB RAM total
  per tenancy, shared across max 2 instances** + 2x AMD E2.1.Micro (1 GB)
  + 200 GB total boot volume. You also get a 30-day $300 trial credit —
  it does NOT make an oversized instance permanently free.
- Do not upgrade the account to PAYG to fix capacity errors.

## 2. Create the VM (~5 min, user-side)

Compute → Instances → Create instance, check "Always Free-eligible":

| Setting | Value |
|---|---|
| Shape | VM.Standard.A1.Flex |
| OCPUs | 2 |
| Memory | 12 GB |
| Image | Canonical Ubuntu 24.04, ARM/AArch64 |
| Boot volume | 50 GB |
| Networking | Public subnet, assign public IPv4 |
| SSH keys | Generate & download (keep safe) |

- **Idle-reclaim watchout:** instances idle (<20% CPU over 7 days) can be
  reclaimed by Oracle. Keep DB/backups outside this server (OPS.md).
- First boot: `sudo apt update && sudo apt install -y docker.io
  docker-compose-plugin` (DEPLOY.md walkthrough continues from here).

## 3. Free domain for Caddy auto-HTTPS (~10 min, user-side)

Caddy needs a real DNS name pointing at the VM's public IP. Free options:

- **DuckDNS** (duckdns.org): free subdomain, wildcards resolve, and
  duckdns.org is on the Public Suffix List so Let's Encrypt issues certs
  for your subdomain without shared rate-limit problems. Sign in, create a
  name, point it at the VM IP. Renewal is required periodically.
- **afraid.org FreeDNS**: up to 5 free subdomains on their shared domains,
  DNS pointing is instant.

Point an A record at the VM's public IPv4, then DEPLOY.md's Caddy config
gets HTTPS automatically (HTTP-01 challenge).

## 4. HF_TOKEN (user-side) — now OPTIONAL, and NOT free by itself

**Update 2026-10-21:** Hugging Face removed free Inference Providers credits
for free accounts (verified on huggingface.co/docs). A free-account token
alone will NOT work — calls are billed per compute-second from the first
request. The HF legs now sit **last** in every fallback chain and are skipped
unless you add credits or PRO ($9/mo → $2/mo credits). The system works fully
without HF (Groq/Gemini/Pollinations/edge-tts cover all stages).

- Only needed if you WANT the HF legs active: create a fine-grained token at
  huggingface.co/settings/tokens with "Inference: Make calls to inference
  providers" permission, then add credits or PRO on your HF billing page.
- Enter it into the deploy-time `.env` as HF_TOKEN yourself — never paste
  it into chat. Leave it blank to run 100% free without HF.

## 5. Groq + Gemini keys (free, ~2 min each, user-side)

These are now the **1st and 2nd links** in the script-generation chain
(**Groq** → **Gemini** → Pollinations → HF) — they carry the script load since
HF went billed. Both free tiers need no credit card.

- **Groq:** create a free key at console.groq.com/keys → set as `GROQ_API_KEY`.
- **Gemini:** create a free key at aistudio.google.com/apikey → set as `GEMINI_API_KEY`.
- Enter both into the deploy-time `.env` yourself — never paste them into chat.
- Two honest notes: free-tier Gemini inputs may be used by Google for product
  improvement (only ad scripts go through, nothing sensitive), and since 2026
  Gemini keys are billing-tied — treat them as secrets like HF_TOKEN.

## 6. FreeLLMAPI: self-hosted only (no endpoint URL to wait for)

Correction (2026-10-13): FreeLLMAPI has **no hosted service** — freellmapi.co is
docs/catalog only. It runs as a self-hosted Docker service on the VM
(`http://freellmapi:3001/v1` from the app). At deploy time: add it as a compose
service, generate the unified key from its dashboard → set `FREELLMAPI_KEY` in
`.env` (never in chat). Full research in `docs/freellmapi-video-notes.md`.

The experimental FreeLLMAPI video adapter stays unbuilt until the user says go —
compose layout is now settled, so nothing is blocked on their side. Not blocking
deploy — default motion stays FFmpeg.

## Order of operations

1 → 2 → 3 → (then hand off: DEPLOY.md on the VM) → 4 + 5 at env setup → 6
whenever convenient.
