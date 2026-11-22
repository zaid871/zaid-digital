/**
 * Digital storefront catalog tests: manifest scanning, normalization,
 * categories, single-product lookup, and the empty/broken edge cases.
 * Run: npx tsx scripts/test-digital-storefront.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listStoreProducts, getStoreProduct } from "../src/lib/digital/storefront";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

function productDir(root: string, id: string, manifest: Record<string, unknown>, extraFiles: string[] = []) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest), "utf-8");
  for (const f of extraFiles) writeFileSync(join(dir, f), "x", "utf-8");
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "storefront-test-"));
  process.env.DIGITAL_DIR = root;
  try {
    productDir(root, "wedding-invites-abc123", {
      type: "ebook",
      title: "Wedding Invites Guide",
      subtitle: "Shaadi ki planning, step by step",
      topic: "wedding planning",
      chapters: ["Intro", "Venue", "Guest List"],
      wordCount: 5200,
      pdfPages: 12,
      createdAt: "2026-11-14T08:00:00.000Z",
    });
    productDir(
      root,
      "quote-pack-def456",
      { type: "template_pack", title: "Quote Pack", count: 12, kinds: ["quote", "tips"], createdAt: "2026-11-13T08:00:00.000Z" },
      ["preview-1.png", "quote-1.svg"]
    );
    productDir(root, "pod-coffee-ghi789", {
      kind: "pod_design",
      title: "Coffee Lover Tee",
      niche: "coffee",
      style: "minimal",
      shirtColor: "black",
      createdAt: "2026-11-12T08:00:00.000Z",
    }, ["design.png"]);
    productDir(root, "dino-color-jkl012", {
      type: "coloring_book",
      title: "Dino Coloring Book",
      chapters: ["T-Rex", "Triceratops"],
      pdfPages: 24,
      createdAt: "2026-11-11T08:00:00.000Z",
    });
    productDir(root, "mystery-mno345", { type: "mystery_gadget", title: "Mystery Item", createdAt: "2026-11-10T08:00:00.000Z" });
    productDir(root, "budget-tracker-pqr678", { type: "xlsx", title: "Budget Tracker", createdAt: "2026-11-09T08:00:00.000Z" });
    // Broken manifest + a folder with no manifest -> skipped, never a crash.
    const broken = join(root, "broken-stu901");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "manifest.json"), "{not json", "utf-8");
    mkdirSync(join(root, "no-manifest-vwx234"), { recursive: true });
    // A stray file at the root is ignored.
    writeFileSync(join(root, "notes.txt"), "hello", "utf-8");

    const catalog = await listStoreProducts();
    check("6 products listed", catalog.products.length === 6, `got ${catalog.products.length}`);
    check("2 folders skipped", catalog.skipped === 2, `got ${catalog.skipped}`);
    check("newest first", catalog.products[0]?.id === "wedding-invites-abc123", catalog.products[0]?.id ?? "none");
    check("oldest last", catalog.products[5]?.id === "budget-tracker-pqr678", catalog.products[5]?.id ?? "none");

    const bySlug = new Map(catalog.categories.map((c) => [c.slug, c.count]));
    check("ebooks category has 2", bySlug.get("ebooks") === 2, JSON.stringify([...bySlug]));
    check("templates category has 1", bySlug.get("templates") === 1);
    check("pod category has 1", bySlug.get("pod") === 1);
    check("spreadsheets category has 1", bySlug.get("spreadsheets") === 1);
    check("unknown type lands in other", bySlug.get("other") === 1);
    check("categories ordered (ebooks first)", catalog.categories[0]?.slug === "ebooks", catalog.categories[0]?.slug ?? "none");

    const ebook = catalog.products.find((p) => p.id === "wedding-invites-abc123");
    check("ebook details: chapters/pages/words", !!ebook && ebook.details.includes("3 chapters") && ebook.details.includes("12 pages") && ebook.details.some((d) => d.includes("words")), ebook?.details.join(", ") ?? "none");
    check("ebook has no preview image", !!ebook && ebook.previewImage === null);
    const pack = catalog.products.find((p) => p.id === "quote-pack-def456");
    check("template preview image URL", !!pack && pack.previewImage === "/api/v1/digital/files/quote-pack-def456/preview-1.png", pack?.previewImage ?? "null");
    check("template details: count + kinds", !!pack && pack.details.includes("12 templates") && pack.details.some((d) => d.includes("quote")), pack?.details.join(", ") ?? "none");
    const pod = catalog.products.find((p) => p.id === "pod-coffee-ghi789");
    check("pod type comes from kind field", !!pod && pod.type === "pod_design" && pod.category === "pod", pod ? `${pod.type}/${pod.category}` : "none");
    check("pod details: style + colour", !!pod && pod.details.some((d) => d.includes("minimal")) && pod.details.some((d) => d.includes("black")), pod?.details.join(", ") ?? "none");
    const coloring = catalog.products.find((p) => p.id === "dino-color-jkl012");
    check("coloring book badge", !!coloring && coloring.badge === "Coloring Book" && coloring.category === "ebooks");

    const one = await getStoreProduct("ebooks", "wedding-invites-abc123");
    check("getStoreProduct finds the ebook", one?.title === "Wedding Invites Guide", one?.title ?? "null");
    check("getStoreProduct wrong category -> null", (await getStoreProduct("templates", "wedding-invites-abc123")) === null);
    check("getStoreProduct unknown id -> null", (await getStoreProduct("ebooks", "nope-123")) === null);
    check("getStoreProduct path traversal -> null", (await getStoreProduct("ebooks", "../secret")) === null);

    // Empty root -> empty catalog, no crash.
    const emptyRoot = mkdtempSync(join(tmpdir(), "storefront-empty-"));
    process.env.DIGITAL_DIR = emptyRoot;
    const empty = await listStoreProducts();
    check("empty root -> empty catalog", empty.products.length === 0 && empty.categories.length === 0);
    rmSync(emptyRoot, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
