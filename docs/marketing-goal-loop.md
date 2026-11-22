# Marketing Goal Loop (2026-11-03, v1 = flywheel)

User ka design: har strategy ka maximum result = fixed target; gap aaye to
deep diagnosis; phir best strategy re-apply; iterate → high-level workflow.
Flywheel blueprint (docs/flywheel-plan.md) ka v1 isi me built hai.

## Kaise kaam karta hai

1. **Record:** har marketing run ke metrics `POST /api/v1/marketing/goals/record`
   par bhejo: `{productKey, channel, metrics:{clicks:12,...}, config:{...},
   primaryMetric:"clicks", northStar:{views:10000}}`.
   Har metric ka **MAX = fixed target**. Primary metric beat hone par
   **bestConfig snapshot** (maximum-results strategy) save hota hai.
   `northStar` = prescriptive stretch KPIs (blueprint §1) — fixed rehte hain.
2. **Weekly sweep** (`digital-marketing-goal-loop.json`, Sundays 08:00 IST):
   `POST /api/v1/marketing/goals/sweep`:
   - **Gap check:** latest < 70% of target → underperforming → LLM root-cause
     diagnosis (hypotheses only + fixes + reapplyConfig = best run). Diagnosis
     goal par persist — agla cycle dekhega gap band hua ya nahi.
   - **Winner 3x rule:** latest >= 3x median (min 4 runs) → winner → 5 fresh
     sub-angles (LLM, compliance-scanned) **queue ke top par** + winnerRuns log.
   - **North Star progress:** har star metric par latest vs target (% + reached?).
   - **Weakness-exclusion audit:** 7 checks — channel-diversity, video-presence,
     recency (ledger data se); no-validation, fake-claims, no-hinglish,
     manual-burnout (pipeline guards, transparent report).
   - Diagnosis/sub-angle failures → warnings; sweep kabhi throw nahi karta.
3. **Re-apply:** report me best config + fixes + queued angles aate hain.
   Channel-specific auto re-apply (hook-regen etc.) v2 me.

## Imaandaar caveats

- **Bina metrics ke loop andha hai.** Pinterest/UTM se auto-collection v2 me;
  v1 me metrics record endpoint par bhejne padenge (manual ya channel
  workflows se).
- Diagnosis hypotheses hain, certainty nahi — galat fix par bhi next cycle
  gap check karega (fail cheap, pivot fast).
- Ledger `storage/marketing-goals/ledger.json` (env override:
  `MARKETING_GOALS_LEDGER_PATH`). Corrupt → empty start (fail-safe).
- History cap 20 runs/goal.

## Files

- `src/lib/marketing/goal-loop.ts` (GoalStore, checkGaps, diagnoseGap, sweepGoals)
- `src/app/api/v1/marketing/goals/record/route.ts` (POST)
- `src/app/api/v1/marketing/goals/route.ts` (GET list + gaps)
- `src/app/api/v1/marketing/goals/sweep/route.ts` (POST, x-n8n-secret)
- `n8n/workflows/digital-marketing-goal-loop.json` (3 nodes)
- `scripts/gen-digital-goal-loop.py`, `scripts/test-marketing-goal-loop.ts` (15/15)

## Verification (2026-11-03)

- test-marketing-goal-loop **15/15** (max tracking, gap threshold, diagnosis,
  honesty note, ledger persistence; isolated /tmp ledger).
- Workflow graph + JS syntax ok. tsc/eslint clean.
