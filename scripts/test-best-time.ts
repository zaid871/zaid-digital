/**
 * Best-time publishing tests — pure IST wall-clock math, no network.
 * Run: npx tsx scripts/test-best-time.ts
 */
import {
  isPeakTime,
  istParts,
  nextPublishSlot,
  publishTiming,
} from "../src/lib/publishing/best-time";

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

/** Build a UTC Date for an IST wall-clock time. */
function ist(y: number, mo: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, hh - 5, mm - 30));
}

// istParts round-trip
{
  const p = istParts(ist(2026, 10, 20, 19, 30));
  check("istParts reads IST wall clock", p.hour === 19 && p.minute === 30 && p.day === 20);
}

// Peak windows: 07:00–09:00 and 19:00–22:00 IST
check("08:00 IST is peak", isPeakTime(ist(2026, 10, 20, 8, 0)));
check("07:00 IST is peak (window start)", isPeakTime(ist(2026, 10, 20, 7, 0)));
check("09:00 IST is NOT peak (window end exclusive)", !isPeakTime(ist(2026, 10, 20, 9, 0)));
check("20:45 IST is peak", isPeakTime(ist(2026, 10, 20, 20, 45)));
check("22:00 IST is NOT peak", !isPeakTime(ist(2026, 10, 20, 22, 0)));
check("13:00 IST is NOT peak", !isPeakTime(ist(2026, 10, 20, 13, 0)));
check("03:00 IST is NOT peak", !isPeakTime(ist(2026, 10, 20, 3, 0)));

// Next slot: fixed slots 07:30, 08:30, 19:30, 20:30 IST
{
  const s = nextPublishSlot(ist(2026, 10, 20, 6, 0));
  const p = istParts(s);
  check("06:00 → next slot 07:30 same day", p.day === 20 && p.hour === 7 && p.minute === 30, JSON.stringify(p));
}
{
  const s = nextPublishSlot(ist(2026, 10, 20, 7, 30));
  const p = istParts(s);
  check("exactly 07:30 → slot is 07:30 itself", p.hour === 7 && p.minute === 30);
}
{
  const s = nextPublishSlot(ist(2026, 10, 20, 7, 45));
  const p = istParts(s);
  check("07:45 → next slot 08:30", p.hour === 8 && p.minute === 30);
}
{
  const s = nextPublishSlot(ist(2026, 10, 20, 12, 0));
  const p = istParts(s);
  check("12:00 → next slot 19:30", p.hour === 19 && p.minute === 30);
}
{
  const s = nextPublishSlot(ist(2026, 10, 20, 21, 0));
  const p = istParts(s);
  check("21:00 → next slot tomorrow 07:30", p.day === 21 && p.hour === 7 && p.minute === 30, JSON.stringify(p));
}
{
  const s = nextPublishSlot(ist(2026, 10, 31, 23, 30));
  const p = istParts(s);
  check("month rollover: Oct 31 23:30 → Nov 1 07:30", p.month === 11 && p.day === 1 && p.hour === 7, JSON.stringify(p));
}

// publishTiming summary
{
  const t = publishTiming(ist(2026, 10, 20, 20, 0));
  check("publishTiming peakNow true at 20:00", t.peakNow === true);
  check("publishTiming label format", /^\d{2}:\d{2} IST$/.test(t.nextSlotIstLabel), t.nextSlotIstLabel);
}
{
  const t = publishTiming(ist(2026, 10, 20, 14, 0));
  check("publishTiming peakNow false at 14:00, next 19:30 IST", t.peakNow === false && t.nextSlotIstLabel === "19:30 IST", t.nextSlotIstLabel);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL BEST-TIME TESTS PASSED");
