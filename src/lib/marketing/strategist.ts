/**
 * Universal Marketing Strategist — agency-grade strategy brain.
 *
 * Vision: koi bhi product (digital/physical/affiliate/service), koi bhi
 * market breadth (broad/niche/micro) → sahi channel, sahi step, sahi waqt.
 * "Perfect" day-one par claim nahi karta — playbook best-known strategy deta
 * hai, phir goal-loop data se prove/correct karta hai (flywheel). Wahi
 * convergence "is se behtar option nahi" ka imaandaar version hai.
 *
 * Honest boundary: demand ZERO ho to koi marketing sales nahi la sakti.
 * Ye engine demand DHOONDTA hai (har pocket), banata nahi. Pre-sell gate
 * hamesha stage 1 hai.
 *
 * Pure + one LLM call (angles only). App-Route safe (no provider imports).
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "../digital/ebook";

export type StrategistTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export const briefSchema = z.object({
  productName: z.string().min(2).max(120),
  /** Agency use: client name → ledgers namespace as "client:product". */
  client: z.string().min(1).max(60).optional(),
  kind: z.enum(["digital_product", "physical", "affiliate", "service"]),
  priceBand: z.enum(["low", "mid", "high"]),
  audience: z.string().min(2).max(200),
  /** broad = mass market; niche = defined segment; micro = <10k buyers enough. */
  marketBreadth: z.enum(["broad", "niche", "micro"]),
  goal: z.enum(["sales", "leads"]),
  assets: z.object({
    hasVideo: z.boolean().default(false),
    hasLanding: z.boolean().default(false),
    hasEmail: z.boolean().default(false),
  }).default({ hasVideo: false, hasLanding: false, hasEmail: false }),
  features: z.array(z.string().max(120)).max(8).default([]),
});

export type UniversalBrief = z.infer<typeof briefSchema>;

export interface PlanStage {
  stage: "validate" | "launch" | "amplify" | "sustain" | "retain";
  title: string;
  channels: string[];
  tactics: string[];
  timing: string;
}

export interface MarketingPlan {
  productKey: string;
  channelQueue: string[]; // priority order — pehle ye, phir ye
  stages: PlanStage[];
  angles: string[];       // LLM: 3 positioning angles (compliance-scanned)
  hooks: string[];        // LLM: 3 hook lines (compliance-scanned)
  reasoning: string[];
  warnings: string[];
}

type Channel = string;

/**
 * The playbook matrix — har tarah ki marketing knowledge, encoded.
 * Rows: marketBreadth × kind × priceBand → channel priority.
 */
function channelPriority(b: UniversalBrief): { queue: Channel[]; reasoning: string[] } {
  const reasoning: string[] = [];
  const q: Channel[] = [];
  const push = (...cs: Channel[]) => { for (const c of cs) if (!q.includes(c)) q.push(c); };

  // ---- breadth decides the physics ----
  if (b.marketBreadth === "broad") {
    push("reels_shorts", "pinterest", "x_posts");
    reasoning.push("Broad market → mass reach channels first (reels/shorts volume game).");
  } else if (b.marketBreadth === "niche") {
    push("pinterest", "reddit_communities", "seo_articles", "youtube_tutorials");
    reasoning.push("Niche market → intent-first: Pinterest search + communities + long-tail SEO beat mass reach.");
  } else {
    push("reddit_communities", "micro_influencer", "partnerships", "seo_articles", "email_nurture");
    reasoning.push("Micro market → 100 true fans enough; direct trust channels beat algorithms.");
  }

  // ---- kind adjustments ----
  if (b.kind === "digital_product") {
    push("email_nurture", "marketplace_etsy");
    reasoning.push("Digital product → email nurture (100% margin, repeat sales) + Etsy marketplace.");
  } else if (b.kind === "affiliate") {
    push("seo_articles");
    reasoning.push("Affiliate → buyer-intent SEO + disclosure-first copy (search traffic converts, reels traffic doesn't).");
  } else if (b.kind === "service" || b.priceBand === "high") {
    // high-ticket/service: trust > volume — reorder
    const trust: Channel[] = ["youtube_tutorials", "linkedin", "email_nurture", "partnerships"];
    for (const c of trust) { const i = q.indexOf(c); if (i >= 0) q.splice(i, 1); }
    q.unshift(...trust);
    reasoning.push("High-ticket/service → trust channels first (nobody buys ₹5,000+ from a 15s reel).");
  }
  if (b.kind === "physical") {
    push("marketplace_etsy");
    reasoning.push("Physical → marketplace presence (Etsy) + visual search (Pinterest).");
  }

  // ---- asset reality check ----
  if (!b.assets.hasVideo) {
    const i = q.indexOf("reels_shorts");
    if (i > 2) { q.splice(i, 1); q.splice(2, 0, "reels_shorts"); }
    reasoning.push("No video asset yet → video engine se pehle ad banao, phir reels scale karo.");
  }
  if (!b.assets.hasLanding && b.goal === "sales") {
    reasoning.push("No landing page → sales goal ke liye selling-layer spec se page banao; tab tak lead-gen mode.");
  }
  if (!b.assets.hasEmail) {
    const i = q.indexOf("email_nurture");
    if (i >= 0) q.splice(i, 1);
    reasoning.push("No email list → email nurture baad me (Mautic/Brevo judne par); pehle list banao.");
  }
  return { queue: q, reasoning };
}

function stageTactics(b: UniversalBrief, channel: Channel): string[] {
  const t: string[] = [];
  switch (channel) {
    case "reels_shorts":
      t.push("Daily AI video ad (ads-daily) — hook first 2s, numbered style", "Winner 3x → 5 sub-angles (goal-loop)");
      break;
    case "pinterest":
      t.push("5-10 pins per product, keyword titles/descriptions", "Fresh pin per angle — compounds for months");
      break;
    case "reddit_communities":
      t.push("90-10 value-first: 90% free help, 10% soft mention", "Answer 'How do I...' threads; NEVER spam links (ban risk)");
      break;
    case "seo_articles":
      t.push("Long-tail: '[niche] + [use-case/city]' — low competition", "Comparison/best-of posts for buyer intent");
      break;
    case "youtube_tutorials":
      t.push("Tutorial + free resource in description (years of traffic)", "Outcome title, not topic title");
      break;
    case "email_nurture":
      t.push("Freebie → 3-email nurture → pitch (no fake urgency)", "Segment buyers vs leads");
      break;
    case "micro_influencer":
      t.push("3K-20K followers, free product for honest review", "Reuse their content as ad creative (with permission)");
      break;
    case "partnerships":
      t.push("Complementary product owners — bundle/cross-promo", "Revenue share, no upfront cost");
      break;
    case "marketplace_etsy":
      t.push("13 tags long-tail, front-loaded titles, bundles", "Etsy optimizer module (proposed)");
      break;
    case "x_posts":
      t.push("Manual posts via X app (API paid) — build in public", "Reply to niche threads with value");
      break;
    case "linkedin":
      t.push("Outcome posts for B2B/professional audience", "Document-style carousels");
      break;
  }
  if (b.marketBreadth === "micro") t.push("Direct outreach: 20 hand-picked prospects/week (manual, honest)");
  return t;
}

function buildStages(b: UniversalBrief, queue: Channel[]): PlanStage[] {
  const top3 = queue.slice(0, 3);
  const mid = queue.slice(3, 6);
  return [
    {
      stage: "validate", title: "Validate (pehle demand prove karo)",
      channels: ["presell_gate"],
      tactics: [
        "Problem Miner se top problems → pre-sell gate",
        "10 validated intents ke BINA scale mat karo (Alva: 9%→34%)",
        "Sean Ellis survey: 40%+ 'very disappointed' = real demand",
      ],
      timing: "Week 1-2",
    },
    {
      stage: "launch", title: "Launch (warmest channels first)",
      channels: top3,
      tactics: top3.flatMap((c) => stageTactics(b, c)).slice(0, 6),
      timing: "Week 2-4 — best-time slots 07:30/08:30/19:30/20:30 IST",
    },
    {
      stage: "amplify", title: "Amplify (data jo bole wahi karo)",
      channels: ["goal_loop"],
      tactics: [
        "Weekly goal-loop sweep: winners 3x → scale, losers <70% → diagnose/fix",
        "North Star KPIs track karo; gap aaye to best-config re-apply",
        "Winning angles ke 5 sub-angles queue me (flywheel)",
      ],
      timing: "Week 4+ — ongoing weekly",
    },
    {
      stage: "sustain", title: "Sustain (compounding assets)",
      channels: mid.length ? mid : ["pinterest", "seo_articles"],
      tactics: [
        "Pinterest pins + SEO articles compound for months — ye 'sleeping salesmen' hain",
        "Har product ka evergreen tutorial video",
      ],
      timing: "Month 2+ — compounding",
    },
    {
      stage: "retain", title: "Retain (repeat revenue)",
      channels: b.assets.hasEmail ? ["email_nurture"] : [],
      tactics: b.assets.hasEmail
        ? ["Buyers ko naye products pehle batao", "Bundle offers (real discounts only)"]
        : ["Email list banao (Mautic/Brevo) — tab ye stage unlock hoga"],
      timing: "Ongoing",
    },
  ];
}

const angleSchema = z.object({
  angles: z.array(z.string().max(160)).max(4),
  hooks: z.array(z.string().max(120)).max(4),
});

function clean(items: string[], warnings: string[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (PRICE_PATTERN.test(it) || BANNED_CLAIM_PATTERN.test(it)) {
      warnings.push("angle/hook dropped: price/claim pattern matched.");
      continue;
    }
    out.push(it);
  }
  return out;
}

/**
 * Build the full plan: deterministic playbook (structure) + LLM (angles/hooks).
 */
export async function buildPlan(
  raw: unknown,
  textGen: StrategistTextGen = ebookTextGen
): Promise<MarketingPlan> {
  const b = briefSchema.parse(raw);
  const warnings: string[] = [];
  const { queue, reasoning } = channelPriority(b);
  const productKey = b.client ? `${b.client}:${b.productName}` : b.productName;

  if (b.marketBreadth === "micro") {
    warnings.push("Micro market: volume chase mat karo — 100 buyers × repeat = business. Ye math tumhare favour me hai.");
  }
  if (b.kind === "affiliate" && b.goal === "sales") {
    warnings.push("Affiliate par 'sales' = clicks→merchant; apna conversion tumhare haath me nahi — buyer-intent channels (SEO/Pinterest) reels se 10x behtar.");
  }

  const prompt = `You are a senior marketing strategist. Given this product brief, write 3 distinct POSITIONING ANGLES (outcome-based, transformation becho) and 3 HOOK LINES (first 2 seconds of a short video ad), in natural Hinglish (Roman script, Indian audience).
Brief: ${b.productName} (${b.kind}, ${b.priceBand} price, ${b.marketBreadth} market, goal: ${b.goal})
Audience: ${b.audience}
Verified features: ${(b.features ?? []).join(" | ") || "none provided — keep general and honest"}
RULES: NO prices, NO discounts, NO fake urgency, NO guaranteed results, NO fake testimonials, NO "#1" claims. Hooks = curiosity/contrarian, max 15 words.
Return ONLY valid JSON, no markdown fences: {"angles":["...","...","..."],"hooks":["...","...","..."]}`;

  let angles: string[] = [];
  let hooks: string[] = [];
  try {
    const rawOut = await textGen(prompt, 600);
    const start = rawOut.indexOf("{");
    const end = rawOut.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("unparseable");
    const parsed = angleSchema.parse(JSON.parse(rawOut.slice(start, end + 1)));
    angles = clean(parsed.angles.slice(0, 3), warnings);
    hooks = clean(parsed.hooks.slice(0, 3), warnings);
  } catch (err) {
    warnings.push(`angles/hooks unavailable (${err instanceof Error ? err.message.slice(0, 80) : String(err)}) — plan structure unaffected.`);
  }

  return {
    productKey,
    channelQueue: queue,
    stages: buildStages(b, queue),
    angles,
    hooks,
    reasoning,
    warnings,
  };
}
