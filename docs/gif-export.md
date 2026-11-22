# GIF Export (opt-in only)

> Built 2026-11-08. Default: OFF — har video ka GIF nahi banta. Sirf tab
> banta hai jab request me saaf likha ho.

## Trigger — 2 tareeke

1. **Hub prompt:** video prompt me bazabta likha ho — `gif banao`,
   `make a gif`, `gif version chahiye`, `gif me convert karo`.
   Hub (`POST /api/v1/hub/run`, kind `video`) ye pehchan kar job
   payload me `gif: true` laga deta hai.
2. **Direct job API:** `POST /api/v1/jobs` body me `"gif": true`.

Sirf "gif" word ka zikr kaafi nahi (`gif jaisa effect` → no GIF), aur
mana karna jeet jata hai (`bina gif ke`, `gif nahi chahiye` → no GIF).

## Kya banta hai

- Delivery stage me, `final.mp4` verify hone ke baad, usi MP4 se
  FFmpeg two-pass (palettegen → paletteuse) GIF banta hai:
  `preview.gif`, storage key `<jobId>/preview.gif`.
- Defaults (naape hue, grainy Premium Dark demo par): **pehle 3 second,
  480px wide (853 high), 8 fps — ~6.6 MB**. Clean product footage par
  ~1–3 MB. Tune karein: `GIF_WIDTH`, `GIF_FPS`, `GIF_SECONDS` (.env).
- Download: `GET /api/v1/jobs/:id/download?key=<jobId>/preview.gif`
  (content-type `image/gif`). `FinalVideo.gifKey` aur ek
  `MediaAsset` row (`assetType: gif_preview`) bhi banti hai.

## Imaandaar limits

- GIF me sirf **256 colors** — Premium Dark gradients/rim light me
  banding dikhega; MP4 jaisa smooth nahi.
- GIF **silent** hota hai — voiceover nahi aata.
- GIF **Reels/Shorts par upload nahi hota** — ye website embed,
  WhatsApp/Telegram aur email ke liye hai.
- GIF fail ho jaye to video phir bhi deliver hota hai — GIF step
  failure-tolerant hai (warning + `gif_failed` event, delivery
  `COMPLETED` hoti hai).

## Files

- `src/lib/pipeline/gif.ts` — `wantsGif()` + `renderGif()` (+ `GifError`)
- `src/lib/pipeline/delivery.ts` — GIF step (final.mp4 ke baad)
- `src/lib/schemas.ts` — `createJobSchema.gif`
- `src/lib/job-service.ts` — `Job.gifRequested` persist + serialize
- `src/lib/hub/engines.ts` — prompt detection → `jobPayload.gif`
- `prisma/schema.prisma` + `prisma/migrations/20261108200000_add_gif/migration.sql`
  — `Job.gifRequested`, `FinalVideo.gifKey` (deploy par
  `prisma migrate deploy` se lagega)
- `scripts/test-gif.ts` — **30/30** (detection 15, schema 3, real FFmpeg
  conversion demo MP4 par 11, missing-input 1)

## Deploy checklist

1. `prisma migrate deploy` (migration upar wali).
2. Ek real job `gif: true` ke saath chalakar dekhein — GIF live
   verify abhi baaki hai (delivery wiring ko Postgres chahiye; yahan
   sirf conversion + hub wiring live-probe hue hain, tsc/eslint/build
   green hain).
