/**
 * Ad-hoc verification for the Premium Dark preset (not part of CI).
 * 1. isPremiumDark() variants
 * 2. premium-dark storyboard prompt contains the dark-cinematic markers
 * 3. cuesToAss bold flag lands in the ASS Style line
 * 4. Real ffmpeg: subtitles + noise grain on a dark synthetic clip → frame diff proves grain
 */
import { execFile } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { isPremiumDark } from "../src/lib/pipeline/types";
import { buildStoryboard } from "../src/lib/pipeline/storyboard";
import { cuesToAss, parseSrt } from "../src/lib/pipeline/assets";

const execFileAsync = promisify(execFile);
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---- 1. preset matching ----
check("premium_dark matches", isPremiumDark("premium_dark"));
check("premium-dark matches", isPremiumDark("premium-dark"));
check("Premium Dark matches", isPremiumDark("Premium Dark"));
check("clean_studio is not premium", !isPremiumDark("clean_studio"));
check("minimal_dark is not premium", !isPremiumDark("minimal_dark"));
check("null is not premium", !isPremiumDark(null));

// ---- 2. storyboard prompt ----
const script: any = {
  schemaVersion: "1.0.0",
  language: "hinglish",
  scenes: [
    { sceneId: "s1", narration: "Ye hai hamara naya product jo aapke kaam ko aasaan banata hai", estimatedSeconds: 5, evidenceClaimIds: [], pronunciationHints: {} },
    { sceneId: "s2", narration: "Ismein milega dhamakedaar design aur lambi battery life", estimatedSeconds: 5, evidenceClaimIds: [], pronunciationHints: {} },
    { sceneId: "s3", narration: "To der kis baat ki link description me check karo", estimatedSeconds: 5, evidenceClaimIds: [], pronunciationHints: {} },
  ],
  totalEstimatedSeconds: 15,
  callToAction: "Check product details through the link in the description or profile.",
    dmCta: { keyword: "LINK", ctaLine: "Comment me LINK likho — link seedha tumhare DM me bhej dunga." },
};
const identity: any = {
  canonicalName: "Nova X1 Wireless Earbuds",
  brand: "Nova",
  model: "X1",
  category: "Audio",
  colors: ["midnight black"],
  materials: ["matte plastic"],
  distinctiveDetails: ["chrome ring on case"],
  visualConsistencyNotes: "matte black case, chrome ring always visible",
};
const sbDark = buildStoryboard(script, identity, 15, "premium_dark");
const sbStd = buildStoryboard(script, identity, 45, "clean_studio");
const darkPrompt = sbDark.scenes[0].visualPrompt.toLowerCase();
check("dark prompt: near-black background", darkPrompt.includes("near-black"));
check("dark prompt: rim light", darkPrompt.includes("rim light"));
check("dark prompt: accent glow", darkPrompt.includes("accent glow"));
check("dark prompt: product color used as accent", darkPrompt.includes("midnight black"));
check("dark prompt: no bright daylight", darkPrompt.includes("no bright daylight"));
const stdPrompt = sbStd.scenes[0].visualPrompt.toLowerCase();
check("standard prompt unchanged (studio lighting)", stdPrompt.includes("studio lighting") && !stdPrompt.includes("near-black"));
check("short format: 3 scenes for 15s", sbDark.scenes.length === 3);
check(
  "short format: total ~15s",
  Math.abs(sbDark.totalDurationSeconds - 15) < 0.01,
  `got ${sbDark.totalDurationSeconds}`
);

// ---- 3. ASS bold ----
const srt = "1\n00:00:00,000 --> 00:00:02,000\nHello premium world\n";
const cues = parseSrt(srt);
check("srt parses", cues !== null && cues!.length === 1);
const assBold = cuesToAss(cues!, { fontSize: 62, marginV: 175, bold: true });
const assPlain = cuesToAss(cues!, { fontSize: 48, marginV: 150 });
check("bold ASS has Bold=-1", assBold.includes(",&H80000000,-1,0,0,0,"));
check("plain ASS keeps Bold=0", assPlain.includes(",&H80000000,0,0,0,0,"));
check("bold ASS has Fontsize 62", assBold.includes(",62,"));

// ---- 4. real ffmpeg: dark clip + subtitles + grain → verify frame difference ----
const tmp = "/tmp/premium-dark-test";
mkdirSync(tmp, { recursive: true });
const fontCandidates = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];
const font = fontCandidates.find((f) => existsSync(f));
async function main() {
  if (!font) {
    console.log("SKIP  ffmpeg grain test — no DejaVu font found");
  } else {
    const assPath = join(tmp, "test.ass");
    writeFileSync(assPath, assBold);
    const esc = assPath.replace(/'/g, "\\'").replace(/:/g, "\\:");
    // dark synthetic clip, 2s
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "color=c=0x0b0b10:s=1080x1920:r=30:d=2",
      "-vf", `subtitles='${esc}',noise=alls=7:allf=t,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      join(tmp, "grain.mp4"),
    ]);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "color=c=0x0b0b10:s=1080x1920:r=30:d=2",
      "-vf", "format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      join(tmp, "plain.mp4"),
    ]);
    // extract frame 15 from each as raw, compare byte difference
    const f1 = join(tmp, "f1.raw");
    const f2 = join(tmp, "f2.raw");
    await execFileAsync("ffmpeg", ["-hide_banner", "-y", "-i", join(tmp, "grain.mp4"), "-vf", "select=eq(n\\,15)", "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "gray", f1]);
    await execFileAsync("ffmpeg", ["-hide_banner", "-y", "-i", join(tmp, "plain.mp4"), "-vf", "select=eq(n\\,15)", "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "gray", f2]);
    const b1 = (await import("fs")).readFileSync(f1);
    const b2 = (await import("fs")).readFileSync(f2);
    let diff = 0;
    for (let i = 0; i < Math.min(b1.length, b2.length); i += 97) {
      if (b1[i] !== b2[i]) diff++;
    }
    check("grain changes pixels vs plain dark clip", diff > 50, `${diff} sampled pixels differ`);
    // also extract a png to eyeball the caption style
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-y", "-i", join(tmp, "grain.mp4"),
      "-vf", "select=eq(n\\,15)", "-vframes", "1", join(tmp, "caption_check.png"),
    ]);
    console.log(`frame saved: ${join(tmp, "caption_check.png")}`);
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
