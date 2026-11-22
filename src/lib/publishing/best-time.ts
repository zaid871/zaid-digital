/**
 * Best-time publishing (SPEC §15 scheduling) — free, self-implemented.
 *
 * Commercial schedulers (Metricool etc.) charge for "best time" posting.
 * We don't need them: Indian audience peak windows are known and stable,
 * so the rule lives here as plain logic.
 *
 * Peak windows (Asia/Kolkata, system timezone per SPEC §2):
 *  - morning 07:00–09:00 (pre-work scrolling)
 *  - evening 19:00–22:00 (prime time)
 * Fixed publish slots inside the windows spread the 1–2 daily posts
 * instead of dumping them at the window edge:
 *  - 07:30, 08:30, 19:30, 20:30
 *
 * Pure functions over Date — the caller (n8n gate / daily controller)
 * decides what to do with the result. IST has no DST, so wall-clock math
 * via the fixed +05:30 offset is exact.
 */

export const PUBLISH_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MIN = 5 * 60 + 30;

export interface PeakWindow {
  /** Minutes from IST midnight, inclusive. */
  startMin: number;
  /** Minutes from IST midnight, exclusive. */
  endMin: number;
}

export const PEAK_WINDOWS: PeakWindow[] = [
  { startMin: 7 * 60, endMin: 9 * 60 },
  { startMin: 19 * 60, endMin: 22 * 60 },
];

/** Fixed daily publish slots, minutes from IST midnight. */
export const PUBLISH_SLOTS_MIN: number[] = [7 * 60 + 30, 8 * 60 + 30, 19 * 60 + 30, 20 * 60 + 30];

/** IST wall-clock parts for a UTC instant. */
export function istParts(date: Date): {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  minutesOfDay: number;
} {
  const ist = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    minutesOfDay: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

/** UTC instant for an IST wall-clock time (day offset in IST days). */
function istWallToUtc(year: number, month: number, day: number, minutesOfDay: number, dayOffset = 0): Date {
  return new Date(
    Date.UTC(year, month - 1, day + dayOffset, 0, minutesOfDay - IST_OFFSET_MIN)
  );
}

/** True when `date` falls inside an IST peak window. */
export function isPeakTime(date: Date, windows: PeakWindow[] = PEAK_WINDOWS): boolean {
  const { minutesOfDay } = istParts(date);
  return windows.some((w) => minutesOfDay >= w.startMin && minutesOfDay < w.endMin);
}

/**
 * Next publish slot at or after `from`, as a UTC Date.
 * Slots are the fixed daily times; the search rolls to tomorrow's first
 * slot when today's are exhausted.
 */
export function nextPublishSlot(from: Date, slotsMin: number[] = PUBLISH_SLOTS_MIN): Date {
  const p = istParts(from);
  const sorted = [...slotsMin].sort((a, b) => a - b);
  for (const slot of sorted) {
    const candidate = istWallToUtc(p.year, p.month, p.day, slot);
    if (candidate.getTime() >= from.getTime()) return candidate;
  }
  return istWallToUtc(p.year, p.month, p.day, sorted[0], 1);
}

export interface PublishTiming {
  /** True when `now` is inside a peak window (publish immediately). */
  peakNow: boolean;
  /** Next slot to publish at when not in a peak window. */
  nextSlot: Date;
  /** Human-readable IST label for logs/notifications, e.g. "19:30 IST". */
  nextSlotIstLabel: string;
}

/** One-call summary for gates and the daily controller. */
export function publishTiming(now: Date = new Date()): PublishTiming {
  const slot = nextPublishSlot(now);
  const sp = istParts(slot);
  const hh = String(sp.hour).padStart(2, "0");
  const mm = String(sp.minute).padStart(2, "0");
  return {
    peakNow: isPeakTime(now),
    nextSlot: slot,
    nextSlotIstLabel: `${hh}:${mm} IST`,
  };
}
