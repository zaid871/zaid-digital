#!/usr/bin/env python3
"""Build digital-marketing-machine.json — the Marketing Machine orchestrator.

POST /webhook/digital-marketing-machine {brief...} →
  validate → strategist plan → pre-sell gate check → 4 channels sequential:
  Pinterest volume → Etsy optimizer → SEO article → report.
Video ads = ads-daily queue (note in report). Scoreboard/auto-fallback =
goal-loop (documented, not duplicated).
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
  productName: String(body.productName), client: body.client ?? undefined,
  kind: body.kind, priceBand: body.priceBand, audience: String(body.audience),
  marketBreadth: body.marketBreadth, goal: body.goal,
  assets: body.assets ?? {}, features: body.features ?? [],
  productLink: body.productLink ?? undefined, imageUrl: body.imageUrl ?? undefined,
  seoKeywords: body.seoKeywords ?? undefined,
  presell: body.presell ?? undefined,
} } }];
"""

PRESELL_BODY = """\
const b = $('validate-input').first().json.brief;
const p = b.presell;
if (p && ['ebook', 'template_pack', 'pod'].includes(p.productType) && p.productName)
  return [{ json: { skip: false, action: 'status', productType: p.productType, productName: p.productName } }];
return [{ json: { skip: true } }];
"""

GATE_EVAL = """\
const r = $input.first().json;
const d = r.data ?? r;
if (r.error || d.error) return [{ json: { gate: 'unknown', note: 'presell check failed — proceeding with warning' } }];
if (typeof d.validated === 'boolean')
  return [{ json: { gate: d.validated ? 'passed' : 'not-passed',
    note: `presell ${d.hits}/${d.threshold} hits${d.validated ? '' : ' — validation pending, channels run anyway (all free)'}` } }];
return [{ json: { gate: 'unknown', note: 'presell response unreadable — proceeding with warning' } }];
"""

BUILD_ACTIONS = """\
const brief = $('validate-input').first().json.brief;
const planR = $('strategist-plan').first().json;
const plan = planR.data ?? planR;
const gate = $('gate-eval').first().json;
const feats = brief.features ?? [];
return [{ json: {
  brief, productKey: plan.productKey ?? brief.productName,
  channelQueue: plan.channelQueue ?? [],
  gate,
  pinterest: {
    runnable: !!(brief.productLink && brief.imageUrl),
    payload: { product: { name: brief.productName, category: brief.kind,
      link: brief.productLink ?? 'https://example.com', imageUrl: brief.imageUrl ?? 'https://example.com/i.jpg',
      features: feats }, count: 5 },
  },
  etsy: { payload: { title: brief.productName, niche: brief.audience, features: feats } },
  seo: { payload: { topic: brief.productName, keywords: brief.seoKeywords ?? [brief.productName],
    audience: brief.audience, productName: brief.productName, productLink: brief.productLink ?? undefined } },
} }];
"""

REPORT = """\
const a = $('build-actions').first().json;
const pin = $('ch-pinterest').first().json; const pinD = pin.data ?? pin;
const etsy = $('ch-etsy').first().json; const etsyD = etsy.data ?? etsy;
const seo = $('ch-seo').first().json; const seoD = seo.data ?? seo;
const lines = [`MARKETING MACHINE: ${a.productKey}`,
  `Gate: ${a.gate.gate} — ${a.gate.note}`,
  `Channel queue: ${(a.channelQueue ?? []).join(' → ')}`,
  `Pinterest: ${pinD.published ?? 0}/${pinD.total ?? 0} pins published`,
  `Etsy: ${etsyD.title ? 'optimized' : 'failed'}${etsyD.bundleSuggestion ? ' | bundle: ' + etsyD.bundleSuggestion : ''}`,
  `SEO article: ${seoD.title ? '"' + seoD.title + '"' : 'failed'} (slug: ${seoD.slug ?? '-'})`,
  `Video ads: ads-daily queue me product add karo (DIGITAL_ADS_QUEUE_JSON)`,
  `Scoreboard: goal-loop weekly sweep (auto-fallback built-in)`];
console.log(lines.join('\\n'));
return [{ json: { ok: true, productKey: a.productKey, report: lines.join('\\n'),
  pinterest: pinD, etsy: etsyD, seo: { title: seoD.title, slug: seoD.slug } } }];
"""

nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-marketing-machine"},
      0, 300, "Machine in: brief → strategist → gate → 4 channels → report."),
    N("validate-input", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": VALIDATE}, 240, 300),
    N("if-valid", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.valid }}", "value2": True}]}},
      480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 400}, "respondWith": "json", "responseBody": "={{ $json }}"}, 720, 460),
    N("strategist-plan", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/marketing/strategist/plan",
       "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json.brief }}",
       "options": {"timeout": 120000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      720, 300),
    N("build-presell-body", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": PRESELL_BODY}, 960, 300,
      "Gate sirf ebook/template/pod presell par lagta hai."),
    N("if-needs-gate", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.skip }}", "value2": True}]}},
      1200, 300),
    N("presell-check", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.N8N_PUBLIC_URL }}/webhook/digital-presell",
       "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json }}",
       "options": {"timeout": 30000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      1440, 300),
    N("gate-eval", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": GATE_EVAL}, 1680, 300),
    N("build-actions", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": BUILD_ACTIONS}, 1920, 300,
      "Per-channel payloads + runnable flags."),
    N("if-pinterest", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.pinterest.runnable }}", "value2": True}]}},
      2160, 300),
    N("ch-pinterest", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/publishing/pinterest-volume",
       "sendBody": True, "specifyBody": "json",
       "jsonBody": "={{ $('build-actions').first().json.pinterest.payload }}",
       "options": {"timeout": 300000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      2400, 300),
    N("ch-etsy", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/marketplace/etsy-optimize",
       "sendBody": True, "specifyBody": "json",
       "jsonBody": "={{ $('build-actions').first().json.etsy.payload }}",
       "options": {"timeout": 120000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      2640, 300),
    N("ch-seo", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/seo/articles",
       "sendBody": True, "specifyBody": "json",
       "jsonBody": "={{ $('build-actions').first().json.seo.payload }}",
       "options": {"timeout": 300000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      2880, 300),
    N("collect-report", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": REPORT}, 3120, 300),
    N("respond-done", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json", "responseBody": "={{ $json }}"}, 3360, 300),
]
connections = {
    "webhook-entry": {"main": [[{"node": "validate-input", "type": "main", "index": 0}]]},
    "validate-input": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "strategist-plan", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "strategist-plan": {"main": [[{"node": "build-presell-body", "type": "main", "index": 0}]]},
    "build-presell-body": {"main": [[{"node": "if-needs-gate", "type": "main", "index": 0}]]},
    "if-needs-gate": {"main": [[{"node": "build-actions", "type": "main", "index": 0}],
                                [{"node": "presell-check", "type": "main", "index": 0}]]},
    "presell-check": {"main": [[{"node": "gate-eval", "type": "main", "index": 0}]]},
    "gate-eval": {"main": [[{"node": "build-actions", "type": "main", "index": 0}]]},
    "build-actions": {"main": [[{"node": "if-pinterest", "type": "main", "index": 0}]]},
    "if-pinterest": {"main": [[{"node": "ch-pinterest", "type": "main", "index": 0}],
                               [{"node": "ch-etsy", "type": "main", "index": 0}]]},
    "ch-pinterest": {"main": [[{"node": "ch-etsy", "type": "main", "index": 0}]]},
    "ch-etsy": {"main": [[{"node": "ch-seo", "type": "main", "index": 0}]]},
    "ch-seo": {"main": [[{"node": "collect-report", "type": "main", "index": 0}]]},
    "collect-report": {"main": [[{"node": "respond-done", "type": "main", "index": 0}]]},
}

wf = {"name": "digital: marketing-machine", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "staticData": None,
      "tags": [{"name": "affiliate-system"}],
      "notes": "Marketing Machine orchestrator: brief → strategist → gate → 4 channels."}
out = WF / "digital-marketing-machine.json"
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
        stub = ("const $input={first:()=>({json:{}}),all:()=>[]};const $env={};const $json={};\n"
                "const $=()=>({first:()=>({json:{}})});\n")
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
