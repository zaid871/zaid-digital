/**
 * Pinterest volume engine (7-point plan #2).
 *
 * Strategy: 5-10 DIFFERENT pins per product (not the same pin reposted) —
 * har pin ek alag angle (outcome, how-to, comparison, audience, use-case).
 * Pins months tak compound karte hain — ye "sleeping salesmen" hain.
 *
 * buildPinVariations: LLM se N distinct angle-based pin copies
 * (compliance-scanned; violating dropped). publishVolume: har variation ko
 * createImagePin se publish (sequential; per-pin published/failed collected,
 * never throws).
 *
 * Worker-side (LLM failover direct). Endpoint: POST /api/v1/publishing/pinterest-volume.
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "../digital/ebook";
import { createImagePin, type PinterestPinCopy } from "./pinterest";
import type { SocialProduct } from "./social-copy";

export type VolumeTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface PinVariation extends PinterestPinCopy {
  angle: string;
}

const variationsSchema = z.object({
  pins: z.array(z.object({
    angle: z.string().max(60),
    title: z.string().max(100),
    description: z.string().max(800),
  })).max(12),
});

function clean(text: string): boolean {
  return !PRICE_PATTERN.test(text) && !BANNED_CLAIM_PATTERN.test(text);
}

/**
 * Generate N distinct pin angles for one product. Verified features only.
 */
export async function buildPinVariations(
  product: SocialProduct,
  count: number,
  textGen: VolumeTextGen = ebookTextGen
): Promise<{ pins: PinVariation[]; warnings: string[] }> {
  const n = Math.max(3, Math.min(10, Math.floor(count) || 5));
  const warnings: string[] = [];
  const features = (product.features ?? []).filter(Boolean).slice(0, 6);
  const prompt = `Write ${n} DIFFERENT Pinterest pin copies in Hinglish (Roman script, Indian audience) for this product. Each pin = ek alag angle: outcome/result, how-to/use-case, specific audience, problem-solution, feature spotlight, comparison, seasonal, beginner guide.
Product: ${product.name}
Verified features (sirf yehi use karo, invent mat karo): ${features.join(" | ") || "none provided — keep general and honest"}
RULES: title ≤100 chars (keyword-rich, front-loaded), description ≤800 chars (keywords + 1 soft CTA, no link text needed). NO prices, NO discounts, NO fake urgency, NO guaranteed results, NO fake reviews, NO "#1" claims.
Return ONLY valid JSON, no markdown fences: {"pins":[{"angle":"outcome","title":"...","description":"..."}]}`;

  let raw: string;
  try {
    raw = await textGen(prompt, 1500);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `Pin variation generation failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "Pin model returned unparseable output.");
  }
  let parsed: z.infer<typeof variationsSchema>;
  try {
    parsed = variationsSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "Pin model returned invalid JSON shape.");
  }
  const pins: PinVariation[] = [];
  const seenAngles = new Set<string>();
  for (const p of parsed.pins.slice(0, n)) {
    if (!clean(p.title) || !clean(p.description)) {
      warnings.push(`pin "${p.angle}" dropped: price/claim pattern matched.`);
      continue;
    }
    if (seenAngles.has(p.angle.toLowerCase())) {
      warnings.push(`pin "${p.angle}" dropped: duplicate angle.`);
      continue;
    }
    seenAngles.add(p.angle.toLowerCase());
    pins.push({ angle: p.angle, title: p.title, description: p.description });
  }
  return { pins, warnings };
}

export interface VolumePublishResult {
  angle: string;
  status: "published" | "failed";
  pinId?: string;
  error?: string;
}

/** Publish each variation as its own pin. Per-pin results; never throws. */
export async function publishVolume(
  product: SocialProduct,
  pins: PinVariation[],
  opts?: { boardId?: string; fetchFn?: typeof fetch }
): Promise<VolumePublishResult[]> {
  const out: VolumePublishResult[] = [];
  for (const pin of pins) {
    try {
      const r = await createImagePin(
        { ...product, name: pin.title, description: pin.description },
        opts
      );
      out.push({ angle: pin.angle, status: "published", pinId: r.pinId });
    } catch (err) {
      out.push({
        angle: pin.angle, status: "failed",
        error: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    }
  }
  return out;
}
