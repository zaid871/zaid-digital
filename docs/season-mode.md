# Season Mode (2026-11-13)

**Rule (user):** season mode banao, lekin sirf season mode nahi — agar us waqt
season product se zyada koi dusra jane k chance hai to wo us ko tarjeeh de.
Season is a BOOST, never a filter or an absolute override.

## The rule, in numbers

- **Generation ranking:** `score = demandScore + 25` when the brief matches an
  ACTIVE season's keywords (`SEASON_BOOST = 25`, in `seasons.ts`).
  - Seasonal 60 → 85, loses to non-seasonal 90. ✅ (override works)
  - Seasonal 70 → 95, beats non-seasonal 90. ✅ (season wins when close)
- **Campaign pace:** a seasonal campaign's effective pace ratio is lowered by
  `SEASON_PACE_PENALTY = 0.2`, so it escalates to more platforms sooner
  (on-track 0.75 → behind 0.55). The REPORTED ratio stays real; only the
  level/label use the effective ratio, and the decision reason names the
  season ("season: Wedding Season — tez push"). Progress and targets are
  untouched.

## Seasons (defaults, yearly windows)

| Season | Windows | Keywords (sample) |
|---|---|---|
| Wedding Season | Nov 1 – Feb 28, Apr 1 – Jun 30 | wedding, shaadi, invite, mehndi, engagement, dulhan... |
| New Year Planners | Nov 1 – Jan 15 | planner, journal, resolution, goal, habit, budget... |
| Back to School | Jun 15 – Aug 31 | study, exam, student, school, padhai, notes... |
| Festive (Diwali) | Oct 1 – Nov 15 | diwali, festive, gift, celebration, rangoli... |
| Ramadan & Eid | 2026-02-18 – 2026-03-21, 2026-05-26 – 2026-05-30 | ramadan, eid, iftar, sehri, roza, zakat... |

Ramadan/Eid dates are approximate (moon sighting) and shift ~11 days earlier
every year — roll them forward each year. Override file wins over defaults:
`storage/digital/seasons.json` (`{ seasons: Season[] }`).

## Where it applies

1. **Auto-generate tick** (`auto-generate.ts`): top-3 brief pick now ranks by
   combined season score. The tick result carries `seasons: string[]`
   (active season ids); every ledger entry carries `score` and, when matched,
   `season`. The supporting rotation follows the top brief, so it follows the
   season too when a seasonal brief wins.
2. **Campaigns** (`campaigns.ts`): `paceFor(campaign, progress, now, seasonBoost)`
   — 4th param defaults to 0 (no behavior change without a season).
   `decideNextAction` computes the boost from `title + niche` itself, so the
   campaigns tick needs no workflow change.
3. **Status endpoint:** `GET /api/v1/digital/seasons/current` (`checkN8nSecret`)
   → `{ at, active: [{id, label}], next: {id, label, startsOn} | null,
   boost: 25, pacePenalty: 0.2 }`. No new n8n workflow.

## What it does NOT do (honest limits)

- No "season mode" switch that pauses non-seasonal work: non-seasonal
  products still generate and still get marketed whenever their demand is
  higher — that IS the user's rule, not a gap.
- `ads-daily` still rotates `DIGITAL_ADS_QUEUE_JSON` by day-of-year % length
  and knows no seasons; seasonal priority there comes through campaigns,
  not the daily rotation.
- Season keywords are substring matches on title + niche — a brief titled
  "Budget planner" matches New Year in Nov–Jan (correct) but a title that
  merely mentions a keyword also matches (acceptable: the boost is only 25).

## Files

- `src/lib/digital/seasons.ts` — seasons, `activeSeasons`, `matchSeason`,
  `scoreWithSeason`, `rankWithSeason`, `pacePenaltyFor`, `loadSeasons`.
- `src/lib/digital/auto-generate.ts` — tick ranks by season score now.
- `src/lib/marketing/campaigns.ts` — `paceFor` 4th param + season note in
  `decideNextAction` reasons.
- `src/app/api/v1/digital/seasons/current/route.ts` — GET status endpoint.
- `src/app/api/v1/digital/auto-generate/tick/route.ts` — tick response now
  includes `seasons`.
- `scripts/test-digital-seasons.ts` — **27/27**.

## Verification

- Seasons 27/27 (windows, match, the override ranking, pace escalation,
  tick integration with stubbed fetch).
- Auto-generate 28/28, campaigns 35/35 (regression — pace changes are
  backward-compatible: default boost 0).
- tsc exit 0, eslint clean (one unused-import warning found + fixed in the
  test), `npm run build` green.
- No workflow changes, no new env vars, no new n8n import. Deploy = backend
  redeploy only. First live effect: Mon 2026-11-16 08:00 IST tick
  (Nov 16 is inside Wedding Season + New Year Planners).
