# Razorpay Analysis (2026-11-05)

Research: Razorpay official docs/pricing + G2 + Trustpilot + Reddit + xflowpay
review. Ratings split is honest: **G2 4.3/5** (developers — reliable webhooks,
93-94% success rate) vs **Trustpilot 1.4/5** (437 reviews — support + holds).
Product solid hai; account-risk + support problem hai.

## Facts (verified)

- RBI final Payment Aggregator licence; 8M+ merchants; 100+ payment methods.
- Standard fee: **2% + 18% GST = 2.36% effective** (₹1,000 sale → ₹976.40).
  UPI par bhi 2% platform fee lagta hai (zero MDR ≠ zero fee).
- **₹199 KYC processing fee** (one-time, +taxes).
- Settlement: T+1 standard (T+2 working days per some sources); instant
  settlement = extra fee.
- New merchants (activated on/after 1 Jul 2026): **0% platform fee, 90 days
  ya ₹5L GMV** tak (GST + ₹199 KYC still apply).
- Webhooks: HMAC-SHA256 signature (`X-Razorpay-Signature`), dedupe on
  `x-razorpay-event-id`, 2XX within 5s, server-side confirm via
  `GET /v1/payments/:id`.
- Key events: `payment.captured` / `order.paid` / `payment_link.paid` = paid;
  `payment.failed`; `refund.processed`; `payment.dispute.created` (+ won/lost);
  `payment.authorized` ≠ paid (capture zaroori; uncaptured auth auto-void).
- Payment Links API: `POST /v1/payment_links` (no website needed — WhatsApp/
  email par link bhejo); `accept_partial=false` recommended.
- International cards: sirf registered merchants + policy pages on website.

## Problems logon ko pesh aate hain (ranked)

1. **Sudden account freeze / settlement hold (120 din tak)** — #1 complaint.
   Compliance review, vague "ToS violation", koi specific reason nahi. Funds
   hold = cash-flow death for small sellers.
2. **Support slow + template-driven** — tickets band bina solution, 24-48h
   response, koi phone support nahi. Buyer ↔ merchant ↔ Razorpay ball-passing.
3. **KYC pain** — ₹199 charge karke AI check se reject (manual review nahi);
   NRI/LLP structures me deadlock (majority partner NRI → KYC impossible);
   documents baar-baar maange jaate hain.
4. **Settlement delays** — new accounts 7-14 din; holidays/weekends par late.
5. **Payment failures** — customer debited, merchant credited nahi.
6. **Refund delays** — UPI refunds 5-7 business days.
7. **Chargebacks/disputes** — poora amount debit + funds hold; dispute info
   kam milti hai (3DS use hua ya nahi — batate nahi).
8. **Pricing confusion** — "UPI free" samajh ke aate hain, 2% platform fee
   dekh ke shock.

## Hamare workflow me kya add ho sakta hai

| # | Add | Kis problem ka jawab |
|---|---|---|
| 1 | KYC pre-check + policy pages auto-generate (privacy/refund/terms — website catalogue se) | #3, #8 (activation + international) |
| 2 | Webhook hardening: HMAC verify + dedupe + server-side confirm + 5s response | #5 (missed webhook = no delivery) |
| 3 | Failed-payment recovery: `payment.failed` → auto retry email + fresh Payment Link | #5 (lost sales) |
| 4 | Dispute evidence pack: license + delivery timestamp + stamped PDF + buyer email, one-click | #7 |
| 5 | Settlement monitor: expected vs received, >T+2 par alert | #1, #4 |
| 6 | Dual-gateway fallback: Cashfree (1.95%) second option | #1 (freeze ≠ zero sales) |
| 7 | Fee calculator: per-sale net revenue (₹1,000 → ₹976.40) | #8 |

## Kya workflow se fix NAHI hoga (honest)

- Freeze risk: Razorpay ki compliance hai — engineering se khatam nahi hoti.
  Mitigation = clean KYC + gradual volume + second gateway.
- Support speed: Razorpay ka masla hai. Hamari taraf se = evidence pack +
  escalation playbook (dashboard ticket → Escalate Now → grievance policy;
  RBI: UPI failed T+1 / merchant-payment T+5 reversal, ₹100/day compensation).
- Selling layer abhi bhi PARKED hai (decision a) — ye adds usi ke andar aayenge
  jab unpark hoga.
