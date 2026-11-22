/**
 * Variant builder for the repost loop — runs in the BullMQ worker.
 *
 * Takes an underperforming original, generates a fresh caption pack
 * (new caption + headlines + hashtags), and marks the variant record
 * "ready" for the n8n workflow to publish at a best-time slot. The
 * video itself is reused — only the copy changes.
 *
 * Safety: the caption pack already drops price/banned-claim fields
 * instead of fabricating replacements. If no usable Instagram caption
 * survives, the variant is parked as NEEDS_REVIEW and never auto-
 * publishes — reusing the old caption would defeat the fix, and
 * inventing one would break the honesty rule.
 *
 * Worker-side only (imports the caption pack, which rides the provider
 * fallback chain). Do not import from a Next.js App Route.
 */
import { db } from "@/lib/db";
import { generateCaptionPack } from "../pipeline/caption-pack";

export async function runVariantBuild(variantRecordId: string): Promise<void> {
  const record = await db.publishRecord.findUnique({
    where: { id: variantRecordId },
  });
  if (!record) throw new Error(`[variant] record ${variantRecordId} not found`);
  if (!record.variantOf) throw new Error(`[variant] record ${variantRecordId} is not a variant (no variantOf)`);

  const park = async (reason: string) => {
    await db.publishRecord.update({
      where: { id: variantRecordId },
      data: { status: "needs_review", errorMessage: reason.slice(0, 500) },
    });
    console.log(`[variant] ${variantRecordId} parked for review: ${reason}`);
  };

  // Product facts: prefer the job's research row, fall back to Product.
  const job = record.jobId
    ? await db.job.findUnique({ where: { id: record.jobId }, include: { research: true } })
    : null;
  const product = record.productId
    ? await db.product.findUnique({ where: { id: record.productId } })
    : null;
  const productName = job?.research?.productName ?? product?.canonicalName ?? null;
  if (!productName) {
    await park("Product facts nahi mile (na research row, na product) — caption nahi ban sakta.");
    return;
  }
  const features = job?.research?.features ?? [];
  const category = job?.research?.category ?? product?.category ?? null;

  let pack;
  try {
    pack = await generateCaptionPack({
      productName,
      features,
      productCategory: category,
      tone: "friendly",
    });
  } catch (err) {
    await park(`Caption pack failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return;
  }
  if (!pack.instagram) {
    await park(
      "Caption pack se koi usable Instagram caption nahi bana (compliance ne fields drop kar diye) — purani caption dobara lagana fix nahi hota, is liye human review chahiye."
    );
    return;
  }

  const caption =
    pack.hashtags.length > 0 ? `${pack.instagram}\n${pack.hashtags.join(" ")}` : pack.instagram;
  await db.publishRecord.update({
    where: { id: variantRecordId },
    data: { caption: caption.slice(0, 2200), status: "ready", errorMessage: null },
  });
  console.log(`[variant] ${variantRecordId} ready (${pack.warnings.length} pack warnings).`);
}
