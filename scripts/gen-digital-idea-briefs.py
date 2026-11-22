#!/usr/bin/env python3
"""Generate the digital-idea-briefs n8n workflow (scheduled).

  digital-idea-briefs.json (4 nodes):
    schedule-trigger (Mon 02:00 UTC = 07:30 IST, 30 min after the miner)
    -> build-body (productTypes + maxBriefs, env-overridable)
    -> briefs (POST /api/v1/digital/briefs, x-n8n-secret)
    -> report (log lines: briefs + trend/gap analysis)

  Briefs are a QUEUE for human pick — this workflow never starts
  generation. The user picks a brief and fires the generation workflow
  (template/ebook/planner/spreadsheets).

Run: python3 scripts/gen-digital-idea-briefs.py
Output: n8n/workflows/digital-idea-briefs.json
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "n8n", "workflows", "digital-idea-briefs.json")

BUILD_BODY = """// Product types: DIGITAL_BRIEF_TYPES env (comma-separated) or defaults.
const raw = String($env.DIGITAL_BRIEF_TYPES ?? 'template,ebook');
const productTypes = raw.split(',').map(s => s.trim()).filter(s => ['template','ebook','planner','spreadsheet'].includes(s));
return [{ json: { productTypes: productTypes.length ? productTypes : ['template','ebook'], maxBriefs: 6, includeYouTube: true, includeEtsy: true } }];"""

REPORT = """const r = $input.first().json;
const d = r.data ?? r;
const lines = [`Idea briefs ${d.minedAt ?? ''} — ${ (d.briefs ?? []).length } briefs`];
for (const b of (d.briefs ?? [])) {
  lines.push(`[${b.demandScore}] (${b.trend}) ${b.productType}: ${b.title}`);
  if (b.kinds) lines.push(`    kinds: ${b.kinds.join('/')} | theme: ${b.theme}`);
  if (b.ebookOutline) lines.push(`    outline: ${b.ebookOutline.join(' | ')}`);
  lines.push(`    gap: ${b.gap}`);
  lines.push(`    uniqueness: ${(b.uniqueness ?? []).join(' | ')}`);
  lines.push(`    evidence: ${(b.demandEvidence ?? []).slice(0, 2).join(' | ')}`);
}
const a = d.analysis ?? {};
lines.push(`Top kinds: ${(a.topKinds ?? []).map(k => `${k.kind} (${k.demand}, ${k.trend})`).join(', ')}`);
lines.push(`Top niches: ${(a.topNiches ?? []).map(n => `${n.niche} (${n.demand}, ${n.trend})`).join(', ')}`);
lines.push(`Rising queries: ${(a.risingQueries ?? []).join(', ')}`);
lines.push(`Warnings: ${(d.warnings ?? []).join('; ')}`);
return [{ json: { report: lines.join('\\n') } }];"""


def node(name, ntype, version, pos, params):
    return {"parameters": params, "name": name, "type": ntype, "typeVersion": version, "position": pos}


def main():
    nodes = [
        node("schedule-trigger", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 300],
             {"rule": {"interval": [{"field": "cronExpression", "expression": "0 2 * * 1"}]}}),
        node("build-body", "n8n-nodes-base.code", 2, [240, 300],
             {"mode": "runOnceForAllItems", "jsCode": BUILD_BODY}),
        node("briefs", "n8n-nodes-base.httpRequest", 4.2, [480, 300],
             {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/digital/briefs",
              "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json }}",
              "options": {"timeout": 300000}, "sendHeaders": True,
              "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
              "onError": "continueRegularOutput"}),
        node("report", "n8n-nodes-base.code", 2, [720, 300],
             {"mode": "runOnceForAllItems", "jsCode": REPORT}),
    ]
    conns = {
        "schedule-trigger": {"main": [[{"node": "build-body", "type": "main", "index": 0}]]},
        "build-body": {"main": [[{"node": "briefs", "type": "main", "index": 0}]]},
        "briefs": {"main": [[{"node": "report", "type": "main", "index": 0}]]},
    }
    wf = {"name": "digital-idea-briefs", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=1, ensure_ascii=False)
    print(f"WROTE {OUT} ({len(nodes)} nodes)")


if __name__ == "__main__":
    main()
