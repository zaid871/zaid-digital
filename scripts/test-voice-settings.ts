/**
 * Voice-settings tests (2026-11-12): human-sounding voice presets from 4
 * YouTube videos on realistic AI voices (Fish Audio / Cartesia / ElevenLabs
 * techniques, mapped to the free edge-tts stack).
 *
 * Pure-function tests for voice-presets.ts (roles, SSML builder, bounds)
 * plus a real-ffmpeg test for applyVoicePolish (Lexis-style clarity EQ).
 * No network: no TTS provider is called.
 * Run: npx tsx scripts/test-voice-settings.ts
 */
import { execFile } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { probeMedia } from "../src/lib/pipeline/assets";
import { applyVoicePolish } from "../src/lib/pipeline/voice";
import {
  buildSsmlNarration,
  plainNarration,
  roleForScene,
  splitSentences,
  stripEmotionTags,
  VOICE_PRESETS,
  type VoiceRole,
} from "../src/lib/pipeline/voice-presets";

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

// ---- role mapping: purpose first -------------------------------------------
const purposeCases: Array<[string, VoiceRole]> = [
  ["hook", "hook"],
  ["hero", "hook"],
  ["call_to_action", "cta"],
  ["feature_highlight", "proof"],
  ["comparison", "proof"],
  ["detail_closeup", "proof"],
  ["ingredient", "body"],
  ["craft", "body"],
  ["ritual", "body"],
  ["use_case", "body"],
  ["banner_unroll", "body"],
];
for (const [purpose, role] of purposeCases) {
  check(`purpose ${purpose} -> ${role}`, roleForScene(purpose, 1, 4) === role);
}
// Positional fallback for unknown purposes (role must not depend on the name)
check("unknown purpose, first scene -> hook", roleForScene("something_new", 0, 3) === "hook");
check("unknown purpose, last scene -> cta", roleForScene("something_new", 2, 3) === "cta");
check("unknown purpose, middle scene -> body", roleForScene("something_new", 1, 3) === "body");
check("cta purpose wins even mid-video", roleForScene("call_to_action", 1, 4) === "cta");

// ---- sentence splitting ----------------------------------------------------
check(
  "splitSentences keeps terminators",
  JSON.stringify(splitSentences("Pehli baat. Dusri baat! Teesri baat?")) ===
    JSON.stringify(["Pehli baat.", "Dusri baat!", "Teesri baat?"])
);
check(
  "splitSentences handles Hindi danda",
  splitSentences("Ye accha hai। Aur ye bhi।").length === 2
);
check("splitSentences single sentence", splitSentences("Bas ek line.").length === 1);

// ---- emotion-tag stripping (never let edge-tts READ "(laughs)" aloud) ------
check(
  "stripEmotionTags removes (laughs)",
  stripEmotionTags("Ye kamaal hai (laughs) dekhiye.") === "Ye kamaal hai dekhiye."
);
check(
  "stripEmotionTags removes [excited] + raw tags",
  stripEmotionTags("[excited] Dekho <break time=\"1s\"/> ye.") === "Dekho ye."
);
check(
  "stripEmotionTags keeps normal parentheses content",
  stripEmotionTags("Ye (asli) product hai.").includes("(asli)")
);

// ---- SSML builder ----------------------------------------------------------
const hookSsml = buildSsmlNarration(
  "Kya aapne ye dekha? Ye product alag hai.",
  VOICE_PRESETS.hook
);
check("hook SSML has break between sentences", hookSsml.includes('<break time="400ms"/>'));
check(
  "hook SSML emphasizes first sentence strong",
  hookSsml.startsWith('<emphasis level="strong">Kya aapne ye dekha?</emphasis>')
);
check("hook SSML has no raw emotion tags", !hookSsml.includes("(laughs)"));

const ctaSsml = buildSsmlNarration(
  "Abhi dekho. Link description me hai.",
  VOICE_PRESETS.cta
);
check(
  "cta SSML emphasizes last sentence moderate",
  ctaSsml.includes('<emphasis level="moderate">Link description me hai.</emphasis>')
);
check(
  "cta SSML break is 400ms",
  ctaSsml.includes('<break time="400ms"/>')
);

const bodySsml = buildSsmlNarration("Pehli baat. Dusri baat.", VOICE_PRESETS.body);
check("body SSML has no emphasis", !bodySsml.includes("<emphasis"));
check("body SSML break is 250ms", bodySsml.includes('<break time="250ms"/>'));

const escaped = buildSsmlNarration(
  "Daam 5 < 10 & quality best hai.",
  VOICE_PRESETS.body
);
check("SSML escapes &", escaped.includes("&amp;"));
check("SSML escapes <", escaped.includes("&lt;"));
check("SSML has no raw < left", !escaped.includes("<"));
check(
  "empty narration -> empty SSML",
  buildSsmlNarration("   ", VOICE_PRESETS.body) === ""
);

// ---- plain narration for fallback providers (zero SSML) --------------------
const plain = plainNarration("Ye kamaal hai (laughs) <break time=\"1s\"/> dekhiye.");
check("plain has no angle brackets", !plain.includes("<") && !plain.includes(">"));
check("plain has no emotion tags", !plain.includes("(laughs)"));
check("plain keeps the words", plain === "Ye kamaal hai dekhiye.");

// ---- preset bounds ("in the middle" — small deviations only) --------------
for (const [role, p] of Object.entries(VOICE_PRESETS) as Array<[VoiceRole, (typeof VOICE_PRESETS)[VoiceRole]]>) {
  const rate = Number(p.rate.replace("%", ""));
  const pitch = Number(p.pitch.replace("Hz", ""));
  const vol = Number(p.volume.replace("%", ""));
  check(`${role} rate within ±15%`, Math.abs(rate) <= 15, p.rate);
  check(`${role} pitch within ±5Hz`, Math.abs(pitch) <= 5, p.pitch);
  check(`${role} volume within ±5%`, Math.abs(vol) <= 5, p.volume);
  check(`${role} break 200-500ms`, p.breakMs >= 200 && p.breakMs <= 500, String(p.breakMs));
  check(`${role} rate format +N%`, /^[+-]\d+%$/.test(p.rate), p.rate);
  check(`${role} pitch format +NHz`, /^[+-]\d+Hz$/.test(p.pitch), p.pitch);
  check(`${role} volume format +N%`, /^[+-]\d+%$/.test(p.volume), p.volume);
  check(`${role} has a voice brief`, p.brief.length > 20);
}

// ---- applyVoicePolish: real ffmpeg -----------------------------------------
async function testPolish() {
  const dir = mkdtempSync(join(tmpdir(), "voice-polish-"));
  try {
    const src = join(dir, "tone.mp3");
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
      "-codec:a", "libmp3lame", "-q:a", "2", src,
    ]);
    const before = await probeMedia(src);
    const ok = await applyVoicePolish(src);
    check("applyVoicePolish returns true", ok);
    const after = await probeMedia(src);
    check(
      "polished file keeps its duration",
      !!after.durationSec && !!before.durationSec &&
        Math.abs(after.durationSec - before.durationSec) / before.durationSec < 0.05,
      `before=${before.durationSec} after=${after.durationSec}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await testPolish();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
