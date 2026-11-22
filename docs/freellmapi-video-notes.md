# FreeLLMAPI video — research notes (2026-10-13)

## Settled: self-hosted only, no hosted endpoint

FreeLLMAPI (tashfeenahmed/freellmapi) is a **self-hosted router you run yourself**.
`freellmapi.co` is docs + a live model catalog — **not** an API service. There is
no hosted endpoint URL for the user to hand over. The "hosted vs self-hosted"
question in the old deploy checklist is resolved: **self-hosted**.

Sources: canonical repo PR "feat(media): add catalog-routed video generation"
(https://github.com/tashfeenahmed/freellmapi/pull/998); API docs
(https://github.com/zex808/freellmapi/blob/HEAD/docs/api.md,
 https://github.com/lianbeast/freellmapi/blob/HEAD/docs/en/api/01-rest-api.md);
model page (https://freellmapi.co/model/agnes-video-2-0).

## Video API shape

- `POST {base}/v1/videos/generations`
- Auth: `Authorization: Bearer <unified freellmapi-... key>` (generated on the
  instance's dashboard → Keys page; user pastes it into `.env` as
  `FREELLMAPI_KEY` at deploy — never in chat)
- Body: `{ "prompt": str, "model": "auto" (default), "duration": s,
  "aspect_ratio": str (provider-dependent), "image": ..., "seed": ..., "audio": ... }`
- Response: **binary MP4** (completed video), with `X-Provider` / `X-Model` headers
- Backends: **Pollinations** and **Hugging Face (fal queue)** — the same underlying
  sources the platform already uses. Benefit is one key + routing/failover, not a
  new video source.
- Timeout: documented ~5-minute bound (`VIDEO_FETCH_TIMEOUT_MS`); provider not
  finished by then → HTTP 504. Adapter must treat 504 as "tier failed → fall back
  to ffmpeg-motion", never hang the job. (Re-verify against the exact version
  deployed; fork docs may drift from canonical.)
- Video models must be toggled on in the dashboard: **Models → Video** tab.
- Unlike images/speech, video does **not** accept custom OpenAI-compatible media
  endpoints.

## Deploy plan (Oracle VM)

Run as a 7th compose service on the same VM, default base URL from the app's
perspective: `http://freellmapi:3001` (env `FREELLMAPI_BASE_URL`, default that).
User generates the unified key from that instance's dashboard and sets
`FREELLMAPI_KEY` in `.env`. Note: the user's existing `freellmapi-...` key (if
from a local instance) belongs to that instance — a fresh key from the VM's
instance dashboard is the clean setup.

## Open verifications at adapter-build / deploy time

1. Does the chosen backend honor a 9:16 `aspect_ratio` (platform needs vertical
   1080x1920)? If not, adapter must letterbox/crop or skip the tier.
2. Confirm the 5-minute timeout / 504 behavior on the deployed version.
3. Confirm which video models are actually in the free catalog that week
   (catalog syncs twice daily; models rotate).
4. Keep the tier experimental + gated like hf-spaces-video Tier A, with automatic
   fallback to ffmpeg-motion Tier B (default motion stays FFmpeg, per the
   full-free constraint).
