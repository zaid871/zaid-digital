/**
 * POD design rules transferred from Nishkarsh Sharma's POD playbook
 * (nishkarshsharma.com/blog/print-on-demand-india + "How To Do Design
 * Research For Print on Demand From India" + "Indian Print on-Demand
 * Masterclass for Beginners 2025").
 *
 * What transferred (principles, not tools):
 * - E2S design filter — his design-research formula for shortlisting
 *   designs. E = Easy to read and understand, 2 = two to three words in
 *   the design, S = Specific (the wearer must be identifiable from the
 *   design). A design that fails any one dimension does not sell.
 * - Niche rule — specific BUT broad. Too tiny (e.g. "Delhi fathers with
 *   five daughters") has no buyers; "everyone" has no buyer either.
 * - Mockups improve conversions — square 1080x1080 product-page mockups.
 * - Price ladder — start low, raise after proof (₹799 -> ₹899). Never a
 *   fake compare-at price.
 * - Supplier ladder — Printify draft first, graduate to a private
 *   supplier (Qikink in India) only after a design proves itself.
 *
 * What did NOT transfer (and why — see docs/pod-marketing.md):
 * - Minea (paid ad-spy tool), Meta Ads (paid), Shopify (paid),
 *   Qikink (India-only, no API in this system), the ₹1500 compare-at
 *   price (fake discount — halal rule), ₹75-80k starting capital
 *   (ad spend), paid mentorship. Revenue claims (₹50 Cr etc.) are the
 *   creator's own claims, unverified here.
 *
 * All functions here are pure and deterministic — no network, no AI
 * quota. The E2S gate runs inside generatePodDesign before any image
 * is generated, so a failing brief costs nothing.
 */

export interface E2SInput {
  /** Niche the design is for, e.g. "fishing", "teachers", "gym". */
  niche: string;
  /** Short text on the design (max ~40 chars). Empty = graphic-only. */
  designText?: string;
}

export interface E2SDimension {
  /** 0 = fail, 1 = neutral (signal unknown, not a fail), 2 = pass. */
  score: 0 | 1 | 2;
  reason: string;
}

export interface E2SResult {
  /** Total 0-6. Pass = score >= 4 AND no dimension scores 0. */
  score: number;
  max: number;
  passed: boolean;
  dimensions: { E: E2SDimension; two: E2SDimension; S: E2SDimension };
  reasons: string[];
  warnings: string[];
}

/** Words that mean "everyone" — no identifiable wearer, so no buyer. */
const TOO_BROAD = new Set([
  "everyone", "all", "people", "general", "cool", "funny", "trendy",
  "best", "awesome", "nice", "good", "love", "happy",
]);

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Score a POD design brief against E2S.
 *
 * E — Easy to read and understand: the text must be short and clear
 * (2-40 chars). Graphic-only designs score neutral (1) — the image
 * itself needs a human visual check, flagged in warnings.
 * 2 — Two to three words: a quote or 2-3 words sells better than a
 * single word or a sentence. Graphic-only scores neutral (1).
 * S — Specific: the niche must name a recognizable audience. A niche
 * that is only generic words ("cool", "funny", "everyone") fails.
 */
export function scoreE2S(input: E2SInput): E2SResult {
  const niche = input.niche.trim();
  const text = (input.designText ?? "").trim();
  const reasons: string[] = [];
  const warnings: string[] = [];

  // E — easy to read and understand.
  let E: E2SDimension;
  if (!text) {
    E = { score: 1, reason: "graphic-only — no text to judge; needs a human visual check." };
    warnings.push("Graphic-only design — review design-print.png for readability before any publish.");
  } else if (text.length < 2) {
    E = { score: 0, reason: "design text is too short to read as a design." };
  } else if (text.length > 40) {
    E = { score: 0, reason: `design text is ${text.length} chars — over the 40-char readability limit.` };
  } else {
    E = { score: 2, reason: `design text "${text}" is short and readable.` };
  }

  // 2 — two to three words.
  let two: E2SDimension;
  if (!text) {
    two = { score: 1, reason: "graphic-only — word-count rule does not apply." };
  } else {
    const n = wordCount(text);
    if (n >= 2 && n <= 3) {
      two = { score: 2, reason: `${n} words — in the 2-3 word sweet spot.` };
    } else if (n === 1) {
      two = { score: 1, reason: "single word — sells weaker than a 2-3 word line." };
    } else {
      two = { score: 0, reason: `${n} words — over the 2-3 word limit; hard to read on a shirt.` };
    }
  }

  // S — specific wearer.
  let S: E2SDimension;
  const nicheWords = niche.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (niche.length < 2) {
    S = { score: 0, reason: "niche is empty." };
  } else if (nicheWords.length > 0 && nicheWords.every((w) => TOO_BROAD.has(w))) {
    S = { score: 0, reason: `niche "${niche}" names no identifiable wearer — too broad.` };
  } else {
    S = { score: 2, reason: `niche "${niche}" names a recognizable audience.` };
  }

  const score = E.score + two.score + S.score;
  const passed = score >= 4 && E.score > 0 && two.score > 0 && S.score > 0;
  if (!passed) {
    if (E.score === 0) reasons.push(`E2S-E fail: ${E.reason}`);
    if (two.score === 0) reasons.push(`E2S-2 fail: ${two.reason}`);
    if (S.score === 0) reasons.push(`E2S-S fail: ${S.reason}`);
    if (score < 4) reasons.push(`E2S total ${score}/6 is below the pass mark of 4.`);
  }
  return { score, max: 6, passed, dimensions: { E, two, S }, reasons, warnings };
}

export interface PodPricingGuide {
  market: "in" | "intl";
  currency: "INR" | "USD";
  /** Supplier base cost (print + ship) per tee. Null = verify at draft time. */
  baseCost: [number, number] | null;
  /** Sweet-spot selling range. */
  sell: [number, number];
  /** Start price for a new, unproven design. */
  start: number;
  /** Settle price once the design has proven itself (sales). */
  settle: number;
  /** Larger sizes cost more to print — price bump for 4XL etc. */
  sizeTierBump: [number, number] | null;
  /** Margin before ads, per unit, at the sweet spot. */
  marginBeforeAds: [number, number] | null;
  /** The ladder rule, in one line. */
  ladder: string;
  /**
   * Compare-at ("was ₹1500") price: ALWAYS null. A struck-through price
   * that was never charged is a fake discount — excluded by the
   * Shariah-compliant content rule, not by oversight.
   */
  compareAt: null;
  notes: string[];
}

/**
 * POD pricing guidance. India numbers are Nishkarsh's published 2026
 * playbook (Qikink base ₹350-450, sell ₹800-1200, start ₹799, settle
 * ₹899, 4XL ₹949-999). International numbers stay on the system's
 * existing Printify default ($25) — Printify base cost varies by
 * provider, so it is verified at draft time, never invented here.
 */
export function podPricingGuide(market: "in" | "intl"): PodPricingGuide {
  if (market === "in") {
    return {
      market: "in",
      currency: "INR",
      baseCost: [350, 450],
      sell: [800, 1200],
      start: 799,
      settle: 899,
      sizeTierBump: [50, 100],
      marginBeforeAds: [350, 800],
      ladder: "Start at ₹799, raise to ₹899 once the design proves itself.",
      compareAt: null,
      notes: [
        "Test budget ₹10,000-15,000 ad spend in the playbook is PAID Meta Ads — the system uses organic marketing, so no ad spend is assumed.",
        "Damaged / wrong-size replacements are the supplier's cost, not the seller's — refunds become exchanges for custom items.",
      ],
    };
  }
  return {
    market: "intl",
    currency: "USD",
    baseCost: null,
    sell: [20, 30],
    start: 25,
    settle: 25,
    sizeTierBump: [5, 10],
    marginBeforeAds: null,
    ladder: "Start at $25 (Printify default); raise only after proven sales.",
    compareAt: null,
    notes: [
      "Printify base cost varies by provider — verify it on the draft before setting a price; never invent a base cost here.",
    ],
  };
}

export interface SupplierStage {
  stage: 0 | 1 | 2;
  label: string;
  supplier: string;
  nextAction: string;
}

/**
 * Supplier ladder. Stage 0 is where every design starts (Printify
 * draft, no inventory, no upfront cost). A design graduates only after
 * it proves itself with real sales — the threshold is a documented
 * rule (50 sales), and sales data arrives with the selling layer.
 * Stage 2 (private supplier, e.g. Qikink in India) is a MANUAL step:
 * it needs a supplier account + API/key setup on the user's side, and
 * there is no automatic ordering in this system.
 */
export function supplierLadder(sales: number): SupplierStage {
  const n = Math.max(0, Math.floor(sales));
  if (n >= 50) {
    return {
      stage: 2,
      label: "graduate — private supplier",
      supplier: "Qikink (India) or a local private supplier",
      nextAction:
        "Design has 50+ sales — review it for a private-supplier move (better margins, faster delivery). Manual step: supplier account + terms first.",
    };
  }
  if (n >= 10) {
    return {
      stage: 1,
      label: "proven — watch for graduation",
      supplier: "Printify",
      nextAction: `Design has ${n} sales — on track; graduates to a private supplier at 50 sales.`,
    };
  }
  return {
    stage: 0,
    label: "start — Printify draft",
    supplier: "Printify",
    nextAction: "Unproven design — stays on Printify (no inventory, no upfront cost).",
  };
}
