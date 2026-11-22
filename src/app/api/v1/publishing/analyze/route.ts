/**
 * POST /api/v1/publishing/analyze — pure repost analysis.
 *
 * Takes publish records with their metrics and returns the baseline,
 * per-record verdicts, hypothesis-labeled explanations, and repost
 * eligibility. No AI calls, no side effects — safe to call for
 * inspection. The sweep route uses the same logic internally.
 */
import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import {
  computeBaseline,
  evaluateCandidate,
  type RepostCandidateInput,
} from "@/lib/publishing/repost";

const MetricsSchema = z.object({
  views: z.number().nullable(),
  reach: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
});

const ItemSchema = z.object({
  publishRecordId: z.string().min(1),
  platformMediaId: z.string().min(1),
  publishedAt: z.string().datetime(),
  variantCount: z.number().int().min(0).default(0),
  isVariant: z.boolean().default(false),
  metrics: MetricsSchema,
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1).max(50),
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
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return failure("validation_error", "Invalid analyze payload.", 422, parsed.error.flatten());
  }
  const now = new Date();
  const baseline = computeBaseline(parsed.data.items.map((i) => i.metrics));
  const results = parsed.data.items.map((i) =>
    evaluateCandidate(i as RepostCandidateInput, baseline, now)
  );
  return success({ baseline, results });
}
