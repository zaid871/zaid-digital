# OpenAI-compatible chat completions over the hub

Source video: Astro K Joseph, "Build Your Own Private AI API Server in 10
Minutes ($0)", 13m16s, uploaded 2026-11-15, 9,947 views —
https://www.youtube.com/watch?v=kCJGynurn3E

## What the video does

One install script sets up, on a VPS: Docker + Ollama (Qwen 3.5 4B, any open
model) + LiteLLM as an OpenAI-compatible API gateway (own API keys,
PostgreSQL, HTTPS public endpoint). Then Claude Code builds a Next.js
ChatGPT-like app (streaming, reasoning/thinking display, image + PDF/docx
upload) pointed at that API. "$0" means no per-token fees — the VPS itself
is paid (Hostinger KVM 4 recommended in the video, affiliate link + coupons).

## What transferred, and what did not

| Video idea | Verdict |
|---|---|
| Own OpenAI-compatible API (any app plugs in) | **BUILT** — this endpoint |
| LiteLLM as the gateway | **Not as a container** — the shim below reuses the hub instead (see §7 of docs/unified-hub.md: LiteLLM is a router, not a brain) |
| Ollama local model on our VM | **No** — VM is CPU-only (2 OCPU). The video itself admits ~56s per answer with reasoning on a CPU VPS; a 4B model would eat ~3GB of the ~3.5–4GB spare RAM while renders already peak at 7.5–8.5GB. Groq/Gemini free legs stay the inference path |
| Paid Hostinger VPS | **No** — free-first; the Oracle Always Free VM already hosts this backend |
| One-script installer | **Not needed** — Docker Compose already does this |
| Claude Code app build | **Not needed** — dashboard + Muse free plan already exist |

## Endpoint

```
POST /api/v1/chat/completions
GET  /api/v1/chat/completions   (model list, OpenAI /v1/models shape)
```

Any OpenAI-compatible client:

```
base_url: https://<vm-ip-or-domain>/api/v1/chat
api_key:  $CHAT_API_KEY (or $N8N_WEBHOOK_SECRET as fallback)
model:    "hub" (default) or "hub-fast"
```

Request (OpenAI shape):

```json
{
  "model": "hub",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello, who are you?" }
  ],
  "stream": false
}
```

```bash
curl -s https://<vm>/api/v1/chat/completions \
  -H "Authorization: Bearer $CHAT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"hub","messages":[{"role":"user","content":"Ek accha sa caption likho"}]}'
```

Response (OpenAI shape — never the v1 envelope):

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1763380000,
  "model": "hub",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 12, "completion_tokens": 40, "total_tokens": 52 }
}
```

## Models

- `hub` — parallel ensemble over the live free legs (Groq gpt-oss-120b +
  qwen3.8-27b + gpt-oss-20b + Gemini flash), merged by one synthesis call.
  Same run as `POST /api/v1/hub/run` with kind `chat`, mode `ensemble` —
  quota guard, compliance scan and ledger all apply.
- `hub-fast` — single fast leg (Groq gpt-oss-20b). Lowest latency, no
  ensemble merge. Same as kind `chat`, mode `single`.

Unknown model → HTTP 400 `model_not_found` with the supported list.

## Honest limits

- **Text only.** No vision, no audio, no function calling, no logprobs.
- **`stream: true` arrives as ONE SSE chunk.** The ensemble merges all legs
  before responding, so there is nothing to stream token by token. Clients
  get valid SSE (`data: {...chunk...}` then `data: [DONE]`), just not
  incremental.
- **`usage` is an estimate** (chars / 4, rounded up). No tokenizer runs on
  the VM, so these are not measured tokens.
- **Compliance scan applies.** An answer tripping the price / banned-claim
  patterns fails with `compliance_rejected` (HTTP 400 here), same as any
  hub text run.
- **Auth:** `Authorization: Bearer <key>` where key is `CHAT_API_KEY`, else
  `N8N_WEBHOOK_SECRET`. Both unset → HTTP 501 `not_configured`, never open.
- **Errors are OpenAI-shaped** (`{error: {message, type, code}}`):
  401 invalid key, 400 validation / unknown model / compliance, 429 quota,
  502 hub failure, 503 legs unavailable.

## Files

- `src/lib/hub/chat-compat.ts` — the shim (messages→prompt, auth, OpenAI
  shape, SSE). Route is a thin wrapper.
- `src/app/api/v1/chat/completions/route.ts` — POST + GET.
- `scripts/test-chat-compat.ts` — **28/28** with a fake caller (no live
  keys): shape, auth, model mapping, validation, SSE format, compliance
  passthrough, not-configured 501.

## Not live-tested

A real ensemble answer through this endpoint (needs the VM + GROQ/GEMINI
keys + backend redeploy). Verify at deploy with the curl above, then
confirm the run appears in `GET /api/v1/hub/run` (ledger).
