#!/usr/bin/env python3
"""Build digital-pmf-survey.json — Sean Ellis PMF survey (failure-articles add #2).

POST /webhook/digital-pmf {product, action: answer|status|reset, answer?}
answer: very_disappointed | somewhat_disappointed | not_disappointed
Tally in workflow static data. Verdict: <10 responses -> need_more_data;
>=40% very_disappointed -> pmf_ok; else pmf_risk.
The survey email itself ("1 sawal ka jawab do") plugs in when the email/
selling layer exists — this workflow is the tally + verdict engine.
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
const product = String(body.product ?? '').trim();
if (product.length < 2) return [{ json: { valid: false, error: 'product zaroori hai' } }];
const action = ['answer', 'status', 'reset'].includes(body.action) ? body.action : 'answer';
const answers = ['very_disappointed', 'somewhat_disappointed', 'not_disappointed'];
const answer = answers.includes(body.answer) ? body.answer : null;
if (action === 'answer' && !answer)
  return [{ json: { valid: false, error: 'answer very_disappointed|somewhat_disappointed|not_disappointed me se ho' } }];
const key = product.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
return [{ json: { valid: true, key, product, action, answer } }];
"""

TALLY = """\
// Sean Ellis PMF tally. Static data persists in ACTIVE workflows only;
// n8n restart resets counters (documented limitation).
const store = $getWorkflowStaticData('global');
store.pmf = store.pmf || {};
const j = $input.first().json;
const key = j.key;
if (j.action === 'reset') {
  delete store.pmf[key];
  return [{ json: { product: j.product, action: 'reset', responses: 0, verdict: 'need_more_data' } }];
}
const t = store.pmf[key] || { very: 0, somewhat: 0, not: 0 };
if (j.action === 'answer' && j.answer) {
  if (j.answer === 'very_disappointed') t.very += 1;
  else if (j.answer === 'somewhat_disappointed') t.somewhat += 1;
  else t.not += 1;
}
store.pmf[key] = t;
const responses = t.very + t.somewhat + t.not;
const pct = responses ? Math.round((t.very / responses) * 100) : 0;
let verdict = 'need_more_data';
if (responses >= 10) verdict = pct >= 40 ? 'pmf_ok' : 'pmf_risk';
return [{ json: { product: j.product, action: j.action, responses,
  veryDisappointed: t.very, veryDisappointedPct: pct, verdict } }];
"""

nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-pmf"},
      0, 300, "Sean Ellis survey: {product, action, answer}. Email layer judne par survey link yahi aayega."),
    N("validate-input", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": VALIDATE}, 240, 300),
    N("if-valid", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.valid }}", "value2": True}]}},
      480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 400}, "respondWith": "json", "responseBody": "={{ $json }}"}, 720, 460),
    N("tally", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": TALLY}, 720, 300,
      "Static-data tally. 10+ responses par verdict: >=40% very_disappointed = pmf_ok."),
    N("respond-done", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json", "responseBody": "={{ $json }}"}, 960, 300),
]
connections = {
    "webhook-entry": {"main": [[{"node": "validate-input", "type": "main", "index": 0}]]},
    "validate-input": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "tally", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "tally": {"main": [[{"node": "respond-done", "type": "main", "index": 0}]]},
}

wf = {"name": "digital: pmf-survey", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "staticData": None,
      "tags": [{"name": "affiliate-system"}],
      "notes": "Sean Ellis PMF survey tally (failure-articles add #2)."}
out = WF / "digital-pmf-survey.json"
out.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out} ({len(nodes)} nodes)")

# validate: graph + JS syntax
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
        stub = "const $input={first:()=>({json:{}}),all:()=>[]};const $env={};const $json={};const $getWorkflowStaticData=()=>({});\n"
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
