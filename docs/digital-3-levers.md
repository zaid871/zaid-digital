# Digital: 3 Success Levers (2026-11-03)

User ke 3 lever — pre-sell validation, POD design-check, roz ka ads run — teeno
ab n8n workflows me chal rahe hain. Solutions-only, imaandaar report.

## Lever 1 — Pre-sell validation gate (`digital-presell-gate.json`, 8 nodes)

**Masla:** automation me product banane se pehle pata nahi hota bikega ya nahi.

**Hal:** `POST /webhook/digital-presell`
`{productType: ebook|template_pack|pod, productName|topic|niche, action: hit|status|reset}`
- Landing page (Carrd/Payhip free tier) par "Mujhe chahiye" button → is webhook
  par hit bhejta hai (header `x-n8n-secret`).
- Hits workflow static data me count hote hain (per product key).
- `DIGITAL_PRESELL_THRESHOLD` (default 10) cross hote hi matching generation
  webhook **ek baar** auto-fire hota hai (`triggered` flag — dobara nahi).
- `action:"status"` → current hits; `action:"reset"` → counter zero.

**Imaandaar caveats:**
- Static data sirf **active** workflows me persist hota hai; n8n restart par
  counters **reset** ho jate hain (n8n ka behavior, hamara nahi). Threshold
  chhota rakho (10) taaki restart ka nuksaan kam ho.
- Ye "interest" count karta hai, payment nahi — asli pre-order (paise wali)
  validation isse strong hoti hai; wo manual rahegi (Razorpay/Payhip).
- Generation webhook wapas call karne ke liye `N8N_PUBLIC_URL` env chahiye
  (default `http://localhost:5678`).

## Lever 2 — POD design-check (`digital-pod-generation.json` PATCHED + `digital-pod-approve.json` NEW)

**Masla:** AI text designs me gadbad karta hai; kharab design ka Printify draft
ban gaya to refund/reputation ka nuksaan.

**Hal (two-phase):**
1. `digital-pod-generation` ab **hamesha** `skipPrintify:true` bhejta hai —
   design assets (design-print.png, mockup) bante hain, Printify draft **kabhi
   auto-create nahi hota**. Response me `approvalRequired:true`,
   `approveWebhook:'/webhook/digital-pod-approve'`, `approveWith:{slug}` milta hai.
2. Human `storage/digital/pod-<slug>/design-print.png` **khud check** karta hai.
3. Pasand aaye to `POST /webhook/digital-pod-approve {slug}` →
   `POST /api/v1/digital/pod/publish` → Printify **UNPUBLISHED** draft banta hai.
   Na-pasand ho to kuch mat karo — koi draft nahi banega.

**Backend changes:**
- `src/lib/digital/pod.ts`: `PodDesignInput.skipPrintify`; Printify block
  `createPrintifyDraft()` helper me refactor; `publishPodDraftFromSlug(slug)`
  manifest se design padhkar draft banata hai (design dobara generate nahi hota);
  `assertSafeSlug()` — path traversal safe (`^[a-z0-9-]{1,120}$`).
- `POST /api/v1/digital/pod`: `skipPrintify` passthrough.
- `POST /api/v1/digital/pod/publish`: `{slug, printify?}` → draft ya typed error
  (validation_error 422 / printify_not_configured 503 / printify_failed 502).
- Manifest me ab `description` bhi store hota hai (publish ke liye).

**Deploy note:** backend **redeploy zaroori** hai — purana backend `skipPrintify`
ignore karega aur Printify draft bana dega (lever 2 fail).

## Lever 3 — Roz ka ads run (`digital-ads-daily.json`, 5 nodes)

**Masla:** ek video se kuch nahi hota; 30 videos ka stack chahiye.

**Hal:** Schedule trigger roz **09:00 IST** (`30 3 * * *` UTC) →
`DIGITAL_ADS_QUEUE_JSON` me se aaj ka product rotate karke
(day-of-year % queue length) → `POST /webhook/digital-ads-marketing`
**fire-and-forget** (30s timeout — ads workflow ~40 min chalti hai, jawab ka
wait nahi karta; server side execution jaari rehti hai).
- `DIGITAL_ADS_AUTO_PUBLISH=false` (default): sirf video banta hai, post nahi.
- `=true`: Pinterest/LinkedIn par auto-post (X hamesha manual draft).

## Verification (2026-11-03)

- `scripts/test-digital-pod-gate.ts` **14/14** (slug guard + publish validation,
  no network).
- 4 workflows: node-graph + har Code node ka JS `node --check` — pass.
- `tsc --noEmit` clean, `eslint` clean (0 errors).
- `n8n/digital-workflows-4-pack.zip` rebuilt: 7 workflow JSONs + README-import.txt
  (8 files), zip integrity + graph re-verified.

## Files

- `n8n/workflows/digital-presell-gate.json` (NEW)
- `n8n/workflows/digital-pod-approve.json` (NEW)
- `n8n/workflows/digital-ads-daily.json` (NEW)
- `n8n/workflows/digital-pod-generation.json` (PATCHED)
- `scripts/gen-digital-levers.py` (generator + validator)
- `scripts/test-digital-pod-gate.ts` (14/14)
