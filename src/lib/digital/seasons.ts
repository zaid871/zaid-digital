/**
 * Season mode — seasonal products get a boost, but NEVER an absolute
 * override: a non-seasonal product with a better chance (higher demand)
 * still wins.
 *
 * Rule (user, 2026-11-13): season mode banao, lekin sirf season mode
 * nahi — agar us waqt season product se zyada koi dusra jane k chance
 * hai to wo us ko tarjeeh de.
 *
 * How the rule is implemented:
 * - Generation ranking: score = demandScore + SEASON_BOOST (25) when the
 *   item matches an ACTIVE season's keywords. A seasonal 60 becomes 85
 *   and loses to a non-seasonal 90; a seasonal 70 becomes 95 and wins.
 *   The boost is added, never a filter — non-seasonal items stay in
 *   the race and win whenever their demand is higher.
 * - Campaign pace: a seasonal campaign's effective pace ratio is lowered
 *   by SEASON_PACE_PENALTY (0.2), so it escalates to more platforms
 *   sooner (on-track 0.75 -> behind 0.55). Progress and targets are
 *   untouched — only the push gets harder, and only while the season
 *   is active.
 *
 * Seasons are yearly windows (month-day ranges, recurring) except
 * ramadan-eid, whose dates shift ~11 days earlier every year — its
 * windows are explicit dates and must be rolled forward each year
 * (or overridden in storage/digital/seasons.json, which wins over
 * these defaults when present).
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { digitalRoot } from "./package";

export interface SeasonWindow {
  /** "MM-DD" start (inclusive) or full "YYYY-MM-DD" for dated windows. */
  start: string;
  /** "MM-DD" end (inclusive) or full "YYYY-MM-DD" for dated windows. */
  end: string;
}

export interface Season {
  id: string;
  label: string;
  windows: SeasonWindow[];
  keywords: string[];
}

/** Demand boost (0-100 scale) for an item matching an active season. */
export const SEASON_BOOST = 25;
/** Pace-ratio penalty for a seasonal campaign (0.2 = escalates one level sooner). */
export const SEASON_PACE_PENALTY = 0.2;

export const DEFAULT_SEASONS: Season[] = [
  {
    id: "wedding",
    label: "Wedding Season",
    windows: [
      { start: "11-01", end: "02-28" },
      { start: "04-01", end: "06-30" },
    ],
    keywords: ["wedding", "shaadi", "shadi", "invite", "invitation", "mehndi", "haldi", "sangeet", "engagement", "dulhan", "bride", "groom", "baraat"],
  },
  {
    id: "new-year",
    label: "New Year Planners",
    windows: [{ start: "11-01", end: "01-15" }],
    keywords: ["planner", "plan", "journal", "diary", "resolution", "goal", "habit", "budget", "new year"],
  },
  {
    id: "back-to-school",
    label: "Back to School",
    windows: [{ start: "06-15", end: "08-31" }],
    keywords: ["study", "exam", "student", "school", "learn", "padhai", "class", "notes", "revision"],
  },
  {
    id: "festive",
    label: "Festive (Diwali)",
    windows: [{ start: "10-01", end: "11-15" }],
    keywords: ["diwali", "festive", "festival", "gift", "celebration", "rangoli", "dhanteras", "navratri", "dussehra"],
  },
  {
    id: "ramadan-eid",
    label: "Ramadan & Eid",
    // Ramadan 2026 ~18 Feb – 19 Mar; Eid al-Fitr ~20 Mar; Eid al-Adha ~27 May.
    // Dates are approximate (moon sighting) and shift ~11 days earlier each
    // year — roll them forward or override in seasons.json.
    windows: [
      { start: "2026-02-18", end: "2026-03-21" },
      { start: "2026-05-26", end: "2026-05-30" },
    ],
    keywords: ["ramadan", "eid", "iftar", "sehri", "roza", "zakat", "fitr", "adha"],
  },
];

function inWindow(d: Date, w: SeasonWindow): boolean {
  const dated = w.start.length === 10;
  if (dated) {
    const day = d.toISOString().slice(0, 10);
    return day >= w.start && day <= w.end;
  }
  const mmdd = d.toISOString().slice(5, 10);
  if (w.start <= w.end) return mmdd >= w.start && mmdd <= w.end;
  return mmdd >= w.start || mmdd <= w.end; // wraps the year boundary
}

/** Seasons active on a date (UTC). */
export function activeSeasons(date: Date, seasons: Season[] = DEFAULT_SEASONS): Season[] {
  return seasons.filter((s) => s.windows.some((w) => inWindow(date, w)));
}

/** First active season whose keywords match the text (case-insensitive), else null. */
export function matchSeason(text: string, date: Date, seasons: Season[] = DEFAULT_SEASONS): Season | null {
  const lower = text.toLowerCase();
  for (const s of activeSeasons(date, seasons)) {
    if (s.keywords.some((k) => lower.includes(k))) return s;
  }
  return null;
}

/** Combined score: demand + boost when the text matches an active season. */
export function scoreWithSeason(demandScore: number, text: string, date: Date, seasons: Season[] = DEFAULT_SEASONS): { score: number; season: Season | null } {
  const season = matchSeason(text, date, seasons);
  return { score: demandScore + (season ? SEASON_BOOST : 0), season };
}

/**
 * Rank items by combined score (desc); ties break by raw demand (desc).
 * A non-seasonal item with higher demand outranks a seasonal item —
 * the boost is a nudge, never a veto.
 */
export function rankWithSeason<T extends { demandScore: number; text: string }>(
  items: T[],
  date: Date,
  seasons: Season[] = DEFAULT_SEASONS
): Array<T & { seasonScore: number; season: Season | null }> {
  return items
    .map((item) => {
      const { score, season } = scoreWithSeason(item.demandScore, item.text, date, seasons);
      return { ...item, seasonScore: score, season };
    })
    .sort((a, b) => b.seasonScore - a.seasonScore || b.demandScore - a.demandScore);
}

/** Pace penalty for a campaign title on a date (0 when no season matches). */
export function pacePenaltyFor(title: string, date: Date, seasons: Season[] = DEFAULT_SEASONS): number {
  return matchSeason(title, date, seasons) ? SEASON_PACE_PENALTY : 0;
}

/** Optional override file: storage/digital/seasons.json ({ seasons: Season[] }). */
export async function loadSeasons(outRoot?: string): Promise<Season[]> {
  try {
    const raw = await readFile(join(outRoot ?? digitalRoot(), "seasons.json"), "utf-8");
    const parsed = JSON.parse(raw) as { seasons?: Season[] };
    if (Array.isArray(parsed.seasons) && parsed.seasons.length > 0) return parsed.seasons;
    return DEFAULT_SEASONS;
  } catch {
    return DEFAULT_SEASONS;
  }
}
