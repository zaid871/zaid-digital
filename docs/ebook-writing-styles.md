# Ebook writing styles

Two writing styles transferred from YouTube creators into the ebook
generator (`src/lib/digital/ebook.ts`, `writingStyleNotes()`), wired
through `POST /api/v1/digital/ebooks` (`writingStyle` field) and the
`digital-ebook-generation` n8n workflow (validate-input allowlist).
The style is recorded in the ebook manifest (`writingStyle`).

Analyzed 2026-11-18 (full transcripts read):
- Vaibhav Kadnar — "Atomic Habits in 24 Minutes" (690 segments, Hindi)
- Saqlain Khan — "Why 99.6% of you will never be RICH | The Education
  Trap (documentary)" (474 segments, Hindi)

## `standard` (default)

Plain practical teaching — the behaviour before this change. Nothing
extra is added to the prompts. The auto-generate tick does not send a
style, so scheduled ebooks stay `standard` unless a brief or caller
passes one explicitly.

## `kadnar` — practical explainer (Vaibhav Kadnar)

What it is: Gen Z finance/self-improvement explainer — book summaries
(Atomic Habits, 48 Laws of Power, Rich Dad Poor Dad) and student money
ideas, in Hinglish, direct "you" address.

Devices transferred:
- **Mirror-hook** — open by mirroring the reader's own struggle with
  a direct second-person question, then reframe the problem (it is the
  system/method, not motivation).
- **Three-part structure** — (1) big ideas that change how the reader
  thinks, (2) practical steps to start today, (3) lessons/takeaways.
- **One vivid analogy per idea** — e.g. a pilot turning 3.5° and
  landing in Jaipur instead of Delhi; a bamboo tree invisible for 5
  years, then 90 feet in 6 weeks; 1% better = 37x in a year.
- **Personal proof voice** — adapted honestly (see below).

Fits: most ebook topics — money, habits, business, study, planning.

## `saqlain` — documentary narrative (Saqlain Khan)

What it is: long-form documentary — a system or trap is exposed
through story, history, and evidence (Education Trap 6.1M views,
stock market, Partition, IPL, AI takeover).

Devices transferred:
- **Riddle-hook** — open with famous names + "what do they have in
  common?" — the answer is not wealth, it is escaping a trap.
- **Lived second-person narrative** — walk the reader through the
  experience of the problem (e.g. a graduate's 12-year journey:
  degree, no job, rejections, loans, dreams suppressed).
- **Reveal + history** — "the truth is something else" → how the
  system was built (e.g. Prussian system 1806, Macaulay/Bentinck
  1835).
- **Evidence chapter, then solution** — what the numbers show, then
  what the reader can do now.

Fits: "system/trap expose" topics only (education trap, money traps,
trading, etc.) — not every topic.

## Honest adaptations (not copies)

- **Kadnar's "personal lessons I implemented"** becomes lessons and
  takeaways as principles. The style instructions explicitly forbid
  inventing personal stories, life events, or "I did this" claims —
  an AI-written ebook has no life to draw on, and fake biography is
  a fake claim.
- **Saqlain's documentary relies on cited sources**, which this
  system does not have. The style carries a hard guardrail: NEVER
  invent statistics, dates, quotes, names, or historical details —
  if unsure, describe the pattern in general terms or leave it out.
  (The compliance scan already bans invented statistics; the style
  note reinforces it.)
- The style is **structural, not language-bound** — the same devices
  work in English ebooks (international) and Hinglish ebooks alike.
  Language stays a separate field.

## What did NOT transfer

- Kadnar's "dark manipulation techniques" / "MASTER MANIPULATOR"
  angle — manipulation content, against the ethical-copy rule.
- Kadnar's crypto sponsorships and paid promotions.
- Saqlain's sensational topics (e.g. "Suicide Factory") and his
  viral/revenue claims (unverified here).
- Neither creator's voice, likeness, or exact wording — only the
  structural devices, reworded as prompt instructions.

## How to use

API: `POST /api/v1/digital/ebooks` with
`{"topic": "...", "writingStyle": "kadnar" | "saqlain"}`.
Workflow: `digital-ebook-generation` passes `writingStyle` through
from the webhook body. Auto-generated ebooks default to `standard`.
