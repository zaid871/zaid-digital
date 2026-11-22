/**
 * LUT + Lightroom preset tests: parse the real files back and check
 * the math — .cube row counts + value ranges + look behaviour, .xmp
 * XML validity (python xml.etree) + distinct slider values.
 * Run: npx tsx scripts/test-digital-luts-presets.ts
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { generateLutPack, LUT_SIZE } from "../src/lib/digital/luts";
import { generatePresetPack } from "../src/lib/digital/presets";

const execFileAsync = promisify(execFile);

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

const OUT = "/tmp/digital-luts-presets-test";

/** Parse a .cube file: { size, rows: [r,g,b][] }. */
function parseCube(text: string): { size: number; rows: number[][] } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let size = 0;
  const rows: number[][] = [];
  for (const line of lines) {
    if (line.startsWith("TITLE") || line.startsWith("DOMAIN")) continue;
    if (line.startsWith("LUT_3D_SIZE")) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) rows.push(parts);
  }
  return { size, rows };
}

async function xmlValid(file: string): Promise<boolean> {
  try {
    await execFileAsync("python3", [
      "-c",
      "import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1]); print('ok')",
      file,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // LUT pack: all 5 presets.
  const lut = await generateLutPack({}, { outRoot: OUT });
  check("LUT pack has 5 presets", lut.presets.length === 5, `got ${lut.presets.length}`);
  check("LUT zip exists", lut.files.zip !== null && existsSync(lut.files.zip));
  const cubes = readdirSync(lut.dir).filter((f) => f.endsWith(".cube"));
  check("5 .cube files", cubes.length === 5, `got ${cubes.length}`);

  const identity = parseCube(readFileSync(`${lut.dir}/contrast.cube`, "utf-8"));
  check("LUT_3D_SIZE is 32", identity.size === LUT_SIZE);
  check("32^3 = 32768 rows", identity.rows.length === 32768, `got ${identity.rows.length}`);
  check(
    "all values in [0,1]",
    identity.rows.every((r) => r.every((v) => v >= 0 && v <= 1))
  );
  // Contrast S-curve: lattice point 16/31 -> smoothstep(16/31) ≈ 0.5242
  // (32 points have no exact 0.5; symmetry: s(x) + s(1-x) = 1).
  const mid = identity.rows[16 * 32 * 32 + 16 * 32 + 16];
  const s = (x: number) => x * x * (3 - 2 * x);
  check("contrast mid-point = smoothstep(16/31)", Math.abs(mid[0] - s(16 / 31)) < 0.002, `got ${mid[0]}`);
  check(
    "contrast corners exact",
    identity.rows[0].every((v) => v === 0) && identity.rows[32767].every((v) => v === 1)
  );

  const warm = parseCube(readFileSync(`${lut.dir}/warm.cube`, "utf-8"));
  const warmMeanR = warm.rows.reduce((a, r) => a + r[0], 0) / warm.rows.length;
  const warmMeanB = warm.rows.reduce((a, r) => a + r[2], 0) / warm.rows.length;
  check("warm: mean red > mean blue", warmMeanR > warmMeanB, `${warmMeanR.toFixed(3)} vs ${warmMeanB.toFixed(3)}`);

  const faded = parseCube(readFileSync(`${lut.dir}/faded.cube`, "utf-8"));
  const fadedMin = Math.min(...faded.rows.flat());
  check("faded: blacks lifted (~0.08)", Math.abs(fadedMin - 0.08) < 0.005, `min ${fadedMin}`);

  // Single-preset request.
  const one = await generateLutPack({ presets: ["teal-orange"] }, { outRoot: OUT });
  check("single preset request", one.presets.length === 1 && one.presets[0] === "teal-orange");

  // Unknown preset → full pack + warning (never a fake file).
  const unknown = await generateLutPack({ presets: ["nope" as never] }, { outRoot: OUT });
  check("unknown preset → full pack + warning", unknown.presets.length === 5 && unknown.warnings.some((w) => w.startsWith("unknown_presets")));

  // Preset pack: all 5 looks.
  const pre = await generatePresetPack({}, { outRoot: OUT });
  check("preset pack has 5 looks", pre.presets.length === 5, `got ${pre.presets.length}`);
  check("preset zip exists", pre.files.zip !== null && existsSync(pre.files.zip));
  const xmps = readdirSync(pre.dir).filter((f) => f.endsWith(".xmp"));
  check("5 .xmp files", xmps.length === 5, `got ${xmps.length}`);

  let allXml = true;
  for (const f of xmps) {
    if (!(await xmlValid(`${pre.dir}/${f}`))) {
      allXml = false;
      console.log(`  bad xml: ${f}`);
    }
  }
  check("all .xmp files are valid XML", allXml);

  const warmXmp = readFileSync(`${pre.dir}/warm-glow.xmp`, "utf-8");
  check("warm-glow has Camera Raw sliders", warmXmp.includes('crs:Exposure2012="+0.35"') && warmXmp.includes('crs:Temperature="6200"'));
  const moodyXmp = readFileSync(`${pre.dir}/moody-dark.xmp`, "utf-8");
  check("looks differ (moody is darker)", moodyXmp.includes('crs:Exposure2012="-0.40"'));
  check("xmp carries crs namespace", warmXmp.includes("http://ns.adobe.com/camera-raw-settings/1.0/"));

  // Single look.
  const onePre = await generatePresetPack({ presets: ["golden-hour"] }, { outRoot: OUT });
  check("single look request", onePre.presets.length === 1 && onePre.presets[0] === "golden-hour");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
