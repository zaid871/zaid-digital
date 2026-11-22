/**
 * test-digital-store-admin: hidden registry + catalog visibility.
 * Fixture manifests in a temp DIGITAL_DIR — no live storage touched.
 * Run: npx tsx scripts/test-digital-store-admin.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listStoreProducts, getStoreProduct } from "../src/lib/digital/storefront";
import { readHiddenIds, setHidden } from "../src/lib/digital/store-admin";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

function productDir(root: string, id: string, manifest: Record<string, unknown>) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest), "utf-8");
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "store-admin-test-"));
  process.env.DIGITAL_DIR = root;
  try {
    productDir(root, "wedding-abc123", { type: "ebook", title: "Wedding Guide", createdAt: "2026-11-14T08:00:00.000Z" });
    productDir(root, "quote-def456", { type: "template_pack", title: "Quote Pack", createdAt: "2026-11-13T08:00:00.000Z" });
    productDir(root, "budget-ghi789", { type: "xlsx", title: "Budget Tracker", createdAt: "2026-11-12T08:00:00.000Z" });

    check("empty registry reads as empty set", (await readHiddenIds()).size === 0);

    await setHidden("quote-def456", true);
    const hidden = await readHiddenIds();
    check("hide records the id", hidden.has("quote-def456") && hidden.size === 1, [...hidden].join());

    const listed = await listStoreProducts();
    check("hidden product excluded from public catalog",
      listed.products.length === 2 && listed.products.every((p) => p.id !== "quote-def456"),
      listed.products.map((p) => p.id).join());
    check("public catalog counts exclude hidden", listed.categories.every((c) => c.count <= 2));

    const all = await listStoreProducts({ includeHidden: true });
    check("includeHidden lists all 3", all.products.length === 3, String(all.products.length));
    const hiddenRow = all.products.find((p) => p.id === "quote-def456");
    check("includeHidden marks the hidden flag", hiddenRow?.hidden === true, String(hiddenRow?.hidden));
    check("visible products are not flagged", all.products.filter((p) => p.id !== "quote-def456").every((p) => p.hidden === false));

    check("hidden product detail returns null",
      (await getStoreProduct("templates", "quote-def456")) === null);
    check("visible product detail still works",
      (await getStoreProduct("ebooks", "wedding-abc123"))?.title === "Wedding Guide");

    await setHidden("quote-def456", false);
    check("unhide restores the product",
      (await listStoreProducts()).products.length === 3 && (await readHiddenIds()).size === 0);

    let threw = false;
    try {
      await setHidden("../escape", true);
    } catch {
      threw = true;
    }
    check("unsafe id is rejected", threw);

    // Corrupt registry -> empty set, never a crash; next write heals it.
    writeFileSync(join(root, "hidden.json"), "{not json", "utf-8");
    check("corrupt registry reads as empty", (await readHiddenIds()).size === 0);
    await setHidden("budget-ghi789", true);
    check("write after corrupt registry heals it", (await readHiddenIds()).has("budget-ghi789"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
