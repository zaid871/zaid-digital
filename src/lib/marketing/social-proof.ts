/**
 * Honest social-proof collector (7-point plan #7).
 *
 * Doctrine: SIRF real, attributed, verified reviews. Kabhi fake reviews,
 * ratings, testimonials generate mat karo — ye hamari sabse badi moat hai
 * (competitors fake reviews use karte hain = trust gap hamara mauka).
 *
 * Flow: delivery ke 7 din baad review-request email → buyer webhook par
 * review bhejta hai → recordReview verify + store karta hai →
 * getVerifiedReviews sales page/FAQ par dikhata hai.
 *
 * Storage: storage/reviews/<productKey>.json (JSON lines).
 * Worker-side (fs only). Endpoint: POST /api/v1/marketing/reviews.
 */
import { mkdir, readFile, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError } from "../digital/ebook";

const reviewSchema = z.object({
  email: z.string().email().max(120),
  product: z.string().min(2).max(120),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(4).max(500),
});

export type Review = z.infer<typeof reviewSchema> & { at: string; verified: boolean };

function reviewsDir(): string {
  return process.env.REVIEWS_DIR ?? join(process.cwd(), "storage", "reviews");
}

function key(product: string): string {
  return product.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/**
 * Record a buyer review. Verified = email matches a license record
 * (v2: selling layer). v1: verified=false unless caller passes proof —
 * NEVER mark verified without evidence.
 */
export async function recordReview(
  raw: unknown,
  opts?: { verifiedEmail?: string }
): Promise<Review> {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DigitalError("validation_error", "Invalid review payload.");
  }
  const { email, product, rating, text } = parsed.data;
  if (PRICE_PATTERN.test(text) || BANNED_CLAIM_PATTERN.test(text)) {
    throw new DigitalError("validation_error", "Review contains disallowed content.");
  }
  const verified = !!opts?.verifiedEmail && opts.verifiedEmail.toLowerCase() === email.toLowerCase();
  const review: Review = { email, product, rating, text, at: new Date().toISOString(), verified };
  const dir = reviewsDir();
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${key(product)}.jsonl`), JSON.stringify(review) + "\n");
  return review;
}

/** Get verified reviews for a product (sales page display). Unverified included but flagged. */
export async function getReviews(product: string): Promise<Review[]> {
  try {
    const raw = await readFile(join(reviewsDir(), `${key(product)}.jsonl`), "utf-8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Review);
  } catch {
    return [];
  }
}

/** Summary for sales pages: count + avg — computed, never invented. */
export async function reviewSummary(product: string): Promise<{ count: number; verifiedCount: number; avgRating: number | null }> {
  const reviews = await getReviews(product);
  const verified = reviews.filter((r) => r.verified);
  return {
    count: reviews.length,
    verifiedCount: verified.length,
    avgRating: reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null,
  };
}
