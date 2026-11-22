# ads-generator additions (2026-10-25, user chose 2 of 3 pitched items)

Source analysis: `github.com/topics/ads-generator` holds only 2 repos —
`anuragverma4895/AI-Short-Video-Ads-Generator` (product + model photo ->
Gemini lifestyle image -> Veo UGC video) and `HeaPheng/AdCraftAI`
(Next.js ad-copy SaaS: per-platform prompt pack + Gemini model
fallback + zod validation). Pitched 3 items; the user picked
"caption pack + Gemini fallback" and left the lifestyle composite out.

## 1. Caption pack — `src/lib/pipeline/caption-pack.ts`

`generateCaptionPack({productName, features, productCategory, tone})`
over the script provider chain: one call -> {instagram, facebook,
headlines[3 angles: benefit/curiosity/quality], seoDescription,
seoKeywords, hashtags}. Feeds IG/FB publishing captions and website
catalogue SEO fields.

Compliance, adapted (not copied): every field is scanned with
PRICE_PATTERN + BANNED_CLAIM_PATTERN; a violating field is DROPPED
(null / removed) with a warning. AdCraftAI's silent per-field
fallback copy was rejected — its fallbacks include banned claims
("The #1 Choice") and generic fabricated lines. Unparseable output
is a hard error, never a quiet fallback.

Status: module + tests ONLY (11/11). Not yet wired into the
publishing workflows (they take captions from the payload) — wiring
is the explicit next step, same as the product-scrape module.

## 2. Gemini model fallback — `src/lib/providers/gemini.ts`

`modelFallbackList()`: requested model (or env/default
`gemini-2.0-flash`) first, then `gemini-2.5-flash-lite`,
`gemini-2.5-flash`, `gemini-2.0-flash`. On a 429 the adapter moves to
the next model immediately instead of burning retries on an
exhausted one; other errors get one retry per model. Override the
tail with `GEMINI_MODELS="a,b"`. 2.5-pro deliberately left out —
its free-tier quota is far smaller than the flash models'. Live
immediately for every Gemini call (script, judge, ebook).

## 3. Fixed during this build: BANNED_CLAIM_PATTERN missed "#1"

The old pattern wrapped `#1` in `\b...\b`, but `#` is a non-word
character, so a standalone "#1" (after a space) never matched.
Fixed in `src/lib/compliance.ts`: `#1` now matches via a separate
`#\s?1\b` alternative. This only ADDS detections; all prior suites
still pass. The caption-pack tests caught it (a "#1 choice"
headline was not being dropped).

## NOT built (user's choice)

Lifestyle composite (model + product natural image) from repo 1 —
needs a user-supplied model photo + a Gemini image-model leg, and
carries the fake-endorsement compliance risk. Revisit only if the
user asks. Also rejected outright: Veo video (paid), SaaS
scaffolding (Clerk/plans/Cloudinary), silent fallback copy.

## Verification (2026-10-25)

New: caption-pack 11/11, gemini-fallback 11/11. All 19 prior suites
pass, tsc clean, eslint clean on touched files, build green.
