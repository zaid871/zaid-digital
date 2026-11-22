#!/usr/bin/env python3
"""Generate digital-marketing-campaigns.json — the smart-campaign ticker.

Runs at every publish slot (07:30 / 08:30 / 19:30 / 20:30 IST =
02:00 / 03:00 / 14:00 / 15:00 UTC): POST /api/v1/marketing/campaigns/tick
runs one decision cycle for every active campaign — post, wait, done or
missed — and reports the decisions. The backend decides; n8n only
triggers and reports.
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "n8n", "workflows", "digital-marketing-campaigns.json")

REPORT_CODE = """// Campaign tick report: one line per campaign — what it decided and why.
const r = $input.first().json;
const results = (r && r.data && r.data.results) || [];
const lines = [];
lines.push(`Campaign tick: ${results.length} active campaign(s)`);
for (const t of results) {
  const d = t.decision || {};
  lines.push(`- ${t.title}: ${d.action}${d.level ? ` (level ${d.level})` : ''} — ${t.note || d.reason || ''}`);
}
return [{ json: { ok: true, report: lines.join('\\n') } }];
"""

wf = {
    "name": "digital-marketing-campaigns",
    "nodes": [
        {
            "parameters": {
                "rule": {"interval": [{"field": "cronExpression", "expression": "0 2,3,14,15 * * *"}]}
            },
            "id": "cmp-schedule",
            "name": "schedule-trigger",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [100, 300],
        },
        {
            "parameters": {
                "method": "POST",
                "url": "={{ $env.BACKEND_URL }}/api/v1/marketing/campaigns/tick",
                "sendHeaders": True,
                "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
                "options": {"timeout": 300000},
                "onError": "continueRegularOutput",
            },
            "id": "cmp-tick",
            "name": "tick",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [320, 300],
        },
        {
            "parameters": {"jsCode": REPORT_CODE, "mode": "runOnceForAllItems"},
            "id": "cmp-report",
            "name": "report",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [560, 300],
        },
    ],
    "connections": {
        "schedule-trigger": {"main": [[{"node": "tick", "type": "main", "index": 0}]]},
        "tick": {"main": [[{"node": "report", "type": "main", "index": 0}]]},
    },
    "active": False,
    "settings": {"executionOrder": "v1"},
    "pinData": {},
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"WROTE {OUT}")
print("nodes:", [(n["name"], n["type"]) for n in wf["nodes"]])
print("connections:", list(wf["connections"].keys()))
