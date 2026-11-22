# Fix My Itch Analysis (2026-11-05)

Source: https://razorpay.com/m/fix-my-itch/ — Razorpay ki crowdsourced
problem database: **10,000+ verified problems, 50,000+ logon se, AI-curated,
har problem ka "Itch Score"** (jitna zyada, utni badi takleef).

Correction: ye Razorpay ki apni problems nahi hain — ye **India ki problems**
hain jo founders solve karein. Hamare liye ye **Problem Miner ka naya source**
hai (Reddit/Suggest/Trends ke baad).

## Top 10 Problems (page par)

| # | Category | Problem |
|---|---|---|
| 1 | Automotive | First-time used-car buyers car history/condition/future cost verify nahi kar sakte |
| 2 | Housing | Renters ko lease se pehle mold/pests/hazards ki verified info nahi |
| 3 | Healthcare | Sole earners ke liye aging parents ki care fragmented & stressful |
| 4 | Healthcare | Teachers ko work par real-time mental health support nahi |
| 5 | Career | STEM students ko education loan anxiety (unclear costs) |
| 6 | Consumer Services | Food delivery apps par verified kitchen safety standards nahi dikhte |
| 7 | Hardware | Specialized hardware ko laptop se connect karna unreliable |
| 8 | Healthcare | Sprain vs fracture bina costly hospital visit ke pehchan na |
| 9 | Career | Formal education chhodne walon ko structure/mentorship/career guidance nahi |
| 10 | Healthcare | Anxious logon ko trustworthy non-prescription sleep solutions nahi milte |

## Visible list (B2B Services, Itch Score ke saath)

- SMEs can't negotiate favorable payment terms with large buyers — **82.8**
- Manufacturers can't rely on guaranteed pickup logistics — **79**
- Factory owners wait days for industrial repair technicians — **78.5**
- Freelancers ghost projects after partial payments — **76**
- Businesses can't verify new suppliers before purchasing — **76**
- Businesses struggle finding reliable contract manufacturers (small batches) — **75.2**
- Small restaurants can't access wholesale pricing without large minimums — **71.5**
- Micro-SMEs waste 10+ hours weekly on invoice management — **67.5**
- Shops can't see real-time supplier stock levels — **67.5**
- Small retailers forced into distributor margins — **68.5**

Categories: B2B Services, Beauty & Personal Care, Consumer Services,
E-commerce, EdTech, FinTech, Food & Beverage, Home Services, Logistics,
Payment Issues, Real Estate, SaaS, Transportation, Travel, Healthtech, Other.

## Hamare digital products (ebook/template) se fit

**Strong fit (seedha ebook/template ban sakta hai):**
- Freelancer ghosting after partial payment → **contract + milestone-payment
  template pack** (ye hamare template generator ka best use hai)
- Micro-SME invoice management 10+ hrs/week → **invoice tracker template**
- STEM loan anxiety → **education loan guide ebook**
- Career guidance after formal education → **career roadmap ebook**
- Sleep solutions anxiety → **sleep guide ebook**
- Supplier verification / payment terms → **SME negotiation checklist ebook**

**NO fit (venture-scale ya service/app chahiye, ebook nahi):**
- Used-car history verification, kitchen safety standards, sprain vs fracture,
  hardware-laptop, aging-parents care — ye startup/app ideas hain, digital
  product nahi. Inhe Problem Miner se FILTER OUT karna hoga.

## Workflow me kaise aayega

1. **Problem Miner v2 source** — `scanFixMyItch()` naya source:
   problems + itch score fetch karo → hamare 0-100 scoring me map karo
   (itch score seedha signal hai — Reddit engagement ki tarah) → Reddit/
   Suggest results ke saath merge karo.
2. **Digital-fit filter** — har problem tag ho: `ebook` / `template` /
   `service-only` / `startup-scale`. Sirf ebook/template-fit pre-sell gate
   par jaaye (baaki strategist ke "service" kind me, ya drop).
3. **Seed list** — visible problems (top-10 + B2B list) seedha
   `storage/problem-miner/latest.json` me daal do aaj hi.

## Caveats (honest)

- Page **Framer** par bana hai — problems JS se load hote hain. Poori 10,000
  ki list ke liye data endpoint dhoondhna hoga; agar public API nahi mili to
  manual seed ya headless fetch (deploy VM par) — pehle endpoint check karna
  hoga, blind scrape nahi.
- Top-10 zyadatar venture-scale hain — digital-fit ratio low hai (~30-40%).
  Asli value **long tail + B2B/EdTech/SaaS/Payment Issues categories** me hai.
- Itch Score = takleef ki intensity hai, **buying intent nahi** — pre-sell
  gate (10 intents) phir bhi zaroori hai.
