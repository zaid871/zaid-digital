/**
 * Store admin — product visibility registry.
 *
 * The video's WooCommerce backend panel manages products; the
 * storefront had no management at all. This is the minimal honest
 * version: hide / show a product. Hiding removes it from the public
 * catalog (listing, category pages, detail page, and the store API)
 * but never deletes its files — it is reversible from the same
 * panel, and a hidden product's files stay on disk.
 *
 * The registry is a plain JSON file under the digital root
 * (storage/digital/hidden.json) — a file, not a directory, so the
 * catalog scanner never mistakes it for a product. A missing or
 * corrupt registry reads as "nothing hidden", never a crash.
 */
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { digitalRoot } from "./package";

const HIDDEN_FILE = "hidden.json";

/** Only safe directory basenames may be hidden (same guard as getStoreProduct). */
export function assertSafeStoreId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new Error(`Invalid product id "${id}".`);
  }
}

export async function readHiddenIds(): Promise<Set<string>> {
  let raw: string;
  try {
    raw = await readFile(join(digitalRoot(), HIDDEN_FILE), "utf-8");
  } catch {
    return new Set();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/** Hide (true) or show (false) one product. Returns the new hidden set. */
export async function setHidden(id: string, hidden: boolean): Promise<Set<string>> {
  assertSafeStoreId(id);
  const ids = await readHiddenIds();
  if (hidden) ids.add(id);
  else ids.delete(id);
  await writeFile(join(digitalRoot(), HIDDEN_FILE), JSON.stringify([...ids].sort(), null, 2), "utf-8");
  return ids;
}
