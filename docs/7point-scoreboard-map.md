# 7-Point Plan — Scoreboard Mapping (no duplicate build)

7-point plan ka #4 (Scoreboard + auto-fallback router) ALREADY BUILT hai —
dobara banane ki zaroorat nahi:

| 7-point #4 requirement | Kahan built hai |
|---|---|
| Per product × channel scoreboard | goal-loop.ts GoalStore (JSON ledger, har metric ka MAX = target) |
| Auto-fallback rules (14-day threshold → shift) | sweepGoals: <70% target → diagnose + best-config re-apply prescription |
| Winner par double down | Winner 3x rule → 5 sub-angles queue (flywheel v1) |
| North Star KPIs | ChannelGoal.northStar + pctOfStar/reached |
| Competitor-weakness guard | weaknessAudit() 7 checks har sweep me |

Metric feeding: `POST /api/v1/marketing/goals/record` (abhi manual/channel
workflows se; auto-collection v2).
