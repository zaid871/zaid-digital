/**
 * Hinglish script generation (Phase 5).
 *
 * Calls the router's script provider (hf-inference, free tier) with a
 * compliance-hardened prompt. The model output is parsed into a structured
 * ScriptObject and validated with zod. Provider errors (not_configured,
 * rate_limited, ...) are propagated as typed PipelineErrors — a script is
 * NEVER fabricated.
 */
import * as hfInference from "@/lib/providers/hf-inference";
import * as pollinations from "@/lib/providers/pollinations";
import { attemptWithFallback } from "@/lib/providers/fallback";
import * as gemini from "@/lib/providers/gemini";
import * as groq from "@/lib/providers/groq";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { SCRIPT_PSYCHOLOGY_LINES } from "@/lib/digital/buyer-psychology";
import { ScriptObjectSchema, type DmCtaT, type ScriptObjectT } from "./schemas";
import { PipelineError, type ProductFactsInput } from "./types";

// The canonical pattern definitions live in @/lib/compliance (a leaf
// module) so App Route bundles can import them without dragging the
// provider graph in. Re-exported here for existing importers (qa.ts).
export { BANNED_CLAIM_PATTERN, PRICE_PATTERN };

/** Rough Hindi/Hinglish speech rate: ~2.4 words per second. */
const WORDS_PER_SECOND = 2.4;

/**
 * Script structure styles.
 * - "standard": free-flowing scenes (Hook → highlights → CTA by duration).
 * - "numbered": hook line → numbered points ("Pehli baat…", "Dusri baat…")
 *   → one short punchy closing line. A writing pattern only — no cost.
 * - "brand_story": documentary brand-story beats (Hook question → Origin
 *   → Twist → Proof → Lesson → CTA), modelled on The Brand Saga's
 *   Indian brand-story Shorts (2026-11-09 analysis, docs/brand-saga-style.md).
 *   Longer format: 5 scenes at 45–60s, 6 scenes at 75–120s.
 * - "macro_hero": Aminul Visuals' cinematic product-commercial beats
 *   (2026-11-10 analysis, docs/aminul-raj-styles.md): Ingredient (extreme
 *   macro texture) → Craft (how it is made) → Hero (product as hero, pack
 *   design untouched) → Closing. 3 scenes when short, 4 at 30–60s.
 *   No faces, one colour world, slow push-in.
 * - "banner_unroll": Raj Photo Editing's CGI banner-unroll shop ad
 *   (2026-11-10 analysis, docs/aminul-raj-styles.md): Hook → the banner
 *   rolls down the building facade revealing the poster → hold + CTA.
 *   Always 3 scenes. The banner shows the brand name only — never a
 *   price, discount, or offer.
 * - "attar_luxury": the ATTAR attar ad the user shared (2026-11-11,
 *   12s, 4 shots, docs/attar-luxury-style.md): Hero (bottle on oud
 *   wood, rose petals, scalloped arch + mashrabiya lattice light, slow
 *   push-in) → Drop (extreme macro: oil drop onto a rose petal) →
 *   Ritual (hands only apply the product to a wrist, bottle small in
 *   the background) → End card (hero close-up + serif brand title).
 *   Always 4 scenes. Warm golden light, one warm colour world, pack
 *   untouched, no faces, no music (voiceover + captions stay).
 */
export type ScriptStyle = "standard" | "numbered" | "brand_story" | "macro_hero" | "banner_unroll" | "attar_luxury" | "wedding_invite";

/** Hinglish ordinals for the numbered style, in scene order. */
export const HINGLISH_ORDINALS = ["Pehli", "Dusri", "Teesri", "Chauthi", "Paanchvi", "Chhathi"];

/**
 * Scene count for a target duration + style. Shared with creative.ts so
 * the creative plan and the generated script always agree.
 * - storyboardChain (Raj's ideas-first chain): always 9 scenes — the
 *   9-scene storyboard, ~5–7s per scene at 45–70s.
 * - banner_unroll: always 3 (Hook → unroll → hold + CTA).
 * - attar_luxury: always 4 (Hero → Drop → Ritual → End card), even
 *   when short — the 4-beat structure IS the style (the 12s reference
 *   ad is 4 shots: ~3.5s + ~3.5s + ~2.5s + ~2.5s).
 * - wedding_invite: always 4 (Names → Functions → Date & Venue →
 *   Closing + RSVP) — the invitation IS the 4-beat structure.
 * - macro_hero: 3 scenes when short (<30s), 4 scenes at 30–60s
 *   (Ingredient → Craft → Hero → Closing).
 * - brand_story: 3 scenes when short (<30s), 5 scenes at 45–60s,
 *   6 scenes at 75–120s (one scene per story beat).
 * - other styles: 3 when short, else 4–7 (one scene per ~9s).
 */
export function sceneCountForStyle(
  targetDurationSec: number,
  style: ScriptStyle,
  opts?: { storyboardChain?: boolean }
): number {
  if (opts?.storyboardChain) return 9;
  if (style === "banner_unroll") return 3;
  if (style === "attar_luxury") return 4;
  if (style === "wedding_invite") return 4;
  if (targetDurationSec < 30) return 3;
  if (style === "brand_story") {
    return targetDurationSec <= 60 ? 5 : 6;
  }
  if (style === "macro_hero") {
    return 4;
  }
  return Math.min(7, Math.max(4, Math.round(targetDurationSec / 9)));
}

function buildScriptPrompt(
  facts: ProductFactsInput,
  sceneCount: number,
  short: boolean,
  style: ScriptStyle = "standard",
  concept?: { title: string; hook: string; angle: string } | null
): string {
  const feats =
    facts.verifiedFeatures.length > 0
      ? facts.verifiedFeatures.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "(no verified features supplied — describe the product type generically)";
  return [
    "You are a Hinglish advertising copywriter for an Indian audience.",
    "Write a natural, conversational product video script in Roman-script Hindi/Hinglish",
    "(the way Indians actually speak — mix Hindi and English words).",
    "",
    "PRODUCT — use ONLY these verified facts. Never invent anything else:",
    `Name: ${facts.productName}`,
    `Brand: ${facts.brand ?? "not specified"}`,
    `Category: ${facts.category ?? "not specified"}`,
    "Verified features:",
    feats,
    ...(concept
      ? [
          "",
          "WINNING AD CONCEPT (chosen from 5 generated concepts — build the whole script on this angle):",
          `Title: ${concept.title}`,
          `Hook line: ${concept.hook}`,
          `Angle: ${concept.angle}`,
          "- Scene 1 MUST open with the hook line above (or a close variant of it).",
          "- Every scene must serve this angle; do not drift to a different idea.",
        ]
      : []),
    "",
    "STRICT RULES:",
    "- Short, human sentences. No robotic repetition.",
    "- Write for the EAR, not the eye: one idea per sentence, short sentences a listener can follow without re-reading. No long written-essay sentences.",
    "- One mood per scene: the hook sounds excited, the middle scenes sound calm and conversational, the closing sounds firm. Never mix happy, sad and whisper in a single scene.",
    "- Write the way Indians actually speak: natural connectors (toh, phir, dekhiye), everyday words, no newsreader or formal phrasing.",
    "- NEVER mention any price, discount, offer, or deal.",
    "- NEVER invent reviews, testimonials, ratings, certifications, or guarantees.",
    "- NEVER make health, financial, safety, or comparative claims.",
    "- End with this neutral call to action: viewers can check product details through the link in the description or profile.",
    "- Write numbers as WORDS, never digits (e.g. 'do ghante', 'teen rang', 'paanch sau gram' — but never state a price). Digits are mispronounced by the voice.",
    `- Write exactly ${sceneCount} scenes. Each scene narration: ${short ? "8-12" : "15-25"} words.`,
    ...SCRIPT_PSYCHOLOGY_LINES,
    ...(style === "numbered"
      ? [
          "",
          "STRUCTURE (numbered style — follow exactly):",
          "- Scene 1 is the HOOK: one bold, attention-grabbing opening line built on the product's most useful verified feature. Do NOT number the hook.",
          `- Scenes 2 to ${sceneCount - 1} are the numbered points. Each point's narration MUST begin with its Hinglish ordinal in this order: ${HINGLISH_ORDINALS.slice(0, Math.max(0, sceneCount - 2)).map((o) => `"${o} baat — "`).join(", ")}. One verified feature per point, in the order the features are listed above.`,
          `- Scene ${sceneCount} is the CLOSING: one short, punchy, memorable line (no numbering, no new facts) that sums up the product in a few words.`,
        ]
      : []),
    ...(style === "brand_story"
      ? [
          "",
          "STRUCTURE (brand-story style — follow exactly):",
          "- Scene 1 is the HOOK: one bold, attention-grabbing QUESTION built on the product's most surprising verified feature (e.g. 'Ganja ya protein?'). The question must be answerable from the verified facts only. Scene 1 onScreenText: the same hook as a short punchy question, max 40 characters, no price.",
          ...(sceneCount === 5
            ? [
                "- Scene 2 is the ORIGIN: where the product/brand started, or the problem it set out to solve — one verified fact only.",
                "- Scene 3 is the TWIST: the turning point — what changed, or the one unusual decision that made it different. One verified fact only.",
                "- Scene 4 is the PROOF: a verified feature shown in action (what it does, how it works). NEVER invent sales, revenue, funding, founder, or market numbers — only the verified features above.",
                `- Scene 5 is the LESSON + CLOSING: one short, punchy takeaway line (no new facts), then the neutral call to action.`,
              ]
            : sceneCount === 6
              ? [
                  "- Scene 2 is the ORIGIN: where the product/brand started, or the problem it set out to solve — one verified fact only.",
                  "- Scene 3 is the TWIST: the turning point — what changed, or the one unusual decision that made it different. One verified fact only.",
                  "- Scene 4 is the PROOF: a verified feature shown in action (what it does, how it works). NEVER invent sales, revenue, funding, founder, or market numbers — only the verified features above.",
                  "- Scene 5 is the LESSON: one short, punchy takeaway line (no new facts).",
                  `- Scene 6 is the CLOSING: the neutral call to action, nothing else.`,
                ]
              : [
                  "- Scene 2 is the TWIST + PROOF in one: the one unusual thing about the product and the verified feature that proves it. NEVER invent sales, revenue, funding, founder, or market numbers.",
                  `- Scene 3 is the LESSON + CLOSING: one short, punchy takeaway line (no new facts), then the neutral call to action.`,
                ]),
        ]
      : []),
    ...(style === "macro_hero"
      ? [
          "",
          "STRUCTURE (macro-hero style — follow exactly):",
          "- Scene 1 is the INGREDIENT: an extreme macro moment — the raw ingredient, texture, condensation or fine detail that makes the product special. One verified feature only. No faces; hands only if they touch the product.",
          ...(sceneCount === 4
            ? [
                "- Scene 2 is the CRAFT: how the product is made or prepared — the process, in one verified fact.",
                "- Scene 3 is the HERO: the product as the hero shot, its design exactly as it is — never redesign, relabel, or change the pack. One verified feature.",
                `- Scene 4 is the CLOSING: one short, punchy takeaway line (no new facts), then the neutral call to action.`,
              ]
            : [
                "- Scene 2 is the CRAFT + HERO in one: how the product is made, then the product as the hero shot, its design exactly as it is — never redesign, relabel, or change the pack. One verified feature only.",
                `- Scene 3 is the CLOSING: one short, punchy takeaway line (no new facts), then the neutral call to action.`,
              ]),
          "- One dominant colour runs through every scene (the product's own colour). No prices, no faces, no invented claims.",
        ]
      : []),
    ...(style === "banner_unroll"
      ? [
          "",
          "STRUCTURE (banner-unroll style — follow exactly):",
          "- Scene 1 is the HOOK: the shop or brand and the one thing it offers — one verified fact only. Scene 1 onScreenText: the brand name, max 40 characters, no price.",
          "- Scene 2 is the UNROLL: the big banner rolls down the building facade and reveals the poster. Narrate the reveal itself (what the banner shows) — one verified feature only. Never mention a price, discount, or offer on the banner.",
          `- Scene 3 is the HOLD + CLOSING: the open banner held on screen, one short punchy line (no new facts), then the neutral call to action.`,
        ]
      : []),
    ...(style === "attar_luxury"
      ? [
          "",
          "STRUCTURE (attar-luxury style — follow exactly):",
          "- Scene 1 is the HERO: the product on warm wood or stone, natural ingredient props around it, golden light through a scalloped arch and lattice screen behind — one verified feature only. No faces.",
          "- Scene 2 is the DROP: an extreme macro moment — a single drop of the oil or essence falling onto its natural ingredient (a petal, a wood chip, the raw material). One verified feature only. No faces; hands only if they hold the dropper.",
          "- Scene 3 is the RITUAL: hands only apply the product to a wrist or skin — the bottle small and soft-focus in the background, warm lattice light across the frame. One verified feature only. No faces, no full body.",
          "- Scene 4 is the END CARD: the hero close-up again, one short punchy line (no new facts), then the neutral call to action. Scene 4 onScreenText: ONE short tagline line, max 60 characters, built ONLY from a verified feature above — never invent a longevity, strength, or efficacy claim (no 'lasts all day', no 'strongest', no 'best'). No price.",
          "- Warm golden light in every scene, one warm colour world (the product's own colour). Pack design exactly as it is — never redesign, relabel, or change the pack.",
        ]
      : []),
    ...(style === "wedding_invite"
      ? [
          "",
          "STRUCTURE (wedding-invite style — follow exactly):",
          "- Scene 1 is the NAMES: the couple's names as the hook — use ONLY the names from the verified facts above. Scene 1 onScreenText: the couple's names, max 40 characters. Never invent a name.",
          "- Scene 2 is the FUNCTIONS: the wedding functions (Haldi, Mehndi, Sangeet, Baraat...) — ONLY the functions listed in the verified facts. One line per function, no invented events.",
          "- Scene 3 is the DATE & VENUE: the wedding date and venue exactly as given in the verified facts. Scene 3 onScreenText: date + venue, max 60 characters. Never invent or change a date or venue.",
          "- Scene 4 is the CLOSING + RSVP: one warm closing line (no new facts), then invite viewers to RSVP. The dmCta keyword for this style is RSVP — the final scene MUST speak it (e.g. 'RSVP ke liye comment me RSVP likho').",
          "- No music: voiceover + captions only. No faces, no AI avatars of the couple — names appear as TEXT on screen only, never as a generated person.",
          "- Numbers as words (dates in words, e.g. 'pandrah December'), never digits.",
        ]
      : []),
    "",
    "AUTO-DM CTA (MANDATORY — every video must drive comment-to-DM):",
    'Every script MUST include a dmCta object: {"keyword":"LINK","ctaLine":"..."}.',
    '- keyword: ONE short uppercase word viewers will comment (default "LINK"). Letters only.',
    '- ctaLine: the exact spoken line, e.g. "Comment me LINK likho — product ka link seedha tumhare DM me bhej dunga."',
    "- The FINAL scene's narration MUST contain the keyword and speak the ctaLine (or a close variant of it).",
    "- Never mention a price, discount, or offer in the ctaLine.",
    "",
    "VISUAL DIRECTION (optional, commercial style — AdGen-style scene treatment):",
    "For each scene you MAY add a visualDirection object with one short line per field:",
    '{"transitionIn":"fade from black","transitionOut":"swipe with light trail","cameraNote":"slow dolly-in","colorNote":"deep blacks with one warm accent"}.',
    "Omit any field you are unsure about; never invent a transition the product cannot show.",
    "At most ONE scene may be a comparison scene: add comparison {leftLabel, rightLabel}",
    "(e.g. leftLabel 'Pehle', rightLabel 'Ab') only when a genuine before/after or",
    "this-vs-ordinary contrast fits the verified facts. Never invent a competitor,",
    "a fake 'before' state, or any comparative claim.",
    "",
    "OUTPUT — valid JSON ONLY, no markdown fences, exactly this shape:",
    '{"scenes":[{"sceneId":"s1","narration":"...","onScreenText":"short on-screen line","claimsAvoided":["..."]}],"callToAction":"...","dmCta":{"keyword":"LINK","ctaLine":"Comment me LINK likho — link seedha tumhare DM me bhej dunga."}}',
    "Optional per-scene fields: \"visualDirection\":{\"transitionIn\":\"...\",\"transitionOut\":\"...\",\"cameraNote\":\"...\",\"colorNote\":\"...\"}, \"comparison\":{\"leftLabel\":\"...\",\"rightLabel\":\"...\"}.",
  ].join("\n");
}

/** Extract the first {...} JSON object from model output (tolerates fences). */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sanitizeOnScreenText(text: string): string | null {
  const t = text.trim().slice(0, 80);
  if (!t || PRICE_PATTERN.test(t)) return null;
  return t;
}

function sanitizeDirectionField(v: unknown, max: number): string | null {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  if (!t || PRICE_PATTERN.test(t)) return null;
  return t;
}

/**
 * MANDATORY auto-DM CTA. Throws when the model omits it or it violates
 * compliance — the caller retries, then fails the job honestly.
 * Exported for unit tests.
 */
export function sanitizeDmCta(raw: unknown): DmCtaT {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model omitted the mandatory dmCta (auto-DM call to action).");
  }
  const d = raw as Record<string, unknown>;
  const keyword = String(d.keyword ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 20);
  if (!keyword) {
    throw new Error("dmCta.keyword must be a single uppercase word (e.g. LINK).");
  }
  const ctaLine = String(d.ctaLine ?? "").trim().slice(0, 160);
  if (!ctaLine) {
    throw new Error("dmCta.ctaLine must be a non-empty spoken line.");
  }
  if (PRICE_PATTERN.test(ctaLine)) {
    throw new Error("dmCta.ctaLine contains a price/offer mention — rejected by compliance.");
  }
  if (BANNED_CLAIM_PATTERN.test(ctaLine)) {
    throw new Error("dmCta.ctaLine contains banned promotional language — rejected by compliance.");
  }
  return { keyword, ctaLine };
}

/** Commercial visual-direction treatment for one scene (all fields optional). */
export interface VisualDirection {
  transitionIn?: string;
  transitionOut?: string;
  cameraNote?: string;
  colorNote?: string;
}

/** Before/after (or this-vs-ordinary) comparison labels for one scene. */
export interface ComparisonSpec {
  leftLabel: string;
  rightLabel: string;
}

function parseVisualDirection(o: Record<string, unknown>): VisualDirection | null {
  const raw = o.visualDirection;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const out: VisualDirection = {};
  const tIn = sanitizeDirectionField(d.transitionIn, 200);
  const tOut = sanitizeDirectionField(d.transitionOut, 200);
  const cam = sanitizeDirectionField(d.cameraNote, 200);
  const col = sanitizeDirectionField(d.colorNote, 200);
  if (tIn) out.transitionIn = tIn;
  if (tOut) out.transitionOut = tOut;
  if (cam) out.cameraNote = cam;
  if (col) out.colorNote = col;
  return Object.keys(out).length > 0 ? out : null;
}

function parseComparison(o: Record<string, unknown>): ComparisonSpec | null {
  const raw = o.comparison;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const left = sanitizeDirectionField(d.leftLabel, 60);
  const right = sanitizeDirectionField(d.rightLabel, 60);
  return left && right ? { leftLabel: left, rightLabel: right } : null;
}

/** True when the DM keyword is spoken anywhere in the narrations. Exported for unit tests. */
export function dmKeywordSpoken(narrations: string[], keyword: string): boolean {
  const kw = keyword.trim().toUpperCase();
  if (!kw) return false;
  return narrations.join("\n").toUpperCase().includes(kw);
}

function toScriptObject(raw: unknown, sceneCount: number): ScriptObjectT {
  const parsed = (raw as { scenes?: unknown; callToAction?: unknown; dmCta?: unknown }) ?? {};
  const scenesIn = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (scenesIn.length === 0) {
    throw new Error("Model returned no scenes.");
  }
  const scenes = scenesIn.slice(0, sceneCount).map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const narration = String(o.narration ?? "").trim();
    if (!narration) throw new Error(`Scene ${i + 1} has empty narration.`);
    if (PRICE_PATTERN.test(narration)) {
      throw new Error(`Scene ${i + 1} narration contains a price/offer mention — rejected by compliance.`);
    }
    const words = narration.split(/\s+/).filter(Boolean).length;
    const onScreen = sanitizeOnScreenText(String(o.onScreenText ?? ""));
    return {
      sceneId: typeof o.sceneId === "string" && o.sceneId ? o.sceneId : `s${i + 1}`,
      narration,
      estimatedSeconds: Math.max(3, Math.round((words / WORDS_PER_SECOND) * 10) / 10),
      evidenceClaimIds: [],
      pronunciationHints: {},
      // carried through validation separately
      _onScreenText: onScreen,
      _claimsAvoided: Array.isArray(o.claimsAvoided)
        ? (o.claimsAvoided as unknown[]).map(String).slice(0, 8)
        : [],
      _visualDirection: parseVisualDirection(o),
      _comparison: parseComparison(o),
    };
  });
  const callToAction =
    typeof parsed.callToAction === "string" && parsed.callToAction.trim()
      ? parsed.callToAction.trim().slice(0, 500)
      : "Check product details through the link in the description or profile.";
  // MANDATORY: auto-DM CTA. Throws → generateScript retries → honest failure.
  const dmCta = sanitizeDmCta(parsed.dmCta);
  if (!dmKeywordSpoken(scenes.map((s) => s.narration), dmCta.keyword)) {
    throw new Error(
      `Mandatory dmCta keyword "${dmCta.keyword}" does not appear in any scene narration.`
    );
  }
  const candidate = {
    schemaVersion: "1.0.0",
    language: "hinglish" as const,
    scenes: scenes.map((s) => ({
      sceneId: s.sceneId,
      narration: s.narration,
      estimatedSeconds: s.estimatedSeconds,
      evidenceClaimIds: s.evidenceClaimIds,
      pronunciationHints: s.pronunciationHints,
    })),
    totalEstimatedSeconds: scenes.reduce((a, s) => a + s.estimatedSeconds, 0),
    callToAction,
    dmCta,
  };
  const validated = ScriptObjectSchema.safeParse(candidate);
  if (!validated.success) {
    throw new Error(`Script failed schema validation: ${validated.error.message.slice(0, 300)}`);
  }
  // Stash per-scene extras for the storyboard step (not part of the schema).
  (validated.data as unknown as { _extras: unknown })._extras = scenes.map((s) => ({
    sceneId: s.sceneId,
    onScreenText: s._onScreenText,
    claimsAvoided: s._claimsAvoided,
    visualDirection: s._visualDirection,
    comparison: s._comparison,
    dmCta: validated.data.dmCta,
  }));
  return validated.data;
}

export interface ScriptExtras {
  sceneId: string;
  onScreenText: string | null;
  claimsAvoided: string[];
  visualDirection: VisualDirection | null;
  comparison: ComparisonSpec | null;
  /** Auto-DM CTA (keyword + spoken line) — same object for every scene. */
  dmCta: DmCtaT;
}

export function scriptExtras(script: ScriptObjectT): ScriptExtras[] {
  return (
    (script as unknown as { _extras?: ScriptExtras[] })._extras ??
    script.scenes.map((s) => ({
      sceneId: s.sceneId,
      onScreenText: null,
      claimsAvoided: [],
      visualDirection: null,
      comparison: null,
      dmCta: script.dmCta,
    }))
  );
}

/**
 * Generate a structured Hinglish script from verified product facts.
 * Throws PipelineError on provider failure or invalid model output.
 * opts.concept: the winning ad concept from the storyboard chain — the
 * whole script is built on its hook + angle.
 * opts.storyboardChain: 9-scene storyboard (Raj's ideas-first chain).
 */
export async function generateScript(
  facts: ProductFactsInput,
  targetDurationSec: number,
  opts?: {
    style?: ScriptStyle;
    concept?: { title: string; hook: string; angle: string } | null;
    storyboardChain?: boolean;
  }
): Promise<ScriptObjectT> {
  const short = targetDurationSec < 30;
  const style: ScriptStyle =
    opts?.style === "numbered"
      ? "numbered"
      : opts?.style === "brand_story"
        ? "brand_story"
        : opts?.style === "macro_hero"
          ? "macro_hero"
          : opts?.style === "banner_unroll"
            ? "banner_unroll"
            : opts?.style === "attar_luxury"
              ? "attar_luxury"
              : opts?.style === "wedding_invite"
                ? "wedding_invite"
                : "standard";
  const sceneCount = sceneCountForStyle(targetDurationSec, style, {
    storyboardChain: opts?.storyboardChain ?? false,
  });

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? buildScriptPrompt(facts, sceneCount, short, style, opts?.concept ?? null)
        : buildScriptPrompt(facts, sceneCount, short, style, opts?.concept ?? null) +
          "\n\nREMINDER: Your last output was not valid JSON. Output ONLY the JSON object, nothing else.";
    // Fail over across providers in router preference order:
    // groq → gemini → pollinations → hf. A dead provider is skipped
    // (circuit breaker) instead of retried per attempt.
    const res = await attemptWithFallback("script", (provider) => {
      switch (provider.key) {
        case "hf":
          return hfInference.generateText({ prompt, params: { max_new_tokens: 1024, temperature: 0.7 } });
        case "groq":
          return groq.generateText({ prompt, maxTokens: 1024, temperature: 0.7 });
        case "gemini":
          return gemini.generateText({ prompt, maxTokens: 1024, temperature: 0.7 });
        default:
          return pollinations.generateText({ prompt, maxTokens: 1024, temperature: 0.7 });
      }
    });
    if (!res.ok) {
      throw new PipelineError(
        "provider_unavailable",
        "script_generation",
        `Script generation failed after trying: ${res.attempted.join(", ") || "no usable provider"}. ${res.error?.message ?? ""}`,
        res.error?.retryable ?? false
      );
    }
    try {
      return toScriptObject(extractJson(res.data as string), sceneCount);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new PipelineError(
    "validation_failed",
    "script_generation",
    `Script model output could not be structured after 2 attempts: ${lastErr}`,
    true
  );
}
