/**
 * Kinetic caption tests: word-highlight ASS structure + timing sanity.
 * Pure string checks, no rendering. Run: npx tsx scripts/test-kinetic-captions.ts
 */
import { cuesToKineticAss, type ParsedCue } from "../src/lib/pipeline/assets";

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

const ACCENT = "{\\1c&H00356BFF}";

function dialogues(ass: string): string[] {
  return ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
}
function times(line: string): { start: number; end: number } {
  const m = line.match(/Dialogue: 0,(\d+):(\d+):(\d+)\.(\d+),(\d+):(\d+):(\d+)\.(\d+),/);
  if (!m) throw new Error("bad dialogue line: " + line);
  const toSec = (h: string, mi: string, s: string, cs: string) =>
    Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(cs) / 100;
  return {
    start: toSec(m[1], m[2], m[3], m[4]),
    end: toSec(m[5], m[6], m[7], m[8]),
  };
}

const cues: ParsedCue[] = [
  { start: 0, end: 3, text: "ye bottle bohot khaas hai doston" },
  { start: 3, end: 5, text: "steel body" },
];
const ass = cuesToKineticAss(cues, { fontSize: 62, bold: true });

check("ASS has 1080x1920 PlayRes", ass.includes("PlayResX: 1080") && ass.includes("PlayResY: 1920"));
check("ASS is bold style", ass.includes(",62,") && ass.includes(",-1,"));

// 6 words in cue 1 + 2 words in cue 2 = 8 word events
const lines = dialogues(ass);
check("one Dialogue event per word (8)", lines.length === 8, String(lines.length));

// Each word highlighted exactly once
const highlightCount = (ass.match(/\{\\1c&H00356BFF\}/g) ?? []).length;
check("each word highlighted exactly once (8)", highlightCount === 8, String(highlightCount));
for (const w of ["ye", "bottle", "bohot", "khaas", "hai", "doston", "steel", "body"]) {
  check(`word "${w}" appears highlighted`, ass.includes(`${ACCENT}${w}{`));
}

// Timing: chronological, within cue windows, last event of cue 1 ends at 3.00
{
  const ts = lines.map(times);
  check("events chronological", ts.every((t, i) => i === 0 || ts[i - 1].start <= t.start + 0.001));
  check("first event starts at 0", Math.abs(ts[0].start - 0) < 0.011);
  check("cue 1 last word ends at 3.00", Math.abs(ts[5].end - 3) < 0.011, String(ts[5].end));
  check("cue 2 last word ends at 5.00", Math.abs(ts[7].end - 5) < 0.011, String(ts[7].end));
  check("no event crosses into next cue", ts[5].end <= 3.001 && ts[6].start >= 2.999);
}

// Chunking: first event shows a ≤3-word chunk (highlight + 2 plain words max)
{
  const firstText = lines[0].split(",,").pop() ?? "";
  const plainWords = firstText.replace(/\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean);
  check("chunk shows ≤3 words", plainWords.length >= 1 && plainWords.length <= 3, JSON.stringify(plainWords));
}

// Empty/whitespace cue is skipped, not crashed
{
  const ass2 = cuesToKineticAss([{ start: 0, end: 1, text: "   " }]);
  check("empty cue produces no dialogues", dialogues(ass2).length === 0);
}

// Custom accent color is honored
{
  const ass3 = cuesToKineticAss([{ start: 0, end: 1, text: "hello" }], { accentAss: "&H0000FF00" });
  check("custom accent honored", ass3.includes("{\\1c&H0000FF00}hello{"));
}

// Sticker highlight (AIpreneur style): current word as black-on-yellow
{
  const ass4 = cuesToKineticAss([{ start: 0, end: 2, text: "ye bottle best hai" }], { stickerHighlight: true });
  const evs = dialogues(ass4);
  check("sticker mode still emits one event per word", evs.length === 4);
  check(
    "sticker word is black text on yellow",
    evs[0].includes("{\\1c&H000000&\\3c&H00FFFF&\\bord8}ye{\\1c&H00FFFFFF&\\3c&H00000000&\\bord2}")
  );
  check("sticker mode resets after the word", evs[0].includes("} bottle best"));
  check("sticker mode does not use the orange accent", !ass4.includes("&H00356BFF"));
  const ass5 = cuesToKineticAss([{ start: 0, end: 2, text: "ye bottle best hai" }]);
  check("default mode keeps the orange accent", ass5.includes("{\\1c&H00356BFF}ye{\\1c&H00FFFFFF}"));
  check("default mode has no sticker border", !ass5.includes("\\bord8"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL KINETIC-CAPTION TESTS PASSED");
