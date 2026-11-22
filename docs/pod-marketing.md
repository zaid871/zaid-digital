# Nishkarsh Sharma POD playbook — transfer notes

Channel: https://www.youtube.com/@nishkarshsharmaa — Indian entrepreneur
(dropshipping ₹50 Cr claimed, clothing brand Kalmin Ross exited 2024,
PODHouse / Ecom Edge education). Analyzed 2026-11-16.

Sources read in full:
- Blog: https://www.nishkarshsharma.com/blog/print-on-demand-india
  ("Print on Demand India: How to Start in 2026")
- Video transcript: "Indian Print on-Demand Masterclass for Beginners
  2025 (in Hindi)" (836 segments, Hindi)
- Video transcript: "How To Do Design Research For Print on Demand
  From India (in Hindi)" (798 segments, Hindi)
- Channel page (recent: "Best Print On Demand Suppliers In India 2026",
  "Starting a Clothing Brand In 2027 is Simple, Actually (FREE COURSE)",
  "How To Sell T-Shirts in India With Print on Demand (2,00,000 Sold)")

## What transferred into the system (built 2026-11-16)

### 1. E2S design filter — `src/lib/digital/pod-design.ts` (scoreE2S)
His design-research formula for shortlisting designs:
- **E — Easy to read and understand.** The design text must be short
  and clear; if you can't read what it says, you can't sell it.
- **2 — Two to three words.** A quote or 2-3 words sells better than
  a single word or a sentence.
- **S — Specific.** Looking at the design you must know WHO wears it
  (fishing, teachers, gym) — the wearer must be identifiable.
Score 0-6; pass = ≥4 AND no dimension 0. Graphic-only designs score
neutral (1) on E and 2 and carry a "human visual check" warning.
Wired as a gate in `generatePodDesign` (src/lib/digital/pod.ts)
BEFORE any image is generated — a failing brief throws
`validation_error` (422) and costs no AI quota. E2S result is stored
in the design manifest.

### 2. Niche rule — specific BUT broad (inside scoreE2S, S dimension)
Too tiny ("Delhi fathers with five daughters", ~100-400 people) has
no buyers; "everyone" ("cool", "funny", "everyone") has no buyer
either. The S dimension fails niches made only of generic words.
Niche discovery via Amazon bestseller listings (search "t-shirts",
read listings, note the niches) is the method — the system already
has Amazon Suggest + Etsy bestsellers (src/lib/digital/etsy.ts), so
no new discovery source was built; the RULE is what was missing.

### 3. Square mockups — `mockup-square.png` (pod.ts)
His point: mockups improve conversions; his workflow builds 1080x1080
square mockups in Canva for the product page. The pipeline already
made a flat portrait mockup (1080x1350); it now also produces a
1080x1080 square variant for the storefront + Pinterest pins.
Both are honest flat composites, not lifestyle mockups.

### 4. POD pricing guide — `podPricingGuide()` (pod-design.ts)
India (his published 2026 numbers): base ₹350-450 (Qikink, print +
ship), sell ₹800-1200 sweet spot, start ₹799, settle ₹899 after
proof, 4XL bump +₹50-100 (₹949-999), margin before ads ₹350-800.
International: $25 start (existing Printify default); Printify base
cost varies by provider, so it is verified at draft time, never
invented here.

### 5. Supplier ladder — `supplierLadder()` (pod-design.ts)
Stage 0: Printify draft (start, no inventory). Stage 1 at 10 sales:
proven, watch for graduation. Stage 2 at 50 sales: review for a
private supplier (Qikink in India — better margins, faster
delivery). Stage 2 is a MANUAL step (supplier account + terms first);
there is no automatic ordering in this system.

## What did NOT transfer (and why)

- **Minea (ad-spy tool)** — paid. The principle transferred instead:
  sell PROVEN designs only (ads with 3,000-10,000 likes = proven;
  type/theme/sentiment; Shops section best-sellers; last-24h
  products; Europe trends arrive in India 6-18 months later).
  The system already covers this with Etsy bestsellers + Problem
  Miner; no paid tool was added.
- **Meta Ads** — paid. His core traffic source (10 ad sets, 1
  campaign, same creative, 7-10 days, cut losers, scale winners)
  is rejected free-first. The PRINCIPLE (test many angles, cut
  losers fast, scale winners) was already built: goal-loop,
  beat-the-top, flywheel winner-3x, campaign pace escalation.
- **Shopify** — paid storefront. The user's Next.js storefront
  already does this job.
- **Qikink** — India-only supplier, no API in this system. The
  system uses Printify (international). Qikink appears only as the
  stage-2 ladder target, manual.
- **₹1500 compare-at price** — fake discount (show ₹1500, sell
  ₹799/899). Excluded by the Shariah-compliant rule: a
  struck-through price that was never charged is a fake discount.
  `compareAt` is hardcoded `null` in the pricing guide.
- **₹75,000-80,000 starting capital / ₹10,000-15,000 ad test budget**
  — ad spend, not a system build.
- **Paid mentorship (PODHouse / POD Powerhouse)** — not transferable.
- **Comment "POD" / "MAKE" / "4CR" DM funnels** — already built:
  the user's Auto-DM loop (comment keyword → DM with link) does
  exactly this; his heavy use of it is validation, not a new build.

## Honest caveats

- Revenue claims are the creator's own and unverified here: ₹50 Cr
  dropshipping, ₹50 Cr printed t-shirts since 2017, 15-30% margins,
  students ₹60-120 Cr combined, Mukul ₹20 Cr, Priyank ₹3.5 Cr/year.
  None of these were independently verified; the transfer is of
  METHODS, not of the numbers.
- His playbook is INDIA-focused (₹ pricing, Qikink, Meta Ads India).
  The user's system targets INTERNATIONAL (decided 2026-11-16), so
  the India numbers live in the `market: "in"` guide only; the
  international path keeps Printify + $25.
- The E2S gate is a heuristic on the brief (niche + designText),
  not on the rendered image — a graphic-only design still needs a
  human visual check, flagged as a warning.
