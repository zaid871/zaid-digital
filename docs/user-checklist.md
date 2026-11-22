# Tumhara Checklist — Pura Setup (2026-11-05)

Ye sirf TUMHARE kaam hain. Baaki sab (code, workflows, tests) ban chuka hai.

## 1. ABHI — Access Handover (Phase 1 shuru karne ke liye)

| # | Kaam | Note |
|---|---|---|
| 1 | VM public IP bhejo | Oracle console → Instance → Public IP |
| 2 | Batao: SSH public key VM banate waqt use hua tha? | Key: `oracle-a1-deploy` (di gayi thi) |
| 3 | n8n URL + login bhejo | Password **sirf Secure Vault card** se |
| 4 | Oracle VCN me ports kholo: 22, 80, 443 | Ingress rules (Oracle console) |
| 5 | Boot volume 50 GB → ~200 GB expand karo | Oracle free = 200 GB total volume storage |
| 6 | Domain choose karo | Free: DuckDNS / afraid.org — ya apna domain; DNS A-record → VM IP |

## 2. Deploy Ke Waqt — Keys (tum banao, `.env` me dalo — chat me kabhi mat bhejo)

| Key | Kahan se | Note |
|---|---|---|
| GROQ_API_KEY | groq.com (free) | Load-bearing — bina iske scripts nahi banenge |
| GEMINI_API_KEY | Google AI Studio (free) | Load-bearing — fallback #2 |
| HF_TOKEN | huggingface.co | **OPTIONAL** (free inference khatam; Spaces ke liye account kaafi) |
| IG_USER_ID + IG_ACCESS_TOKEN | Meta dashboard | ~60 din me expire — refresh karna padega |
| Facebook Page token | Meta dashboard | Non-expiring Page token possible |
| PINTEREST_ACCESS_TOKEN + BOARD_ID | Pinterest developers | Trial = pins sirf self ko dikhte (Standard chahiye) |
| LINKEDIN_ACCESS_TOKEN + AUTHOR_URN | LinkedIn developers | `urn:li:person:...` |
| BREVO_API_KEY + sender email | brevo.com (free 300/day) | Email nurture ke liye |
| PRINTIFY token | printify.com | Optional — nahi to POD drafts skip honge |

## 3. Deploy Ke Waqt — n8n Me

- [ ] Zip import karo (16 digital workflows) + 16 affiliate workflows + repost / auto-dm / multi-platform
- [ ] Env set karo: `N8N_WEBHOOK_SECRET` (backend `.env` jaisa hi) + `BACKEND_URL=http://app:3000`
- [ ] `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` **kabhi mat set karna** (workflows toot jayenge)
- [ ] Purana `digital-products` workflow **deactivate** karo (duplicate webhook rokne ke liye)
- [ ] Backend redeploy + `prisma migrate deploy` (repost variant migration)
- [ ] Faisla: apna standalone n8n platform Compose stack me move karna hai ya alag rakhna hai?

## 4. Mid-November (HF account 30 din purana hoga)

- [ ] 2 HF ZeroGPU Spaces banao (browser se): **Wan 2.2** + **LTX-Video**
- [ ] Env me pool vars set karo: `HF_SPACES_VIDEO_POOL`, `REMOTION_ENABLED=true`

## 5. Deploy Ke Baad — Verify (ek baar, mere saath)

- [ ] Mock-backend loop test (n8n → backend → respond)
- [ ] Remotion render VM par dobara verify
- [ ] fpdf2 / pypdf / pytrends / ffmpeg librsvg app image me check
- [ ] `npx tsx scripts/check-pod-deps.ts` chalao — rembg missing ho to `pip install rembg onnxruntime` (pehli run ~176MB u2net model download karti hai)
- [ ] Pehla real product end-to-end (Phase 9 test)

## 6. Website Live Ke Baad — Affiliate Signups

- [ ] **Abhi kar sakte ho:** Cuelinks + EarnKaro (ek approval = saare merchants)
- [ ] **Website live ke baad:** Amazon Associates India (180 din me 3 sales zaroori)
- [ ] **Domain + traffic ke baad:** vCommission + Admitad

## 7. Tumhare Faisle (jab ready ho — koi jaldi nahi)

| Faisla | Status |
|---|---|
| (a) Selling/delivery unpark karein? (Gumroad/Razorpay) | PARKED |
| (b) 11 solutions me se pehle kis par kaam ho? | Unanswered |
| (c) Zero-audience ebook marketing plan banau? | Unanswered |
| (d) Affiliate articles: A email / B lead magnet / C recurring / D comparison tables? | Unanswered |
| (e) Scraper wiring + caption pack wiring? | Unanswered |
| (f) Generation-quality upgrades me se pehla kaun sa? | Unanswered |
| (g) Razorpay 7 guards: saare ya top 3? | Unanswered |

## Sabse pehla step

Sirf **Section 1** karo — IP + n8n login + ports. Uske baad Phase 1 verification
shuru hoga, aur baaki cheezein deploy ke waqt ek-ek karke hongi.
