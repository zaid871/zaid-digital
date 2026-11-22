/**
 * Motion-graphics overlays — ASS Dialogue events burned in with the
 * captions (same subtitles pass, no extra ffmpeg step).
 *
 * Style references:
 * - The "ONE editor" promo in "How to edit videos using Claude | AI
 *   Video Editing Masterclass" (analyzed 2026-11-10, see
 *   docs/motion-graphics.md) and The Brand Saga's frame-1 hook cards:
 *   dark premium base, kinetic type with an animated entrance (rise +
 *   fade), an italic-accent feel via bold display type, and staggered
 *   list reveals (cut. / grade. / caption. / sound. / motion.).
 * - Nafay 3D's "Creator Motion Graphics" style (ai-video-editor.zip,
 *   2026-11-10, see docs/ai-video-editor.md): Anton condensed caps for
 *   statements slamming in one at a time, a serif accent on the one
 *   word that matters, rolling counters, flash cuts between ideas.
 *   The hook card below takes its fonts + slam entrance from this style.
 *
 * Two elements, both brand_story-only (gated in buildRenderInputs):
 * 1. Motion hook card — the scene-1 hook question as oversized display
 *    text (96px, line 1 Anton condensed caps in white, line 2 Fraunces
 *    serif in neon-green accent). Each line SLAMS in: starts 25% oversize
 *    and settles to 96px in 180ms (\t) while rising 40px and fading in;
 *    line 2 lands 0.35s after line 1. Visible for the first 2.5s.
 * 2. Feature checklist reveal — up to 4 verified features as "✓ ..."
 *    lines on the last product scene, appearing one by one (0.6s apart)
 *    with a fade + rise, staying till the scene ends.
 *
 * All functions here are pure string builders (no ffmpeg, no I/O), so
 * they are unit-testable. Guards (same as everywhere else): a price or
 * offer mention disables the element; non-Roman characters are stripped
 * (the caption font has no emoji/Devanagari glyphs — they render as
 * boxes). ASS inline overrides used: \an (alignment), \fn (font — the
 * Nafay fonts' real families, see below), \fs (font size), \1c (primary
 * color, BGR), \fad (fade in/out), \move (rise, with an explicit 0–400ms
 * / 0–300ms window so the text holds still after the entrance instead
 * of drifting for the whole event), \t (scale settle).
 */
import { PRICE_PATTERN } from "@/lib/compliance";
import { escapeAssText, formatAssTime } from "./assets";

/** Neon-green accent — The Brand Saga's hook-card accent. */
export const MOTION_ACCENT_ASS = "&H80DE4A&";
export const MOTION_WHITE_ASS = "&H00FFFFFF";
/** Hook card: visible for the first 2.5s, 96px bold display type. */
export const HOOK_CARD_SEC = 2.5;
export const HOOK_CARD_FONT_SIZE = 96;
/**
 * Hook-card fonts — the Nafay 3D pack's REAL family names (the packager
 * renamed them; "Anton"/"Fraunces" do NOT match — libass would silently
 * fall back to DejaVu Sans). See assets/fonts/NAFAY-FONTS.md.
 */
export const HOOK_FONT_LINE1 = "CVE anton-400";
export const HOOK_FONT_LINE2 = "CVE fraunces-700";
/** Slam entrance: line starts 25% oversize, settles in 180ms; line 2 lands 0.35s later. */
export const HOOK_SLAM_FROM_FS = 120;
export const HOOK_SLAM_MS = 180;
export const HOOK_LINE2_DELAY_SEC = 0.35;
/**
 * Underline sweep (AIpreneur paper-strip language): a green accent bar
 * that slides in from the left under the hook's accent line. 560x10px,
 * 300ms slide, lands with line 2.
 */
export const HOOK_SWEEP_W = 560;
export const HOOK_SWEEP_H = 10;
export const HOOK_SWEEP_MS = 300;
/** Checklist: 54px lines, staggered 0.6s apart, max 4 lines. */
export const CHECKLIST_FONT_SIZE = 54;
export const CHECKLIST_MAX_LINES = 4;
export const CHECKLIST_STAGGER_SEC = 0.6;
/**
 * Serif title card (ATTAR attar ad, user-shared 2026-11-11): the end
 * card's brand name in wide-tracked Fraunces serif caps with a short
 * italic tagline under it — the reference's "ATTAR / the essence that
 * stays" treatment. Title 88px gold, tagline 44px italic white, both
 * top-centered, fading in over the last scene. Same font family as
 * the hook card's line 2 (CVE fraunces-700 — the real packager name).
 */
export const SERIF_TITLE_FONT = "CVE fraunces-700";
export const SERIF_TITLE_FONT_SIZE = 88;
export const SERIF_TITLE_TRACKING = 14;
export const SERIF_TITLE_GOLD_ASS = "&H41B3E3&";
export const SERIF_TAGLINE_FONT_SIZE = 44;

/** Strip non-Roman chars, collapse whitespace, cap length. Null when empty. */
function cleanMotionText(text: string, maxChars: number): string | null {
  const clean = text.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
  return clean || null;
}

/** Word-wrap to lines of at most maxChars (same rule as render's wrapLine). */
function wrapToLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Motion hook-card Dialogue events (0 → HOOK_CARD_SEC). Empty array when
 * there is nothing safe to show. Line 1 slams in at t=0, line 2 at
 * HOOK_LINE2_DELAY_SEC; each starts oversize (\fs120) and settles to 96
 * in HOOK_SLAM_MS while rising 40px and fading in.
 */
export function hookCardAssEvents(text: string): string[] {
  // Price check FIRST, on the raw text: ₹ is non-ASCII and would be
  // stripped below, which would hide a price from the scan.
  if (!text || PRICE_PATTERN.test(text)) return [];
  const clean = cleanMotionText(text, 60);
  if (!clean) return [];
  const lines = wrapToLines(clean, 16).slice(0, 2);
  if (lines.length === 0) return [];
  const blockH = lines.length * 120;
  const startY = Math.round((1920 - blockH) / 2 - 160);
  const events = lines.map((line, i) => {
    const color = i === 1 ? MOTION_ACCENT_ASS : MOTION_WHITE_ASS;
    const font = i === 1 ? HOOK_FONT_LINE2 : HOOK_FONT_LINE1;
    const y = startY + i * 120;
    const start = i === 1 ? HOOK_LINE2_DELAY_SEC : 0;
    return (
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(HOOK_CARD_SEC)},Default,,0,0,0,,` +
      `{\\an8\\fn${font}\\fs${HOOK_SLAM_FROM_FS}\\1c${color}\\fad(120,250)` +
      `\\move(540,${y + 40},540,${y},0,400)\\t(0,${HOOK_SLAM_MS},\\fs${HOOK_CARD_FONT_SIZE})}` +
      escapeAssText(line)
    );
  });
  // Underline sweep under the accent line (2-line hooks only): a green
  // bar slides in from the left and lands with line 2, fading out with
  // the card. {\p1} draws the bar; \an8 centers it on x=540.
  if (lines.length === 2) {
    // 248px below the block top: clears the accent line's ink even while
    // it is still rising (its lowest point is ~40px below the settled
    // position); at rest the bar sits just under the line.
    const barY = startY + 248;
    events.push(
      `Dialogue: 0,${formatAssTime(HOOK_LINE2_DELAY_SEC)},${formatAssTime(HOOK_CARD_SEC)},Default,,0,0,0,,` +
        `{\\an8\\1c${MOTION_ACCENT_ASS}\\p1\\move(-60,${barY},540,${barY},0,${HOOK_SWEEP_MS})\\fad(0,250)}` +
        `m 0 0 l ${HOOK_SWEEP_W} 0 l ${HOOK_SWEEP_W} ${HOOK_SWEEP_H} l 0 ${HOOK_SWEEP_H}`
    );
  }
  return events;
}

/**
 * Serif title-card Dialogue events on one scene window (attar_luxury
 * end card). Title: wide-tracked serif caps, gold, top-center; tagline:
 * italic serif, white, 0.4s later, under the title. Price check FIRST
 * on the raw text; a price in the tagline drops the tagline only (the
 * brand title stays — drop-doctrine, never a fallback line). Empty
 * title → no events.
 */
export function serifTitleAssEvents(
  title: string,
  tagline: string | null | undefined,
  sceneStartSec: number,
  sceneEndSec: number
): string[] {
  if (!(sceneEndSec > sceneStartSec)) return [];
  if (!title || PRICE_PATTERN.test(title)) return [];
  const cleanTitle = cleanMotionText(title, 30)?.toUpperCase() ?? null;
  if (!cleanTitle) return [];
  const cleanTag =
    tagline && !PRICE_PATTERN.test(tagline) ? cleanMotionText(tagline, 60) : null;
  const events: string[] = [
    `Dialogue: 0,${formatAssTime(sceneStartSec)},${formatAssTime(sceneEndSec)},Default,,0,0,0,,` +
      `{\\an8\\fn${SERIF_TITLE_FONT}\\fs${SERIF_TITLE_FONT_SIZE}\\fsp${SERIF_TITLE_TRACKING}\\1c${SERIF_TITLE_GOLD_ASS}\\fad(300,300)\\pos(540,420)}` +
      escapeAssText(cleanTitle),
  ];
  if (cleanTag) {
    events.push(
      `Dialogue: 0,${formatAssTime(sceneStartSec + 0.4)},${formatAssTime(sceneEndSec)},Default,,0,0,0,,` +
        `{\\an8\\fn${SERIF_TITLE_FONT}\\i1\\fs${SERIF_TAGLINE_FONT_SIZE}\\1c${MOTION_WHITE_ASS}\\fad(300,300)\\pos(540,540)}` +
        escapeAssText(cleanTag)
    );
  }
  return events;
}
/**
 * Feature checklist Dialogue events on one scene window. Each line fades
 * + rises in 0.6s after the previous one and stays till the scene ends.
 * Lines with a price mention are skipped; at most 4 lines.
 */
export function checklistAssEvents(
  features: string[],
  sceneStartSec: number,
  sceneEndSec: number
): string[] {
  if (!(sceneEndSec > sceneStartSec)) return [];
  const lines = features
    .filter((f) => f && !PRICE_PATTERN.test(f))
    .map((f) => cleanMotionText(f, 60))
    .filter((f): f is string => !!f)
    .slice(0, CHECKLIST_MAX_LINES);
  if (lines.length === 0) return [];
  const out: string[] = [];
  lines.forEach((line, i) => {
    const start = sceneStartSec + 0.3 + i * CHECKLIST_STAGGER_SEC;
    if (start >= sceneEndSec) return;
    const y = 700 + i * 110;
    const text =
      `{\\1c${MOTION_ACCENT_ASS}}✓{\\1c${MOTION_WHITE_ASS}} ${escapeAssText(line)}`;
    out.push(
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(sceneEndSec)},Default,,0,0,0,,` +
        `{\\an7\\fs${CHECKLIST_FONT_SIZE}\\fad(200,0)` +
        `\\move(90,${y + 30},90,${y},0,300)}${text}`
    );
  });
  return out;
}
