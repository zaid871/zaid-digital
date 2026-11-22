# Closed-Loop Growth Flywheel — Plan (2026-11-03)

User ke Claude chat se aaya blueprint. Vetted + hamare system se mapped.
"Code me convert karein?" — is turn me PLAN + vetting; build approval ke baad.

## 1. North Star KPIs (calibrated)

| Blueprint KPI | Verdict |
|---|---|
| Har 7 din me 1 short → 10k+ views | Stretch goal rakho; viral lottery hai — median isse kam hoga |
| Landing 3-5% opt-in | Realistic (achhi page par) |
| List ka 1-1.5% → ₹5,000 high-ticket | **Blocked:** high-ticket product abhi hai hi nahi — pehle banao, phir KPI |
| pSEO first page in 30 days | **Calibrate:** naye domain par 30 din unrealistic; 30 din me ranking trajectory, first page 90 din |

Design: goal-loop me `northStar` field (prescriptive stretch) + `targets`
(descriptive max-achieved) — dono parallel chalenge.

## 2. 4-Step Diagnostic Audit → hamare system se mapping

| Blueprint step | Status |
|---|---|
| (1) Hook & retention → 5 naye hooks (Groq) → re-render | NEW (v2): goal-loop ka channel-specific auto-fix. Repost loop captions regenerate karta hai; hook-regen uska video-side counterpart |
| (2) Traffic vs conversion disconnect → alert + A/B headline rewrite | NEW, lekin **blocked:** landing pages abhi hain hi nahi; A/B infra future |
| (3) SEO stagnation → GSC/serper → LSI/FAQ/schema → recrawl | **serper.dev PAID → reject; GSC API free** use hoga. **Blocked:** pSEO articles abhi proposed stage me |
| (4) Winner 3x rule → 5 sub-angles → content calendar priority | NEW: goal-loop sweep me winner-scale rule (3x median → 5 sub-angles auto-generate → queue) |

**Flag:** blueprint me "100% confirmed sales" language hai — ye wahi guarantee
fantasy hai jo pehle reject ki thi. System "fail cheap, pivot fast" deta hai,
certainty nahi.

## 3. Competitor Strategy Absorption (kai competitors → hamara moat)

Fragmented competitors (Etsy sellers, POD sellers, ebook sellers) — kisi ek ke
paas full stack nahi. Hamara moat = **learning rate** (weekly auto-iterate vs
unki manual monthly) + $0 marginal cost + Hinglish.

| Unki strategy | Hamari status |
|---|---|
| Etsy SEO (13 tags, long-tail) | PROPOSED (Etsy optimizer module) |
| Pinterest volume | BUILT (publisher) + volume engine PROPOSED |
| Short-video content-first + trend-jacking | BUILT (video engine) + hook-regen NEW |
| Bundles (30-40% off) | **GAP → bundle builder PROPOSED** |
| Lead magnet + email nurture | PROPOSED (Mautic) |
| Micro-influencer seeding | Semi-manual rahega (outreach automate nahi hota imaandaari se) |
| Outcome positioning | BUILT (sales-copy generator) |

## 4. Weakness Exclusion Audit (unki kamiyan ham me na aayein)

Har weekly sweep me 7-point automated audit:

1. ✅ Single-channel dependence → guard: har product par 3+ active channels, warna alert
2. ✅ Manual burnout → guard: sab workflows se (already)
3. ✅ No video → guard: har product ko video ad (ads-daily)
4. ✅ No Hinglish targeting → guard: style check (already)
5. ✅ Fake reviews/claims → guard: compliance scan (already)
6. ✅ Launch-and-disappear → guard: ads-daily + repost loop (already)
7. ✅ No validation → guard: pre-sell gate (already)

Ye audit goal-loop sweep ka hissa banega — kamiyan system me ghus hi nahi payengi.

## 5. Build order (proposed)

1. Goal-loop me `northStar` + winner-scale rule (3x → 5 sub-angles)
2. Weakness-exclusion audit (sweep me)
3. Hook-regen auto-fix (video channel)
4. Bundle builder (Etsy optimizer ke saath)
5. Baaki (A/B infra, pSEO recrawl) — landing/articles banne ke baad
