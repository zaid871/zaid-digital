/**
 * Motion-graphics overlay tests: pure ASS Dialogue builders for the
 * Brand Saga / "ONE editor" style motion kit (no ffmpeg, no files).
 * Run: npx tsx scripts/test-motion-graphics.ts
 */
import {
  checklistAssEvents,
  CHECKLIST_FONT_SIZE,
  CHECKLIST_MAX_LINES,
  CHECKLIST_STAGGER_SEC,
  hookCardAssEvents,
  HOOK_CARD_SEC,
  MOTION_ACCENT_ASS,
} from "../src/lib/pipeline/motion";
import { escapeAssText } from "../src/lib/pipeline/assets";

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

async function main() {
  // ---- motion hook card ----
  const one = hookCardAssEvents("Protein hai!");
  check("short hook returns one event", one.length === 1);
  check("hook is a Dialogue line", one[0].startsWith("Dialogue: 0,0:00:00.00,0:00:02.50,"));
  check("hook starts oversize at 120", one[0].includes("\\fs120"));
  check("hook settles to 96 in 180ms", one[0].includes("\\t(0,180,\\fs96)"));
  check("hook line 1 uses Anton condensed caps", one[0].includes("\\fnCVE anton-400"));
  check("hook is top-center aligned", one[0].includes("\\an8"));
  check("hook fades in and out", one[0].includes("\\fad(120,250)"));
  check("hook rises in first 400ms then holds", one[0].includes("\\move(540,780,540,740,0,400)"));
  check("hook window is first 2.5s", one[0].includes(",0:00:02.50,") && HOOK_CARD_SEC === 2.5);
  check("single line is white", one[0].includes("\\1c&H00FFFFFF"));

  const two = hookCardAssEvents("AREY, YE TOH PROTEIN HAI!");
  check("long hook returns three events (2 lines + underline sweep)", two.length === 3);
  check("second line uses green accent", two[1].includes(`\\1c${MOTION_ACCENT_ASS}`));
  check("second line uses Fraunces serif", two[1].includes("\\fnCVE fraunces-700"));
  check("second line slams 0.35s after the first", two[1].startsWith("Dialogue: 0,0:00:00.35,0:00:02.50,"));
  check("accent constant is the Brand Saga green", MOTION_ACCENT_ASS === "&H80DE4A&");
  check("second line sits 120px below first", two[1].includes("\\move(540,840,540,800,0,400)"));
  check("underline sweep is a drawn bar", two[2].includes("\\p1") && two[2].includes("m 0 0 l 560 0 l 560 10 l 0 10"));
  check("underline sweep slides in from the left with line 2",
    two[2].startsWith("Dialogue: 0,0:00:00.35,0:00:02.50,") &&
    two[2].includes("\\move(-60,928,540,928,0,300)"));
  check("single-line hook has no sweep", one.length === 1 && !one[0].includes("\\p1"));

  check("empty hook → no events", hookCardAssEvents("").length === 0);
  check("whitespace hook → no events", hookCardAssEvents("   ").length === 0);
  check("price hook → no events", hookCardAssEvents("Sirf Rs 999 me").length === 0);
  check("rupee price hook → no events", hookCardAssEvents("Just ₹10").length === 0);
  const emoji = hookCardAssEvents("Ganja 😀 protein?");
  check("emoji hook still builds", emoji.length === 1);
  check("emoji stripped from event", !emoji[0].includes("😀"));
  const long = hookCardAssEvents(
    "Ye ek bahut lambi hook line hai jo do lines se zyada nahi honi chahiye kabhi bhi"
  );
  check("very long hook caps at two lines + sweep", long.length === 3);

  // ---- feature checklist reveal ----
  const feats = [
    "1 litre capacity",
    "Stainless steel body",
    "Leak-proof cap",
    "Keeps drinks cold",
  ];
  const cl = checklistAssEvents(feats, 40, 52);
  check("checklist returns one event per feature", cl.length === 4);
  check("checklist lines are left-aligned", cl.every((e) => e.includes("\\an7")));
  check("checklist fontsize is 54", cl.every((e) => e.includes(`\\fs${CHECKLIST_FONT_SIZE}`)));
  // Start times are centisecond-rounded by formatAssTime (float quirk:
  // 40.30 can render as 40.29), so compare the stagger numerically.
  const starts = cl.map((e) => {
    const m = e.match(/Dialogue: 0,(\d+):(\d\d):(\d\d)\.(\d\d),/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100 : NaN;
  });
  check("checklist lines start staggered 0.6s apart",
    starts.length === 4 &&
    Math.abs(starts[1] - starts[0] - 0.6) < 0.02 &&
    Math.abs(starts[2] - starts[1] - 0.6) < 0.02 &&
    Math.abs(starts[3] - starts[2] - 0.6) < 0.02);
  check("checklist lines end at scene end", cl.every((e) => e.includes(",0:00:52.00,")));
  check("checklist lines fade in only", cl.every((e) => e.includes("\\fad(200,0)")));
  check("checklist lines rise 30px in 300ms", cl[0].includes("\\move(90,730,90,700,0,300)"));
  check("checklist has green tick + white text",
    cl[0].includes(`{\\1c${MOTION_ACCENT_ASS}}✓{\\1c&H00FFFFFF}`));
  check("checklist stagger constant is 0.6s", CHECKLIST_STAGGER_SEC === 0.6);

  // Caps + guards
  const many = checklistAssEvents([...feats, "Fifth feature", "Sixth feature"], 40, 52);
  check("checklist caps at 4 lines", many.length === CHECKLIST_MAX_LINES && many.length === 4);
  const withPrice = checklistAssEvents(["Good feature", "Only Rs 999", "Another feature"], 40, 52);
  check("price feature line skipped", withPrice.length === 2);
  check("empty features → no events", checklistAssEvents([], 40, 52).length === 0);
  check("inverted window → no events", checklistAssEvents(feats, 52, 40).length === 0);
  const tight = checklistAssEvents(feats, 50, 51);
  check("lines starting after scene end are dropped", tight.length === 2);

  // ---- ASS escaping (regression: comma must NOT gain a backslash) ----
  check("comma stays a plain comma in ASS text", escapeAssText("AREY, YE TOH") === "AREY, YE TOH");
  check("backslash is doubled in ASS text", escapeAssText("a\\b") === "a\\\\b");
  check("braces become parens in ASS text", escapeAssText("a{b}c") === "a(b)c");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL MOTION-GRAPHICS TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST CRASH:", e);
  process.exit(1);
});
