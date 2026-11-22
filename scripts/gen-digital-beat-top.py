#!/usr/bin/env python3
"""Generate the digital-beat-the-top n8n workflow (scheduled).

  digital-beat-the-top.json (4 nodes):
    schedule-trigger (Sun 03:30 UTC = 09:00 IST, weekly)
    -> collect (POST /api/v1/marketing/beat/collect — auto-discovers #1
       per field x platform and fetches every benchmark)
    -> analyze (POST /api/v1/marketing/beat/analyze — gap per target +
       actions + #1's metric as goal-loop north star; writes the plan)
    -> report (log lines: beating count, biggest gaps, warnings)

  No manual step anywhere: #1 is auto-discovered (YT/Etsy/Reddit/KDP
  free sources; IG/FB/X/Pinterest public profile pages via
  og:description; social handles from the YT winner's description).
  A walled platform degrades to last-known + a warning — the user is
  never asked to fetch a number by hand.

Run: python3 scripts/gen-digital-beat-top.py
Output: n8n/workflows/digital-beat-the-top.json
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "n8n", "workflows", "digital-beat-the-top.json")

REPORT = """const r = $input.first().json;
const d = r.data ?? r;
const gaps = d.gaps ?? [];
const lines = [`Beat-the-top ${d.generatedAt ?? ''} — ${d.targetsChecked ?? 0} targets, ${d.beating ?? 0} beating`];
for (const g of gaps) {
  lines.push(`[${g.status.toUpperCase()}${g.status === 'unknown' ? '' : ` ${g.gapPct}%`}] ${g.field}/${g.platform} (${g.niche}) ${g.metric}: us ${g.ourValue ?? '?'} vs #1 ${g.theirValue}`);
  lines.push(`    evidence: ${g.evidence}`);
  for (const a of (g.actions ?? [])) lines.push(`    action: ${a}`);
}
lines.push(`Warnings: ${(d.warnings ?? []).join('; ')}`);
return [{ json: { report: lines.join('\\n') } }];"""


def node(name, ntype, version, pos, params):
    return {"parameters": params, "name": name, "type": ntype, "typeVersion": version, "position": pos}


def http_node(name, pos, path, body):
    return node(name, "n8n-nodes-base.httpRequest", 4.2, pos,
                {"method": "POST", "url": "={{ $env.BACKEND_URL }}" + path,
                 "sendBody": True, "specifyBody": "json", "jsonBody": body,
                 "options": {"timeout": 300000}, "sendHeaders": True,
                 "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
                 "onError": "continueRegularOutput"})


def main():
    nodes = [
        node("schedule-trigger", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 300],
             {"rule": {"interval": [{"field": "cronExpression", "expression": "30 3 * * 0"}]}}),
        http_node("collect", [240, 300], "/api/v1/marketing/beat/collect", "={{ {} }}"),
        http_node("analyze", [480, 300], "/api/v1/marketing/beat/analyze",
                  "={{ { benchmarks: $json.data.benchmarks } }}"),
        node("report", "n8n-nodes-base.code", 2, [720, 300],
             {"mode": "runOnceForAllItems", "jsCode": REPORT}),
    ]
    conns = {
        "schedule-trigger": {"main": [[{"node": "collect", "type": "main", "index": 0}]]},
        "collect": {"main": [[{"node": "analyze", "type": "main", "index": 0}]]},
        "analyze": {"main": [[{"node": "report", "type": "main", "index": 0}]]},
    }
    wf = {"name": "digital-beat-the-top", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=1, ensure_ascii=False)
    print(f"WROTE {OUT} ({len(nodes)} nodes)")


if __name__ == "__main__":
    main()
