# Selling Layer — Spec (PARKED until user says go)

Decision (a) pending hai — ye spec tab kaam ayegi jab user selling unpark kare.
Failure-articles analysis (Alva #2 infrastructure, #3 pricing) se nikli requirements.

## 1. Flow

```
Payment webhook (Gumroad / Razorpay)
  → license record (buyer email + product + timestamp) [DB]
  → signed download URL (HMAC, 72h expiry) → buyer ko email
  → buyer downloads → PDF buyer-stamped on the fly (stamping.ts)
  → 7 din baad PMF survey email (digital-pmf-survey workflow)
```

## 2. Expiring secure download links (Alva #2 ka jawab)

- Har purchase par unique token: `HMAC_SHA256(server_secret, buyer_email + product_slug + expires_at)`.
- Link format: `GET /api/v1/digital/download?t=<token>` → token verify → expiry
  check (72h) → `stampPdfForBuyer()` se stamped PDF stream.
- Direct file URLs kabhi expose nahi honge (storage/digital public nahi hai).
- Manual email delivery BANNED (Alva: 67% failures ne manual delivery use ki thi).
- Token reuse: single-use nahi (buyer dobara download kar sake), lekin expiry
  ke baad naya link "resend" flow se.

## 3. Piracy deterrent

- `src/lib/digital/stamping.ts` (BUILT): har page par "Licensed to <email>"
  footer. Delivery par on-the-fly stamp.
- Honest note: stamping deterrent hai, DRM nahi — koi bhi screenshot le sakta
  hai. Isse zyada (DRM) free-first me possible nahi.

## 4. Pricing guidance (Alva data — USD/Western market, caveats neeche)

| Product type | Sweet spot | < $27 ka anjaam |
|---|---|---|
| Templates / graphics | $47–97 (41% success) | 84% fail rate |
| Ebooks | $27–47 (22% success) | 84% fail rate |

**Caveats (imaandaar):**
- Ye data US/EU Shopify merchants ka hai. Indian audience ki purchasing power
  alag hai — ₹ pricing me sweet spots test karne padenge.
- Price tumhara business faisla hai; ye table guidance hai, rule nahi.
- Pre-sell gate willingness-to-pay validate karega — price test wahi hoga.

## 5. Payment options (decision (a) ke waqt)

- **Gumroad:** 10% fee, global, built-in delivery + fraud protection. Start ke
  liye sabse tez.
- **Razorpay:** ~2% + GST, ₹199 KYC, UPI/cards — Indian buyers ke liye best
  (UPI = conversion). Webhook → hamara license flow.
- Dono me hamara download-link system same rahega (payment provider sirf
  webhook bhejta hai).

## 6. Support load kam rakhna (Alva #5: 3.7 tickets/10 sales)

- Har product ke saath **auto-FAQ** (`faq.ts`, BUILT) delivery page par.
- Top issue "download nahi hua" (37%) → download page par step-by-step
  instructions + "link expired? resend karo" button.
- Target: <2 tickets/10 sales (Alva Level 4).

## 7. Freebie → Tripwire (7-point plan #6)

**Status:** SPEC ONLY — selling decision (a) parked hai; tripwire page + payment
tab banega jab selling unpark ho.

Flow:
```
Freebie download (digital-freebie-delivery.json)
  → digital-email-nurture.json: email 1 (freebie) → wait 1d → email 2 (how-to)
  → wait 2d → email 3 (pitch — NO fake urgency)
  → tripwire page: premium product, REAL discount (e.g. launch price) —
    fake countdown / "sirf aaj" BANNED (hamare rules)
  → payment webhook → license → expiring download link (§2)
```

Freebie = paid product ka "mini version" (template ka 1-page sample, ebook ka
1 chapter). Tripwire price = sweet-spot table (§4) ke neeche nahi.
