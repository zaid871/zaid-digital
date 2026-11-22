import { z } from "zod";
import { success, failure } from "@/lib/envelope";
import { checkN8nSecret } from "@/lib/api-auth";
import { generateBriefs } from "@/lib/digital/briefs";

/**
 * POST /api/v1/digital/briefs — build idea briefs from the Problem
 * Miner latest run (problems + rising queries).
 *
 * Each brief: product type + niche + kind/theme (templates) or chapter
 * outline (ebooks) + demand evidence + trend + catalog gap + MARKET gap
 * (bestsellers mein kya kami hai) + styleProfile (bestseller style) +
 * uniqueness angles IN THAT STYLE. Briefs are a QUEUE for human pick —
 * this endpoint never starts generation; the user picks a brief and
 * fires the generation workflow.
 *
 * Body: { productTypes?: ["template","ebook","planner","spreadsheet"],
 *   maxBriefs?: 1-10 (default 6), useAi?: boolean (default true),
 *   competitors?: [{title, source?, note?}] (manual bestseller lane),
 *   includeYouTube?: boolean (default true; needs YOUTUBE_API_KEY,
 *   na ho to skip + warning),
 *   includeEtsy?: boolean (default true; needs ETSY_API_KEY,
 *   na ho to skip + warning) }
 * Miner hasn't run yet → 200 with briefs: [] + not_mined_yet warning.
 */
const bodySchema = z.object({
  productTypes: z
    .array(z.enum(["template", "ebook", "planner", "spreadsheet"]))
    .min(1)
    .max(4)
    .optional(),
  maxBriefs: z.number().int().min(1).max(10).optional(),
  useAi: z.boolean().optional(),
  competitors: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        source: z.string().min(2).max(40).optional(),
        note: z.string().max(300).optional(),
      })
    )
    .max(20)
    .optional(),
  includeYouTube: z.boolean().optional(),
  includeEtsy: z.boolean().optional(),
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
    return failure("validation_error", "Invalid briefs payload.", 422, parsed.error.flatten());
  }
  try {
    const result = await generateBriefs(parsed.data);
    return success(result);
  } catch (err) {
    return failure("generation_failed", err instanceof Error ? err.message : String(err), 500);
  }
}
