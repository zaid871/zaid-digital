/**
 * Icon-bundle tests: all SVGs exist + well-formed, sprite has every
 * symbol, PNG previews exist AND actually drew pixels (PIL check —
 * a broken path would render a blank image).
 * Run: npx tsx scripts/test-digital-icons.ts
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { generateIconBundle, ICONS } from "../src/lib/digital/icons";

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

const OUT = "/tmp/digital-icons-test";

/** Fraction of non-background pixels in a PNG (PIL). 0 = blank/broken. */
async function inkFraction(pngPath: string): Promise<number> {
  const { stdout } = await execFileAsync("python3", [
    "-c",
    "import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert('RGB'); px = list(im.getdata()); bg = px[0]; ink = sum(1 for p in px if sum(abs(a-b) for a,b in zip(p, bg)) > 30); print(ink / len(px))",
    pngPath,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function main() {
  const r = await generateIconBundle({ theme: "dark", accent: "#FF6B35" }, { outRoot: OUT });
  check("16 icons", r.icons.length === 16, `got ${r.icons.length}`);
  check("4 patterns", r.patterns.length === 4, `got ${r.patterns.length}`);
  check("zip exists", r.files.zip !== null && existsSync(r.files.zip));

  const iconSvgs = readdirSync(`${r.dir}/icons`).filter((f) => f.endsWith(".svg"));
  check("16 icon SVG files", iconSvgs.length === 16, `got ${iconSvgs.length}`);
  const iconPngs = readdirSync(`${r.dir}/icons`).filter((f) => f.endsWith(".png"));
  check("16 icon PNG previews", iconPngs.length === 16, `got ${iconPngs.length}`);

  // Every icon SVG is well-formed XML with the right viewBox + stroke.
  let wellFormed = true;
  for (const icon of ICONS) {
    const svg = readFileSync(`${r.dir}/icons/${icon.name}.svg`, "utf-8");
    if (!svg.includes('viewBox="0 0 24 24"') || !svg.includes('stroke="#FF6B35"') || !svg.trimEnd().endsWith("</svg>")) {
      wellFormed = false;
      console.log(`  bad svg: ${icon.name}`);
    }
  }
  check("all icon SVGs well-formed + accent applied", wellFormed);

  // Sprite has every symbol.
  const sprite = readFileSync(r.files.sprite, "utf-8");
  check(
    "sprite has 16 symbols",
    ICONS.every((i) => sprite.includes(`id="icon-${i.name}"`)),
    ""
  );

  // Patterns: 4 SVGs + 4 PNGs, seamless tile size.
  const patSvgs = readdirSync(`${r.dir}/patterns`).filter((f) => f.endsWith(".svg"));
  check("4 pattern SVG files", patSvgs.length === 4);
  const dots = readFileSync(`${r.dir}/patterns/dots.svg`, "utf-8");
  check("dots tile is 200x200", dots.includes('width="200" height="200"'));

  // Ink check: every icon PNG actually drew something (catches bad paths).
  let blank = 0;
  for (const icon of ICONS) {
    const frac = await inkFraction(`${r.dir}/icons/${icon.name}.png`);
    if (!(frac > 0.001)) {
      blank++;
      console.log(`  blank icon: ${icon.name} (ink ${frac})`);
    }
  }
  check("all 16 icon PNGs have ink", blank === 0, `${blank} blank`);
  const dotsInk = await inkFraction(`${r.dir}/patterns/dots.png`);
  check("dots pattern PNG has ink", dotsInk > 0.01, `ink ${dotsInk}`);

  // Light theme + custom accent.
  const light = await generateIconBundle({ theme: "light", accent: "#123456" }, { outRoot: OUT });
  const lightSvg = readFileSync(`${light.dir}/icons/home.svg`, "utf-8");
  check("custom accent applied", lightSvg.includes('stroke="#123456"'));
  check("NOTICE credits Feather/MIT", readFileSync(`${light.dir}/NOTICE.txt`, "utf-8").includes("MIT License"));

  // Patterns off.
  const noPat = await generateIconBundle({ includePatterns: false }, { outRoot: OUT });
  check("patterns off → 0 patterns", noPat.patterns.length === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
