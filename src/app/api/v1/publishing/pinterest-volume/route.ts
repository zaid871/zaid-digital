import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { DigitalError } from "@/lib/digital/ebook";
import { buildPinVariations, publishVolume } from "@/lib/publishing/pinterest-volume";

/**
 * POST /api/v1/publishing/pinterest-volume — Pinterest volume engine.
 *
 * Body: { product: {name, category, link, imageUrl, description?, features?[]},
 *         count?: 5-10, boardId?, dryRun?: true }
 * Builds N distinct angle-based pins → publishes each (or dryRun: returns
 * the copies without publishing). Per-pin published/failed, never throws.
 */
const bodySchema = z.object({
  product: z.object({
    name: z.string().min(2).max(120),
    category: z.string().min(1).max(60),
    link: z.string().url(),
    imageUrl: z.string().url(),
    description: z.string().max(500).optional(),
    features: z.array(z.string().max(120)).max(8).optional(),
  }),
  count: z.number().int().min(3).max(10).optional(),
  boardId: z.string().min(1).max(60).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  const authErr = checkN8nSecret(request);
  if (authErr) return failure("unauthorized", authErr, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid pinterest-volume payload.", 422, parsed.error.flatten());
  }
  try {
    const { pins, warnings } = await buildPinVariations(parsed.data.product, parsed.data.count ?? 5);
    if (parsed.data.dryRun) {
      return success({ dryRun: true, pins, warnings });
    }
    const results = await publishVolume(parsed.data.product, pins, { boardId: parsed.data.boardId });
    const published = results.filter((r) => r.status === "published").length;
    return success({ published, total: results.length, results, warnings });
  } catch (err) {
    if (err instanceof DigitalError) return failure(err.code, err.message, 502);
    return failure("volume_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
