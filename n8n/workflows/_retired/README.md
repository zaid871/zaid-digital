# Retired workflows

These workflows were removed from live n8n on 2026-11-16 (workflow-chain
audit: they had no caller — orphans — or were superseded by a backend
route). The files are preserved here so nothing is lost; re-importing
one is the standard delete-then-import flow (see `../README-import.txt`).

| File | Live name | Why retired | Re-import when |
|---|---|---|---|
| `analytics-collection.json` | affiliate-analytics-collection | Superseded by backend `collectAnalytics()` (brain daily route runs it in-lib). | Never (logic lives in `src/lib/publishing/analytics.ts`). |
| `affiliate-link-validation.json` | affiliate-link-validation | Superseded by backend `POST /api/v1/publishing/validate-link` (ads-marketing gate). | Never (logic lives in `src/lib/publishing/validate-link.ts`). |
| `hub-run.json` | hub-run | Thin wrapper around `POST /api/v1/hub/run`; no caller. The API route is the entry. | If an n8n workflow ever needs to call the hub (call the API directly instead). |
| `digital-marketing-strategist.json` | digital: marketing-strategist | Thin wrapper around `POST /api/v1/marketing/strategist/plan`; no caller. The machine called the route directly. | Never (route is the entry). |
| `digital-marketing-machine.json` | digital: marketing-machine | No caller and no automatic brief source (it needs a hand-built marketing brief). Brain + campaigns + ads-daily are the live marketing loop. | When a brief source is designed (e.g. brain v2 per-campaign feed) — re-import together with `digital-presell-gate.json`. |
| `digital-presell-gate.json` | digital: presell-gate | Only caller was the machine. Fires generation webhooks after 10 intents. | Together with the machine (validation ladder). |
| `digital-pmf-survey.json` | digital: pmf-survey | No caller; needs real customers (selling layer parked). | When the selling layer unparks — wire it to the delivery flow. |
| `digital-review-request.json` | digital: review-request | No caller; needs real customers (selling layer parked). | When the selling layer unparks — wire it to the delivery flow. |
| `digital-pod-approve.json` | digital: pod-approve | No caller; human approval gate for Printify drafts (POD not live yet). | When POD goes live — wire it to the dashboard approval button. |
| `main-workflow.json` | product-video-main | No caller; thin wrapper around `POST /api/v1/jobs` + poll. The backend route + BullMQ worker is the live, tested path. | If an n8n-native caller needs video jobs (call the API directly instead). |

Error routing (set 2026-11-16 via DB surgery, NOT via CLI import —
the CLI drops `errorWorkflow`): affiliate workflows →
`affiliate-error-recovery`, digital workflows →
`digital-error-recovery`, both recovery workflows →
`product-video-errors`. The recovery workflows carry an Error Trigger
node, so they run on failure; `product-video-errors` is the terminal
logger. See `../docs/workflow-chain-audit.md`.
