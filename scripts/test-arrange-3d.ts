/**
 * Free-3D arranger tests: live Poly Pizza search + GLB downloads,
 * glTF magic verification, per-model licence + creator in manifest.
 * Run: npx tsx scripts/test-arrange-3d.ts
 */
import { existsSync, readFileSync } from "fs";
import { arrangeFree3d } from "./arrange-free-3d";

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

const OUT = "/tmp/digital-3d-test";

async function main() {
  const r = await arrangeFree3d("tree", 2, { outRoot: OUT });
  check("2 models arranged", r.models.length === 2, `got ${r.models.length}`);
  check("zip exists", r.files.zip !== null && existsSync(r.files.zip));
  let allGlb = true;
  for (const m of r.models) {
    const p = `${r.dir}/${m.file}`;
    if (!existsSync(p) || readFileSync(p).subarray(0, 4).toString() !== "glTF") {
      allGlb = false;
      console.log(`  bad glb: ${m.file}`);
    }
  }
  check("all files are valid GLB (glTF magic)", allGlb);
  const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as {
    models: Array<{ title: string; creator: string; licence: string; sourceUrl: string }>;
  };
  check(
    "manifest records creator + licence per model",
    manifest.models.every((m) => m.creator && m.licence && m.sourceUrl.startsWith("https://poly.pizza/m/"))
  );
  check(
    "licences are CC0 or CC-BY",
    manifest.models.every((m) => m.licence.startsWith("CC0") || m.licence.startsWith("CC-BY"))
  );

  // Empty keyword throws honestly.
  try {
    await arrangeFree3d("x", 2, { outRoot: OUT });
    check("short keyword throws", false);
  } catch {
    check("short keyword throws", true);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
