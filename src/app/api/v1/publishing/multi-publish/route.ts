/**
 * POST /api/v1/publishing/multi-publish — analyze-then-promote router.
 *
 * Body: {
 *   product: { name, category, link, imageUrl?, description?, features?[] },
 *   platforms?: ("pinterest" | "linkedin" | "x" | "reddit" | "quora" | "threads")[]   // omit → auto-route by fit
 *   subreddit?: string   // Reddit target (plain name); empty stays empty for the human
 *   question?: string    // the real question the Quora answer / X thread answers (Problem Miner output)
 * }
 *
 * Flow: platform-fit.fitFor(product) ranks Pinterest/X/LinkedIn/Reddit/Quora/Threads.
 * Pinterest, LinkedIn and Threads publish immediately via their free APIs. Quora,
 * Reddit and X are MANUAL lanes — the endpoint returns ready-to-post drafts
 * (Quora has no API; Reddit's Data API is closed to new developers; the X
 * API is pay-per-use). A human posts each draft in one tap, free.
 *
 * Per-platform failures are collected, never thrown: the response lists
 * every platform with published | draft | skipped | failed.
 */
import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { multiPublish } from "@/lib/publishing/multi-publish";
import type { SocialProduct } from "@/lib/publishing/social-copy";

export type { MultiPublishStatus, PlatformResult } from "@/lib/publishing/multi-publish";

const ProductSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  link: z.string().url().max(2048),
  imageUrl: z.string().url().max(2048).optional(),
  description: z.string().max(1000).optional(),
  features: z.array(z.string().max(160)).max(8).optional(),
});

const BodySchema = z.object({
  product: ProductSchema,
  platforms: z.array(z.enum(["pinterest", "linkedin", "x", "reddit", "quora", "threads"])).max(6).optional(),
  subreddit: z.string().min(1).max(100).optional(),
  question: z.string().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  const secretErr = checkN8nSecret(request);
  if (secretErr) return failure("unauthorized", secretErr, 401);

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return failure("validation_failed", parsed.error.message.slice(0, 400), 400);
  }
  const { product } = parsed.data;
  const socialProduct: SocialProduct = {
    name: product.name,
    category: product.category,
    link: product.link,
    imageUrl: product.imageUrl,
    description: product.description,
    features: product.features,
  };

  const { fits, results } = await multiPublish(socialProduct, parsed.data.platforms, {
    subreddit: parsed.data.subreddit,
    question: parsed.data.question,
  });

  return success({
    product: product.name,
    fits: fits.map((f) => ({
      platform: f.platform,
      fit: f.fit,
      publishMode: f.publishMode,
      reasons: f.reasons,
      note: f.note,
    })),
    results,
  });
}
