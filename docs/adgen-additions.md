# AdGen additions (2026-10-25, user-approved after pitch-first)

Source analysis: `Rakshath66/AdGen` (Next.js demo: Puppeteer scrape ->
GPT-4 script -> Remotion browser render, landscape 15s) and the
`github.com/topics/sponsored-ads` listing (only 2 repos exist under that
topic). Our pipeline already exceeds AdGen on free providers, compliance,
Hinglish, captions, QA, 9:16, and automation — so "the whole skill" was
adopted as 4 portable kernels, NOT a copy-paste. Rejected with reasons
told to the user: the Remotion engine swap (our FFmpeg renderer is more
automation-friendly and Remotion has no voiceover/captions/QA story),
the GPT-4 script path (paid, and it puts prices in scripts), and the
Facebook-Ad-Blocker repo (it hides sponsored posts — the opposite of
our use case).

## 1. Live product scraping — `src/lib/pipeline/product-scrape.ts`

`scrapeProductPage(url)` / `extractProductFacts(html, baseUrl)`:
OpenGraph tags, `<title>`, meta description, JSON-LD Product blocks,
and `<img>` gallery -> {title, description, images (<=10, deduped,
absolute), features, brand, sourceUrl, warnings}. The output type has
NO price field, and `stripPriceMentions()` removes price/offer text
from scraped titles/descriptions/features at extraction (JSON-LD
`offers` are ignored entirely). SSRF guard mirrors the job schema:
http(s) only, loopback/private/link-local/metadata hosts rejected
before any fetch; 15s timeout, 2 MB cap, browser UA.

Status: module + tests ONLY (15/15). It is NOT yet wired into job
creation — the research stage is still simulated (see worker.ts), so
there is no live facts pipeline to plug it into yet. Wiring it into
job creation (URL in -> scraped facts -> research row) is the explicit
next step, not something to pretend is done.

## 2. Visual direction — script extras -> storyboard -> camera

- Script prompt asks for an optional per-scene `visualDirection`
  {transitionIn, transitionOut, cameraNote, colorNote} and at most one
  `comparison` {leftLabel, rightLabel} scene. Parsed in
  `toScriptObject` (price-checked, length-capped) into `ScriptExtras`.
- `StoryboardSceneSchema` gains optional `visualDirection` +
  `comparison`. A comparison-flagged scene's purpose becomes
  `"comparison"`.
- `templateForDirection(text, premiumDark)` in camera-templates.ts
  keyword-maps direction text to a real template (orbit/macro/swoop/
  rise/zoom/pullback/pan); null falls back to the purpose template.
- storyboard.ts: direction steers the camera template; the note is
  appended to motionGraphicsNotes. colorNote is recorded only — it is
  NOT injected into image prompts (it would fight the style preset's
  own accent logic).

## 3. Comparison scene — split-screen wipe

- `animateComparison(left, right, opts)` in
  `src/lib/providers/ffmpeg-motion.ts`: the right image's right half
  slides in from the right edge over 1.5s with a white divider tracking
  it, ending in a clean 50/50 hold with corner labels. (ffmpeg `crop`
  w/h cannot animate per-frame, so the sweep is an overlay-x animation
  — the only per-frame-safe way to move a boundary.)
- `visuals.ts`: comparison scenes generate a SECOND still (right-side
  prompt); `animateSceneVideos` routes them to `animateComparison`,
  skipping AI-video tiers. A failed right still falls back to a
  single-image scene and records `note` on the SceneVideo — a
  comparison is never faked from one image.
- Verified visually: mid-wipe frame shows the divider sweeping,
  end frame is a clean 50/50 split with labels. Tests: 5/5
  (test-comparison.ts).

## 4. LLM-judge eval gate — `src/lib/pipeline/llm-judge.ts`

Runs ONLY on NEEDS_REVIEW jobs, inside `runQualityAssuranceStage`'s
NEEDS_REVIEW branch, after the deterministic verdict. Opinions:
`confirm_flag` (flag looks right + rationale + suggested fix) or
`escalate_reject` (clear violation found) — both only enrich the
review note and emit a `qa_judge` event. The judge NEVER changes the
outcome: it cannot approve, fail, or un-park a job (the type system
forbids "approve"; garbage/provider failure maps to `unavailable`).
One short call per flagged job; disable with `QA_LLM_JUDGE=off`.
Tests: 5/5 (test-llm-judge.ts), including "approve" output rejected.

## Verification (2026-10-25)

New suites: product-scrape 15/15, visual-direction 13/13,
comparison 5/5, llm-judge 5/5. All 15 prior suites pass, tsc clean,
eslint clean on touched files, production build green.
