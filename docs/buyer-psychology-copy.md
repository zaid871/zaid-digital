# Buyer-psychology copy patterns (ethical edition)

Built 2026-11-12 (user: "Haan, buyer-psychology copy patterns add karo").
Source: Ayan Aarfi's psychological marketing (2026-11-12 analysis,
`~/memory/people/ayan-aarfi.md`) — buyer-psychology landing pages, DFY
psychological copywriting swipe file, nurture funnels. His techniques
are kept; his deceptions are NOT.

## The 6 patterns

All six work only on verified facts. Psychology serves clarity and
trust, never pressure.

| # | Pattern | What it does |
|---|---------|--------------|
| 1 | Value first | Outcome/transformation before features — pehle fayda, phir feature. |
| 2 | Trust from verified facts only | Trust from verifiable facts/process; never invented testimonials, ratings, buyer counts. |
| 3 | Objection handling | Answer the buyer's likeliest doubt plainly (beginner? how to use? what's inside?). |
| 4 | Honest risk reversal | Lower perceived risk by being clear about what is included and what it does NOT do. No guaranteed outcomes. |
| 5 | 10-second clarity | In 10 seconds: what it is, who it is for, what problem it solves. |
| 6 | Verified specificity | Concrete verified specifics over vague superlatives; numbers only if verified. |

## Banned tricks (scanned out, never softened)

- **Fake urgency** — "limited time", "only today", "hurry", "before midnight", "price goes up".
- **Fake scarcity** — "only 3 left", "almost sold out", "selling fast" (digital products have no stock, so always banned).
- **Invented social proof** — fake buyer counts ("10,000+ happy customers"), fake testimonials.
- **Guaranteed outcomes** — "guaranteed results", "100% success", earnings promises.
- **False superlatives** — "#1", "number one", "best in India", "sab se best".

## Wiring

- `src/lib/digital/buyer-psychology.ts` — pattern list
  (`BUYER_PSYCHOLOGY_PATTERNS`), banned list
  (`BANNED_PSYCHOLOGY_PATTERNS`), `scanPsychologyViolations()` /
  `violatesPsychology()`, prompt sections
  (`SALES_COPY_PSYCHOLOGY_LINES`, `SCRIPT_PSYCHOLOGY_LINES`).
- `src/lib/digital/sales-copy.ts` — prompt carries the 6 patterns; three
  new output fields, all compliance-scanned like the rest (violating
  field dropped with a warning, never replaced):
  - `trustLine` — one trust line from verified facts only.
  - `objectionAnswers` — up to 4 "Q: ... A: ..." plain honest answers.
  - `riskNote` — what is included and what it does NOT do, honestly.
  - New fields are OPTIONAL in the schema so older model outputs still
    parse (backward compatible).
- `src/lib/pipeline/script.ts` — `buildScriptPrompt` carries the compact
  psychology section for ALL styles (numbered, brand_story, macro_hero,
  banner_unroll, attar_luxury, standard): hook with value first, one
  trust line from verified facts, one objection answered in a middle
  scene, simple honest closing. No new scenes, no output-shape change.

## Verification (2026-11-12)

- `scripts/test-buyer-psychology.ts` — **27/27** (pattern list, all 5
  banned ids caught, clean copy passes, prompt sections).
- `scripts/test-digital-sales-copy.ts` — **16/16** (old fixtures still
  pass; new psychology fields kept on clean input; psychology-only
  violations — fake urgency / fake scarcity / false superlative that
  the base PRICE/BANNED patterns miss — dropped with warnings).
- `scripts/test-script-style.ts` — **63/63** (prompt change broke no
  script style).
- `tsc --noEmit` clean, eslint clean on all touched files.

## Honest limits

- Prompt guidance is not a guarantee — the model can still ignore it.
  The scanner is the enforcement: a violating field is dropped, never
  shipped.
- The scanner is regex-based: it catches known phrasings, not every
  possible wording of a trick. QA re-scan + human review remain the
  backstop.
- NOT live-tested end to end: no full sales-copy or video job has run
  with the new patterns yet (needs deploy + live text generation).
- NOT built: the second Ayan transferable — recurring-commission signal
  in affiliate discovery scoring (still pending the user's pick).
