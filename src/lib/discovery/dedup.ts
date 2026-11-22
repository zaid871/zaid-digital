/**
 * Deduplication for discovered products (§3: "Duplicate products reject karna").
 *
 * Semantics match the Prisma `Product.dedupHash` contract exactly:
 *   dedupHash = sha256( normalized(name) + "|" + normalized(brand ?? "") )
 * where normalization = lowercase, trim, collapse internal whitespace.
 */
import { createHash } from "crypto";

/** Lowercase, trim, collapse all whitespace runs to a single space. */
export function normalizeForDedup(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/** 64-char hex sha256 over the normalized name+brand pair. */
export function dedupHash(name: string, brand?: string | null): string {
  const payload = `${normalizeForDedup(name)}|${normalizeForDedup(brand ?? "")}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export interface DedupDuplicate<T> {
  candidate: T;
  duplicateOf: T;
  dedupHash: string;
}

/**
 * Split candidates into first-seen uniques and later duplicates.
 * The first occurrence wins; ordering of `candidates` is preserved.
 */
export function dedupeCandidates<T extends { name: string; brand?: string | null }>(
  candidates: T[],
): { unique: T[]; duplicates: DedupDuplicate<T>[] } {
  const seen = new Map<string, T>();
  const unique: T[] = [];
  const duplicates: DedupDuplicate<T>[] = [];
  for (const candidate of candidates) {
    const hash = dedupHash(candidate.name, candidate.brand);
    const first = seen.get(hash);
    if (first) {
      duplicates.push({ candidate, duplicateOf: first, dedupHash: hash });
    } else {
      seen.set(hash, candidate);
      unique.push(candidate);
    }
  }
  return { unique, duplicates };
}
