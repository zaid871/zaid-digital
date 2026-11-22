#!/usr/bin/env python3
"""Build digital-marketing-strategist.json — agency-grade plan on demand.

Webhook POST /webhook/digital-strategist {productName, client?, kind,
priceBand, audience, marketBreadth, goal, assets?, features?} →
backend strategist → formatted plan in the response.
One workflow serves every product and every client.
"""
import json
import uuid
import subprocess
import sys
import tempfile
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
WF = ROOT / "n8n" / "workflows"

V = {
    "n8n-nodes-base.webhook": 2,
    "n8n-nodes-base.code": 2,
    "n8n-nodes-base.if": 1,
    "n8n-nodes-base.httpRequest": 4.2,
    "n8n-nodes-base.respondToWebhook": 1,
}


def N(name, ntype, params, x, y, notes=""):
    return {"id": name, "name": name, "type": ntype, "typeVersion": V[ntype],
            "position": [x, y], **({"notes": notes} if notes else {}),
            "parameters": params,
        **({"webhookId": str(uuid.uuid5(uuid.NAMESPACE_URL, params.get("path", name)))} if ntype == "n8n-nodes-base.webhook" else {})}


SECRET = """\
const item = $input.first().json;
const headers = item.headers ?? {};
const provided = String(headers['x-n8n-secret'] ?? headers['X-N8N-Secret'] ?? '');
const expected = String($env.N8N_WEBHOOK_SECRET ?? '');
if (!expected) throw new Error('N8N_WEBHOOK_SECRET is not configured in n8n');
if (provided.length !== expected.length) throw new Error('Unauthorized: bad webhook secret');
let diff = 0;
for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
if (diff !== 0) throw new Error('Unauthorized: bad webhook secret');
const body = item.body ?? item;
"""

VALIDATE = SECRET + """\
const kinds = ['digital_product', 'physical', 'affiliate', 'service'];
const bands = ['low', 'mid', 'high'];
const breadths = ['broad', 'niche', 'micro'];
const goals = ['sales', 'leads'];
const errs = [];
if (!body.productName || String(body.productName).length < 2) errs.push('productName zaroori hai');
if (!kinds.includes(body.kind)) errs.push('kind: ' + kinds.join('|'));
if (!bands.includes(body.priceBand)) errs.push('priceBand: ' + bands.join('|'));
if (!breadths.includes(body.marketBreadth)) errs.push('marketBreadth: ' + breadths.join('|'));
if (!goals.includes(body.goal)) errs.push('goal: ' + goals.join('|'));
if (!body.audience || String(body.audience).length < 2) errs.push('audience zaroori hai');
if (errs.length) return [{ json: { valid: false, error: errs.join('; ') } }];
return [{ json: { valid: true, brief: {
  productName: body.productName, client: body.client ?? undefined,
  kind: body.kind, priceBand: body.priceBand, audience: body.audience,
  marketBreadth: body.marketBreadth, goal: body.goal,
  assets: body.assets ?? {}, features: body.features ?? [],
} } }];
"""

FORMAT = """\
const r = $input.first().json;
const d = r.data ?? r;
const lines = [`STRATEGY: ${d.productKey}`, `Channel queue: ${(d.channelQueue ?? []).join(' → ')}`];
for (const s of (d.stages ?? [])) {
  lines.push(`\\n[${s.stage.toUpperCase()}] ${s.title} (${s.timing})`);
  for (const t of (s.tactics ?? []).slice(0, 4)) lines.push(`  • ${t}`);
}
if ((d.angles ?? []).length) { lines.push('\\nAngles:'); for (const a of d.angles) lines.push(`  • ${a}`); }
if ((d.hooks ?? []).length) { lines.push('Hooks:'); for (const h of d.hooks) lines.push(`  • ${h}`); }
for (const w of (d.warnings ?? [])) lines.push(`⚠ ${w}`);
return [{ json: { ok: true, productKey: d.productKey, plan: lines.join('\\n') } }];
"""

nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-strategist"},
      0, 300, "Universal brief in, agency-grade plan out. Client field se multi-client."),
    N("validate-input", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": VALIDATE}, 240, 300),
    N("if-valid", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.valid }}", "value2": True}]}},
      480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 400}, "respondWith": "json", "responseBody": "={{ $json }}"}, 720, 460),
    N("plan", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "={{ $env.BACKEND_URL }}/api/v1/marketing/strategist/plan",
       "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json.brief }}",
       "options": {"timeout": 120000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      720, 300),
    N("format", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": FORMAT}, 960, 300),
    N("respond-done", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json", "responseBody": "={{ $json }}"}, 1200, 300),
]
connections = {
    "webhook-entry": {"main": [[{"node": "validate-input", "type": "main", "index": 0}]]},
    "validate-input": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "plan", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "plan": {"main": [[{"node": "format", "type": "main", "index": 0}]]},
    "format": {"main": [[{"node": "respond-done", "type": "main", "index": 0}]]},
}

wf = {"name": "digital: marketing-strategist", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "staticData": None,
      "tags": [{"name": "affiliate-system"}],
      "notes": "Universal Marketing Strategist — any product, any market, agency-ready."}
out = WF / "digital-marketing-strategist.json"
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
