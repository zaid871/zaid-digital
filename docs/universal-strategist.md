# Universal Marketing Strategist (2026-11-03)

User ka vision: marketing workflow itna advanced ho ki KISI BHI product par,
KISI BHI market me sales la sake — aur kal ko agency kholni ho to yehi
workflow pura kaam sambhale.

## Imaandaar boundary

Demand ZERO ho to koi marketing sales nahi la sakti — marketing demand
banati nahi, DHOONDti hai. Is engine ka wada: jahan demand ki gunjaish hai,
wahan tak pahunchne ka systematic tareeka; aur "perfect" ka matlab day-one
perfection nahi — playbook best-known strategy deta hai, goal-loop data se
prove/correct karta hai (convergence = "is se behtar option nahi").

## Kya banaya

**`src/lib/marketing/strategist.ts`** — strategy brain:
- **UniversalBrief** (zod): productName, client?, kind
  (digital_product/physical/affiliate/service), priceBand (low/mid/high),
  audience, marketBreadth (broad/niche/micro), goal (sales/leads),
  assets {hasVideo, hasLanding, hasEmail}, features[].
- **Playbook matrix** (deterministic — har tarah ki marketing knowledge encoded):
  - broad → reels/shorts volume game
  - niche → Pinterest search + communities + long-tail SEO (intent > reach)
  - micro → reddit/micro-influencer/partnerships ("100 true fans" math)
  - high-ticket/service → trust-first reorder (youtube/linkedin/email)
  - affiliate → buyer-intent SEO (reels traffic doesn't convert)
  - asset reality checks (no video/email/landing → honest reorder + warning)
- **5 stages**: validate (pre-sell gate, hamesha pehle) → launch (top-3
  channels, best-time slots) → amplify (goal-loop) → sustain (compounding:
  Pinterest/SEO) → retain (email).
- **LLM**: sirf 3 angles + 3 hooks (compliance-scanned); fail → structure intact.

**Endpoint**: `POST /api/v1/marketing/strategist/plan` (x-n8n-secret).

**n8n**: `digital-marketing-strategist.json` (7 nodes, webhook) — ek workflow,
har product, har client. `client` field → productKey "client:product" →
goal-loop ledger me alag tracking (agency-ready).

**Tang (narrow) market tactics** (playbook me): 90-10 value-first community
seeding (spam = ban), long-tail "[niche]+[use-case]" SEO, micro-influencer
free-product reviews, partnerships (revenue share), 20 hand-picked
prospects/week direct outreach.

## Verification

- test-strategist **18/18** (broad/niche/micro routing, trust reorder,
  affiliate warning, client namespace, LLM-fail graceful, brief validation).
- tsc/eslint clean. Zip: 11 workflows + README.
