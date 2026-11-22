/**
 * Premium digital designs (BlankBuilder system) tests.
 * Real FFmpeg render + pixel probes for the premium frame; no network
 * (bank copy, no photo background, no image-gen calls).
 */
import { execFile } from "child_process";
import { readFile, rm } from "fs/promises";
import { promisify } from "util";
import {
  buildSvg, generateTemplatePack, TEMPLATE_THEMES,
  type TemplateTheme,
} from "../src/lib/digital/templates";
import { buildPrompt } from "../src/lib/digital/pod";

const execFileAsync = promisify(execFile);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

async function pixelAt(pngPath: string, x: number, y: number): Promise<[number, number, number]> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", pngPath, "-vf", `crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 4096 }
  );
  const buf = stdout as Buffer;
  return [buf[0], buf[1], buf[2]];
}

function closeTo(actual: [number, number, number], expected: [number, number, number], tol = 4): boolean {
  return actual.every((v, i) => Math.abs(v - expected[i]) <= tol);
}

const dark: TemplateTheme = TEMPLATE_THEMES.dark;
const onyx: TemplateTheme = TEMPLATE_THEMES.onyx;

// --- themes ---
check("onyx theme exists with silver accent", onyx.accent === "#C9CDD3" && onyx.bg === "#0B0B0D");
check("onyx has second accent", onyx.accent2 === "#7A7F88");
check("ember theme is orange base + black accent", TEMPLATE_THEMES.ember.bg === "#E85A24" && TEMPLATE_THEMES.ember.accent === "#141414");
check("tealrust theme is teal + rust", TEMPLATE_THEMES.tealrust.accent === "#0F766E" && TEMPLATE_THEMES.tealrust.accent2 === "#B4551F");
check("standard dark theme unchanged", dark.accent === "#FF6B35" && dark.accent2 === undefined);

// --- buildSvg: standard vs premium (quote, portrait) ---
const copy = { kind: "quote" as const, headline: "Chhoti aadat, bada badlav.", body: "Har roz ek chhota kadam." };
const stdSvg = buildSvg(copy, "portrait", dark, "@handle");
const premSvg = buildSvg(copy, "portrait", onyx, "@handle", { designStyle: "premium", subtitle: "budget planner" });

check("standard headline is 78px", stdSvg.includes('font-size="78"'));
check("premium headline is 108px (oversized)", premSvg.includes('font-size="108"'));
check("standard has no top trim band", !stdSvg.includes('height="18"'));
check("premium has top trim band in accent", premSvg.includes('height="18" fill="#C9CDD3"'));
check("premium has bottom trim band in accent2", premSvg.includes('height="10" fill="#7A7F88"'));
check("premium has studio shadow backdrop", premSvg.includes("prem-vig") && premSvg.includes('opacity="0.05"'));
check("standard has no shadow backdrop", !stdSvg.includes("prem-vig"));
check("standard motif appears once", count(stdSvg, 'transform="translate(') === 1);
check("premium motif echoes at three scales", count(premSvg, 'transform="translate(') === 3);
check("premium giant echo is faded", premSvg.includes('opacity="0.07"'));
check("premium has subtitle line (niche)", premSvg.includes("budget planner"));
check("standard has no subtitle line", !stdSvg.includes("budget planner"));

// --- buildSvg: premium logo (bands, no crash) ---
const logoSvg = buildSvg({ kind: "logo", headline: "Budget Planner", body: "Aapki pehchan." }, "portrait", onyx, "@handle", { designStyle: "premium" });
check("premium logo keeps monogram + bands", logoSvg.includes("BP") && logoSvg.includes('height="18" fill="#C9CDD3"'));

// --- POD prompt: premium placement language ---
const podPrompt = buildPrompt({ niche: "fitness", style: "bold_graphic", shirtColor: "black", designText: "NO PAIN" });
check("POD prompt has all-over print", podPrompt.includes("all-over print"));
check("POD prompt echoes motif at two scales", podPrompt.includes("echoed at two scales"));
check("POD prompt is print-ready vector", podPrompt.includes("print-ready vector"));
check("POD prompt drops centred chest composition", !podPrompt.includes("centered composition"));

// --- end-to-end pack + real render + pixel probes ---
async function main() {
  await rm("/tmp/premium-test-pack", { recursive: true, force: true });
  const pack = await generateTemplatePack(
    { niche: "budget planner", count: 4, size: "portrait", theme: "onyx", designStyle: "premium", useAiCopy: false },
    { outRoot: "/tmp/premium-test-pack" }
  );
  check("pack built 4 designs", pack.designs.length === 4);
  check("pack manifest records premium", (await readFile(`${pack.dir}/manifest.json`, "utf-8")).includes('"designStyle": "premium"'));
  const firstSvg = await readFile(`${pack.dir}/design-01.svg`, "utf-8");
  check("pack SVG has premium frame", firstSvg.includes('height="18"'));
  const firstPng = `${pack.dir}/design-01.png`;
  const pngExists = await readFile(firstPng).then(() => true).catch(() => false);
  check("pack PNG preview rendered", pngExists);
  if (pngExists) {
    const topBand = await pixelAt(firstPng, 540, 9);
    check("top band pixel is silver accent", closeTo(topBand, [201, 205, 211]), `got ${topBand}`);
    const bottomBand = await pixelAt(firstPng, 540, 1345);
    check("bottom band pixel is dark silver accent2", closeTo(bottomBand, [122, 127, 136]), `got ${bottomBand}`);
  }

  // Standard pack: same pixel is the plain background (no band).
  await rm("/tmp/standard-test-pack", { recursive: true, force: true });
  const stdPack = await generateTemplatePack(
    { niche: "budget planner", count: 4, size: "portrait", theme: "dark", useAiCopy: false },
    { outRoot: "/tmp/standard-test-pack" }
  );
  const stdPng = `${stdPack.dir}/design-01.png`;
  const stdExists = await readFile(stdPng).then(() => true).catch(() => false);
  if (stdExists) {
    const topPixel = await pixelAt(stdPng, 540, 9);
    check("standard top pixel is plain dark bg", closeTo(topPixel, [17, 19, 24]), `got ${topPixel}`);
  } else {
    check("standard PNG rendered for comparison", false);
  }

  // --- workflow passthrough ---
  const wf = JSON.parse(await readFile("n8n/workflows/digital-template-generation.json", "utf-8")) as {
    nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
  };
  const validateJs = wf.nodes.find((n) => n.name === "validate-input")?.parameters.jsCode ?? "";
  check("workflow passes designStyle through", validateJs.includes("'designStyle'"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL PREMIUM-DESIGN TESTS PASSED");
}

main();
