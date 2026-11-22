#!/usr/bin/env python3
"""Build digital-problem-miner.json — weekly Problem Miner v1 run.

Schedule (Mondays 07:00 IST) -> POST /api/v1/discovery/problem-miner
{niches} -> log top-10 problems. Review the log, pick winners ->
feed into digital-presell-gate.
Niches come from DIGITAL_MINER_NICHES env (comma-separated) or default.
"""
import json
import subprocess
import sys
import tempfile
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
WF = ROOT / "n8n" / "workflows"

V = {
    "n8n-nodes-base.scheduleTrigger": 1.2,
    "n8n-nodes-base.code": 2,
    "n8n-nodes-base.httpRequest": 4.2,
}


def N(name, ntype, params, x, y, notes=""):
    return {"id": name, "name": name, "type": ntype, "typeVersion": V[ntype],
            "position": [x, y], **({"notes": notes} if notes else {}),
            "parameters": params}


BUILD_BODY = """\
// Niches: DIGITAL_MINER_NICHES env (comma-separated) or defaults.
const raw = String($env.DIGITAL_MINER_NICHES ?? 'meal prep,budgeting,freelancing');
const niches = raw.split(',').map(s => s.trim()).filter(s => s.length >= 2).slice(0, 5);
return [{ json: { niches, maxPerNiche: 10 } }];
"""

REPORT = """\
const r = $input.first().json;
const d = r.data ?? r;
const lines = [`Problem miner ${d.scannedAt ?? ''} — niches: ${(d.niches ?? []).join(', ')}`];
for (const p of (d.problems ?? [])) {
  lines.push(`[${p.score}] (${p.source}/${p.trend}) ${p.problem}`);
  lines.push(`    signals: ${(p.signals ?? []).join(', ')} | ${p.evidence?.[0] ?? ''}`);
}
lines.push('Review karo, winners ko digital-presell-gate par bhejo.');
console.log(lines.join('\\n'));
return [{ json: { ok: true, count: (d.problems ?? []).length } }];
"""

nodes = [
    N("schedule-trigger", "n8n-nodes-base.scheduleTrigger",
      {"rule": {"interval": [{"field": "cronExpression", "expression": "30 1 * * 1"}]}},
      0, 300, "Weekly Mondays 07:00 IST (01:30 UTC)."),
    N("build-body", "n8n-nodes-base.code",
      {"mode": "runOnceForAllItems", "jsCode": BUILD_BODY}, 240, 300,
      "Niches from DIGITAL_MINER_NICHES env."),
    N("mine", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "={{ $env.BACKEND_URL }}/api/v1/discovery/problem-miner",
       "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json }}",
       "options": {"timeout": 300000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      480, 300, "5 min timeout (Reddit+suggest+trends)."),
    N("report", "n8n-nodes-base.code",
      {"mode": "runOnceForAllItems", "jsCode": REPORT}, 720, 300,
      "Top-10 problems into the execution log."),
]
connections = {
    "schedule-trigger": {"main": [[{"node": "build-body", "type": "main", "index": 0}]]},
    "build-body": {"main": [[{"node": "mine", "type": "main", "index": 0}]]},
    "mine": {"main": [[{"node": "report", "type": "main", "index": 0}]]},
}

wf = {"name": "digital: problem-miner", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "staticData": None,
      "tags": [{"name": "affiliate-system"}],
      "notes": "Weekly Problem Miner v1: Reddit+suggest+trends → top-10 problems."}
out = WF / "digital-problem-miner.json"
out.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out} ({len(nodes)} nodes)")

w = json.loads(out.read_text())
names = {n["name"] for n in w["nodes"]}
errs = []
for src, outs in w["connections"].items():
    for branch in outs.get("main", []):
        for t in branch:
            if t["node"] not in names:
                errs.append(f"bad target {t['node']}")
for n in w["nodes"]:
    if n["type"] == "n8n-nodes-base.code":
        stub = "const $input={first:()=>({json:{}}),all:()=>[]};const $env={};const $json={};\n"
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(stub + n["parameters"]["jsCode"])
            tmp = f.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        os.unlink(tmp)
        if r.returncode != 0:
            errs.append(f"{n['name']}: {r.stderr[:160]}")
if errs:
    print("FAILED:", errs); sys.exit(1)
print("validation ok: graph + JS syntax")
