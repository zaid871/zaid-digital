/**
 * Human-sounding voice settings for the shared TTS layer.
 *
 * Source: 4 YouTube videos on making AI voices sound real, analyzed
 * 2026-11-12 (transcripts read in full):
 *  - Badar Munir / Fish Audio — "How to Make Your AI Voice Sound 100% Real":
 *    emotion tags (one mood per sentence, tag at the sentence start),
 *    fix order = change model first, then tags, then regenerate;
 *    3 mistakes = bad training audio, too many emotions in one sentence,
 *    treating the first result as final.
 *  - Abhishek Side / Cartesia + Lexis — "Make Your AI Voice Sound 100%
 *    REAL For Free": EQ brightness/clarity + Normalize.
 *  - Frame of Faizan / Cartesia + Adobe Podcast — "100% Real AI voice":
 *    Speed Normal (deviate only a little), small pauses between phrases,
 *    remove random gaps, Normalize.
 *  - VideXpert / ElevenLabs — "How I Created My Ai Voice (EXPOSED)":
 *    do NOT read the script (emotion, pauses, fast parts per sentence);
 *    Voice Design prompt (natural Indian creator, breathing, pacing,
 *    pauses, emphasis); generate in parts; keep settings "in the middle".
 *
 * What transfers to the free edge-tts stack (and what does not):
 *  - TRANSFERS: one mood per scene (a voice ROLE per scene purpose),
 *    deliberate pauses (SSML <break/>), emphasis on hook/CTA words
 *    (SSML <emphasis/>), small rate/pitch/volume shifts per role,
 *    speakable-script rules (script.ts), EQ clarity + Normalize
 *    (FFmpeg polish + the existing two-pass loudnorm).
 *  - DOES NOT TRANSFER: voice cloning itself (Fish Audio / Cartesia /
 *    ElevenLabs are separate services with their own accounts and
 *    credits; cloning was already a rejected item, 2026-10-23),
 *    HeyGen avatars (rejected), literal emotion tags like (laughs)
 *    (edge-tts would READ them aloud — they are stripped, never sent),
 *    real sounds (coughing/laughing), the unnamed "secret website",
 *    exact EQ numbers (video 2 never speaks them), the unnamed
 *    "keep it in the middle" slider (our equivalent: presets stay
 *    close to defaults).
 *
 * Both workflows (affiliate + digital marketing) run through the same
 * backend job pipeline -> synthesizeScenes() in voice.ts, so these
 * presets apply to BOTH with no per-workflow change.
 *
 * SSML safety: the edge-tts npm package interpolates the text RAW
 * inside <prosody>, so <break/> and <emphasis/> pass through — but
 * any stray `<` or `&` in the narration would break the XML. The
 * builder below escapes everything first, then inserts only the tags
 * it created itself. Fallback providers (hf / pollinations / espeak)
 * do NOT understand SSML, so they always get the PLAIN narration.
 */

export type VoiceRole = "hook" | "body" | "proof" | "cta";

export interface VoicePreset {
  role: VoiceRole;
  /** Edge-tts rate, e.g. "+8%". Kept small — "in the middle". */
  rate: string;
  /** Edge-tts pitch, e.g. "+2Hz". */
  pitch: string;
  /** Edge-tts volume, e.g. "+2%". */
  volume: string;
  /** Deliberate pause inserted between sentences, milliseconds. */
  breakMs: number;
  /** Emphasis level for the role's key sentence, or null for none. */
  emphasis: "strong" | "moderate" | null;
  /** Voice-design brief (ElevenLabs prompt, translated to our stack). */
  brief: string;
}

export const VOICE_PRESETS: Record<VoiceRole, VoicePreset> = {
  hook: {
    role: "hook",
    rate: "+8%",
    pitch: "+2Hz",
    volume: "+2%",
    breakMs: 400,
    emphasis: "strong",
    brief:
      "Young Indian creator, energetic and bright — the first line of a Reel. Fast, excited, grabs attention.",
  },
  body: {
    role: "body",
    rate: "+0%",
    pitch: "+0Hz",
    volume: "+0%",
    breakMs: 250,
    emphasis: null,
    brief:
      "Same creator, calm and conversational — talking to a friend. Natural pace, no rush.",
  },
  proof: {
    role: "proof",
    rate: "-5%",
    pitch: "+0Hz",
    volume: "+0%",
    breakMs: 300,
    emphasis: null,
    brief:
      "Steady and clear — slightly slower so a feature lands properly. Confident, not salesy.",
  },
  cta: {
    role: "cta",
    rate: "-3%",
    pitch: "+0Hz",
    volume: "+2%",
    breakMs: 400,
    emphasis: "moderate",
    brief:
      "Firm and clear — slightly slower, action words stressed. The line the viewer remembers.",
  },
};

/** Scene purposes that map to each role (see storyboard.ts purposesFor). */
const ROLE_BY_PURPOSE: Record<string, VoiceRole> = {
  hook: "hook",
  hero: "hook",
  call_to_action: "cta",
  feature_highlight: "proof",
  comparison: "proof",
  detail_closeup: "proof",
  ingredient: "body",
  craft: "body",
  ritual: "body",
  use_case: "body",
  banner_unroll: "body",
};

/**
 * Voice role for a scene: by purpose first, by position as fallback
 * (first scene = hook, last scene = cta, middle = body).
 */
export function roleForScene(
  purpose: string,
  index: number,
  total: number
): VoiceRole {
  const byPurpose = ROLE_BY_PURPOSE[purpose];
  if (byPurpose) return byPurpose;
  if (index === 0) return "hook";
  if (total > 1 && index === total - 1) return "cta";
  return "body";
}

/** Emotion-tag words the videos teach (Fish Audio / ElevenLabs style). */
const EMOTION_WORDS = [
  "laughs", "laughing", "laugh", "giggles", "giggle", "chuckles", "chuckle",
  "sighs", "sigh", "excited", "excitement", "whispers", "whisper",
  "softly", "tired", "angry", "anger", "sad", "sadness", "happy",
  "happiness", "crying", "cry", "coughs", "cough", "gasps", "gasp",
  "breath", "breathing", "cheers", "applause",
];

const EMOTION_TAG_RE = new RegExp(
  `\\s*[\\(\\[]\\s*(?:${EMOTION_WORDS.join("|")})\\s*[\\)\\]]`,
  "gi"
);

/** Escape text for SSML (edge-tts interpolates text raw into <prosody>). */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Remove emotion-tag artifacts and any raw angle-bracket tags from
 * narration. Edge-tts would READ "(laughs)" aloud and choke on a stray
 * "<break>" the script LLM invented — both must never reach synthesis.
 */
export function stripEmotionTags(text: string): string {
  return text
    .replace(EMOTION_TAG_RE, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE_RE = /[^.!?।]+[.!?।]+|[^.!?।]+$/g;

/** Split narration into sentences, keeping the terminator on each. */
export function splitSentences(text: string): string[] {
  const parts = text.match(SENTENCE_RE) ?? [];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Build SSML narration for edge-tts: escaped sentences joined by
 * deliberate <break/> pauses, with the role's key sentence emphasized
 * (hook = first sentence, strong; cta = last sentence, moderate).
 * One mood per scene — never several emotions in one sentence.
 */
export function buildSsmlNarration(
  narration: string,
  preset: VoicePreset
): string {
  const sentences = splitSentences(stripEmotionTags(narration));
  if (sentences.length === 0) return "";
  const escaped = sentences.map(escapeXml);
  if (preset.emphasis === "strong") {
    escaped[0] = `<emphasis level="strong">${escaped[0]}</emphasis>`;
  } else if (preset.emphasis === "moderate") {
    const last = escaped.length - 1;
    escaped[last] = `<emphasis level="moderate">${escaped[last]}</emphasis>`;
  }
  return escaped.join(`<break time="${preset.breakMs}ms"/>`);
}

/**
 * Plain narration for fallback providers (hf / pollinations / espeak):
 * same cleaning, no SSML of any kind.
 */
export function plainNarration(narration: string): string {
  return stripEmotionTags(narration);
}
