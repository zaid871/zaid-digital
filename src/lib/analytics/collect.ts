/**
 * Metric collection (§16: "Actual data hi use karna").
 *
 * This module defines the collection interface and a runner. Providers fetch
 * real numbers from platform APIs; anything a provider cannot return stays
 * null. The runner NEVER invents, estimates, or backfills numbers — a missing
 * metric is simply missing, and provider errors are recorded, not thrown.
 */
import type { PublishMetrics } from "./types";

export interface PublishRecordRef {
  publishRecordId: string;
  platform: string;
  platformMediaId?: string | null;
  productId?: string | null;
  productName?: string | null;
  category?: string | null;
  hook?: string | null;
  format?: string | null;
}

/**
 * A metrics provider (e.g. Instagram Graph API reader, Facebook Page reader).
 * Return null when the platform has no data for this record — the runner
 * treats that as "no data", never as zeros.
 */
export interface MetricsProvider {
  name: string;
  collect(record: PublishRecordRef): Promise<PublishMetrics | null>;
}

export interface CollectionError {
  publishRecordId: string;
  provider: string;
  error: string;
}

export interface CollectionResult {
  metrics: PublishMetrics[];
  errors: CollectionError[];
}

/** Drop physically impossible values (negative counts); keep the rest. */
function sanitize(metric: PublishMetrics): PublishMetrics {
  const clean: PublishMetrics = { ...metric };
  const numericKeys = [
    "views",
    "reach",
    "engagement",
    "likes",
    "comments",
    "linkClicks",
    "conversions",
    "revenueUsd",
  ] as const;
  for (const key of numericKeys) {
    const value = clean[key];
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      clean[key] = null;
    }
  }
  return clean;
}

export async function collectMetrics(
  records: PublishRecordRef[],
  providers: MetricsProvider[]
): Promise<CollectionResult> {
  const metrics: PublishMetrics[] = [];
  const errors: CollectionError[] = [];

  for (const record of records) {
    for (const provider of providers) {
      try {
        const metric = await provider.collect(record);
        if (metric === null) continue; // no data — not an error, not zeros
        metrics.push(
          sanitize({
            ...metric,
            publishRecordId: record.publishRecordId,
            platform: record.platform,
            productId: metric.productId ?? record.productId ?? null,
            productName: metric.productName ?? record.productName ?? null,
            category: metric.category ?? record.category ?? null,
            hook: metric.hook ?? record.hook ?? null,
            format: metric.format ?? record.format ?? null,
            collectedAt: metric.collectedAt ?? new Date().toISOString(),
          })
        );
      } catch (err) {
        errors.push({
          publishRecordId: record.publishRecordId,
          provider: provider.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { metrics, errors };
}
