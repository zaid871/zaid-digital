#!/usr/bin/env python3
"""Build the 3 "chance badhane wale lever" workflows + patch POD generation.

1. digital-presell-gate.json (NEW) — lever 1: pre-sell validation gate.
   POST /webhook/digital-presell {productType, productName, topic|niche, action}
   Counts interest hits in workflow static data; when hits >=
   DIGITAL_PRESELL_THRESHOLD (default 10) it auto-fires the matching
   generation webhook once. Landing page (Carrd/Payhip free) posts hits here.
2. digital-pod-approve.json (NEW) — lever 2: design-check approval.
   POST /webhook/digital-pod-approve {slug} -> POST /api/v1/digital/pod/publish.
   Pairs with the patched digital-pod-generation.json (now skipPrintify:true).
3. digital-ads-daily.json (NEW) — lever 3: roz ka ads run.
   Schedule 09:00 IST -> rotates DIGITAL_ADS_QUEUE_JSON -> fires
   /webhook/digital-ads-marketing (fire-and-forget, 30s timeout).
4. PATCH digital-pod-generation.json — validate-input adds skipPrintify:true
   (Printify draft NEVER auto-created); normalize-result adds approval info.

Validates: node graph connections + every Code node's JS via node --check.
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

VERSIONS = {
    "n8n-nodes-base.webhook": 2,
    "n8n-nodes-base.code": 2,
    "n8n-nodes-base.if": 1,
    "n8n-nodes-base.httpRequest": 4.2,
    "n8n-nodes-base.respondToWebhook": 1,
    "n8n-nodes-base.scheduleTrigger": 1.2,
}


def N(name, ntype, params, x, y, notes=""):
    return {
        "id": name,
        "name": name,
        "type": ntype,
        "typeVersion": VERSIONS[ntype],
        "position": [x, y],
        **({"notes": notes} if notes else {}),
        "parameters": params,
        **({"webhookId": str(uuid.uuid5(uuid.NAMESPACE_URL, params.get("path", name)))} if ntype == "n8n-nodes-base.webhook" else {}),
    }


def code(js):
    return {"mode": "runOnceForAllItems", "jsCode": js}


SECRET_CHECK = """\
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


def webhook(path):
    return {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": path}


def respond(code_num):
    return {"options": {"responseCode": code_num}, "respondWith": "json", "responseBody": "={{ $json }}"}


def http_post(url, timeout=60000):
    return {
        "method": "POST",
        "url": url,
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.payload) }}",
        "options": {"timeout": timeout},
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]
        },
        "onError": "continueRegularOutput",
    }


def if_bool(expr):
    return {"combineOperation": "all", "conditions": {"boolean": [{"value1": expr, "value2": True}]}}


# ---------------------------------------------------------------- approve --
APPROVE_VALIDATE = SECRET_CHECK + """\
const slug = String(body.slug ?? '').trim().toLowerCase();
if (!/^[a-z0-9-]{1,120}$/.test(slug)) return [{ json: { valid: false, error: 'slug zaroori hai (a-z, 0-9, hyphen)' } }];
const payload = { slug };
if (body.printify !== undefined) payload.printify = body.printify;
return [{ json: { valid: true, payload } }];
"""

APPROVE_NORMALIZE = """\
const r = $input.first().json;
if (r && r.ok === true && r.data) {
  const d = r.data;
  return [{ json: { ok: true, type: 'pod-publish', slug: d.slug ?? '',
    productId: d.productId ?? '', status: d.status ?? '',
    note: d.note ?? '' } }];
}
return [{ json: { ok: false, type: 'pod-publish',
  error: (r && (r.message ?? r.error)) || 'POD publish failed',
  code: (r && r.code) || 'publish_failed' } }];
"""

approve_nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook", webhook("digital-pod-approve"), 0, 300,
      "Human approval: {slug} of a design generated with skipPrintify."),
    N("validate-input", "n8n-nodes-base.code", code(APPROVE_VALIDATE), 240, 300),
    N("if-valid", "n8n-nodes-base.if", if_bool("={{ $json.valid }}"), 480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook", respond(400), 720, 420),
    N("call-api", "n8n-nodes-base.httpRequest",
      http_post("={{ $env.BACKEND_URL }}/api/v1/digital/pod/publish", 120000), 720, 300,
      "Creates the Printify UNPUBLISHED draft for the approved design."),
    N("normalize-result", "n8n-nodes-base.code", code(APPROVE_NORMALIZE), 960, 300),
    N("check-ok", "n8n-nodes-base.if", if_bool("={{ $json.ok }}"), 1200, 300),
    N("respond-success", "n8n-nodes-base.respondToWebhook", respond(200), 1440, 240),
    N("respond-failed", "n8n-nodes-base.respondToWebhook", respond(502), 1440, 360),
]
approve_connections = {
    "webhook-entry": {"main": [[{"node": "validate-input", "type": "main", "index": 0}]]},
    "validate-input": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "call-api", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "call-api": {"main": [[{"node": "normalize-result", "type": "main", "index": 0}]]},
    "normalize-result": {"main": [[{"node": "check-ok", "type": "main", "index": 0}]]},
    "check-ok": {"main": [[{"node": "respond-success", "type": "main", "index": 0}],
                          [{"node": "respond-failed", "type": "main", "index": 0}]]},
}

# --------------------------------------------------------------- presell --
PRESELL_VALIDATE = SECRET_CHECK + """\
const productType = String(body.productType ?? '').trim();
if (!['ebook', 'template_pack', 'pod'].includes(productType))
  return [{ json: { valid: false, error: 'productType ebook|template_pack|pod me se ho' } }];
const name = String(body.productName ?? body.topic ?? body.niche ?? '').trim();
if (name.length < 2) return [{ json: { valid: false, error: 'productName (ya topic/niche) zaroori hai' } }];
const action = ['hit', 'status', 'reset'].includes(body.action) ? body.action : 'hit';
const key = (productType + ':' + name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const topic = String(body.topic ?? body.niche ?? name);
const paths = { ebook: '/webhook/digital-ebook-generation',
  template_pack: '/webhook/digital-template-generation', pod: '/webhook/digital-pod-generation' };
return [{ json: { valid: true, key, productType, name, action, topic,
  webhookPath: paths[productType],
  triggerPayload: productType === 'ebook' ? { topic } : { niche: topic } } }];
"""

PRESELL_GATE = """\
// Pre-sell counter (lever 1). Hits persist in workflow static data (active
// workflows only). Threshold reached once -> auto-fire generation webhook.
const store = $getWorkflowStaticData('global');
store.counters = store.counters || {};
const j = $input.first().json;
const threshold = parseInt(String($env.DIGITAL_PRESELL_THRESHOLD ?? '10'), 10) || 10;
const key = j.key;
if (j.action === 'reset') {
  delete store.counters[key];
  return [{ json: { key, action: 'reset', hits: 0, threshold, validated: false, shouldTrigger: false } }];
}
const c = store.counters[key] || { hits: 0, triggered: false };
if (j.action === 'status') {
  return [{ json: { key, action: 'status', hits: c.hits, threshold,
    validated: c.hits >= threshold, triggered: !!c.triggered, shouldTrigger: false } }];
}
c.hits += 1;
const validated = c.hits >= threshold;
const shouldTrigger = validated && !c.triggered;
if (shouldTrigger) c.triggered = true;
store.counters[key] = c;
return [{ json: { key, action: 'hit', hits: c.hits, threshold, validated,
  triggered: !!c.triggered, shouldTrigger,
  webhookPath: j.webhookPath, triggerPayload: j.triggerPayload } }];
"""

PRESELL_TRIGGER = {
    "method": "POST",
    "url": "={{ ($env.N8N_PUBLIC_URL || 'http://localhost:5678') + $json.webhookPath }}",
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json.triggerPayload) }}",
    "options": {"timeout": 30000},
    "sendHeaders": True,
    "headerParameters": {
        "parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]
    },
    "onError": "continueRegularOutput",
}

presell_nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook", webhook("digital-presell"), 0, 300,
      "Pre-sell hits from your landing page. {productType, productName|topic|niche, action: hit|status|reset}"),
    N("validate-input", "n8n-nodes-base.code", code(PRESELL_VALIDATE), 240, 300),
    N("if-valid", "n8n-nodes-base.if", if_bool("={{ $json.valid }}"), 480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook", respond(400), 720, 460),
    N("gate-counter", "n8n-nodes-base.code", code(PRESELL_GATE), 720, 300,
      "Counts hits; threshold hit -> auto-fires the generation webhook once."),
    N("if-trigger", "n8n-nodes-base.if", if_bool("={{ $json.shouldTrigger }}"), 960, 300),
    N("trigger-generation", "n8n-nodes-base.httpRequest", PRESELL_TRIGGER, 1200, 240,
      "Fires the generation webhook (fire-and-forget)."),
    N("respond-done", "n8n-nodes-base.respondToWebhook", respond(200), 1440, 300),
]
presell_connections = {
    "webhook-entry": {"main": [[{"node": "validate-input", "type": "main", "index": 0}]]},
    "validate-input": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "gate-counter", "type": "main", "index": 0}],
                          [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "gate-counter": {"main": [[{"node": "if-trigger", "type": "main", "index": 0}]]},
    "if-trigger": {"main": [[{"node": "trigger-generation", "type": "main", "index": 0}],
                            [{"node": "respond-done", "type": "main", "index": 0}]]},
    "trigger-generation": {"main": [[{"node": "respond-done", "type": "main", "index": 0}]]},
}

# -------------------------------------------------------------- ads-daily --
ADS_PICK = """\
// Lever 3: roz ka ads run. DIGITAL_ADS_QUEUE_JSON se aaj ka product rotate
// karke uthao (day-of-year % queue length). publish flag env se.
const raw = $env.DIGITAL_ADS_QUEUE_JSON || '[]';
let queue = [];
try { queue = JSON.parse(raw); } catch (e) { queue = []; }
if (!Array.isArray(queue) || !queue.length) {
  return [{ json: { ok: false,
    reason: 'DIGITAL_ADS_QUEUE_JSON khaali hai — products ki list env me set karo.' } }];
}
const dayIdx = Math.floor(Date.now() / 86400000);
const item = queue[dayIdx % queue.length] || {};
const publish = String($env.DIGITAL_ADS_AUTO_PUBLISH || 'false').toLowerCase() === 'true';
const payload = { productType: item.productType, productName: item.productName,
  productLink: item.productLink, publish };
if (item.topic) payload.topic = item.topic;
if (item.niche) payload.niche = item.niche;
if (!payload.productType || !payload.productName || !payload.productLink) {
  return [{ json: { ok: false, reason: 'Queue item me productType/productName/productLink zaroori hai.' } }];
}
return [{ json: { ok: true, payload, queueSize: queue.length, dayIndex: dayIdx % queue.length } }];
"""

ADS_LOG = """\
const j = $input.first().json;
console.log(JSON.stringify({ event: 'digital_ads_daily', ok: j.ok,
  product: j.payload?.productName ?? null, reason: j.reason ?? null,
  at: new Date().toISOString() }));
return [{ json: j }];
"""

ads_nodes = [
    N("schedule-trigger", "n8n-nodes-base.scheduleTrigger",
      {"rule": {"interval": [{"field": "cronExpression", "expression": "30 3 * * *"}]}},
      0, 300, "Roz 09:00 IST (03:30 UTC)."),
    N("pick-today", "n8n-nodes-base.code", code(ADS_PICK), 240, 300,
      "DIGITAL_ADS_QUEUE_JSON me se aaj ka product rotate karke uthao."),
    N("if-ready", "n8n-nodes-base.if", if_bool("={{ $json.ok }}"), 480, 300),
    N("fire-ads", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "={{ ($env.N8N_PUBLIC_URL || 'http://localhost:5678') }}/webhook/digital-ads-marketing",
       "sendBody": True, "specifyBody": "json",
       "jsonBody": "={{ JSON.stringify($json.payload) }}",
       "options": {"timeout": 30000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      720, 240, "Fire-and-forget: ads workflow ~40 min chalti hai, jawab ka wait nahi."),
    N("log-done", "n8n-nodes-base.code", code(ADS_LOG), 960, 300),
]
ads_connections = {
    "schedule-trigger": {"main": [[{"node": "pick-today", "type": "main", "index": 0}]]},
    "pick-today": {"main": [[{"node": "if-ready", "type": "main", "index": 0}]]},
    "if-ready": {"main": [[{"node": "fire-ads", "type": "main", "index": 0}],
                          [{"node": "log-done", "type": "main", "index": 0}]]},
    "fire-ads": {"main": [[{"node": "log-done", "type": "main", "index": 0}]]},
}


def write_workflow(fname, nodes, connections, name, notes):
    wf = {
        "name": name,
        "nodes": nodes,
        "connections": connections,
        "settings": {"executionOrder": "v1"},
        "staticData": None,
        "tags": [{"name": "affiliate-system"}],
        "notes": notes,
    }
    out = WF / fname
    out.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({len(nodes)} nodes)")


def patch_pod_generation():
    """Design-check lever: pod-generation never auto-creates the Printify draft."""
    p = WF / "digital-pod-generation.json"
    w = json.loads(p.read_text())
    changed = 0
    for n in w["nodes"]:
        if n["name"] == "validate-input":
            js = n["parameters"]["jsCode"]
            if "skipPrintify" not in js:
                js = js.replace(
                    "if (body.printify !== undefined) payload.printify = body.printify;",
                    "if (body.printify !== undefined) payload.printify = body.printify;\n"
                    "// Design-check lever: Printify draft yahan KABHI auto-create nahi hoga.\n"
                    "// Human design-print.png check karke /webhook/digital-pod-approve par approve karega.\n"
                    "payload.skipPrintify = true;",
                )
                n["parameters"]["jsCode"] = js
                changed += 1
        if n["name"] == "normalize-result":
            js = n["parameters"]["jsCode"]
            if "approveWebhook" not in js:
                js = js.replace(
                    "printify: d.printify ?? null } }];",
                    "printify: d.printify ?? null,\n    approvalRequired: true,\n"
                    "    approveWebhook: '/webhook/digital-pod-approve',\n"
                    "    approveWith: { slug: d.slug ?? '' } } }];",
                )
                n["parameters"]["jsCode"] = js
                changed += 1
    p.write_text(json.dumps(w, indent=2, ensure_ascii=False) + "\n")
    print(f"patched {p} ({changed} nodes changed)")


def validate():
    """Node-graph + JS syntax validation for the touched workflows."""
    errs = []
    for fname in ["digital-pod-generation.json", "digital-pod-approve.json",
                  "digital-presell-gate.json", "digital-ads-daily.json"]:
        w = json.loads((WF / fname).read_text())
        names = {n["name"] for n in w["nodes"]}
        for src, outs in w["connections"].items():
            if src not in names:
                errs.append(f"{fname}: connection from unknown node {src}")
            for branch in outs.get("main", []):
                for t in branch:
                    if t["node"] not in names:
                        errs.append(f"{fname}: bad target {t['node']}")
        for n in w["nodes"]:
            if n["type"] == "n8n-nodes-base.code":
                js = n["parameters"]["jsCode"]
                # stub n8n globals so node --check only parses syntax
                stub = "const $input={first:()=>({json:{}}),all:()=>[]};const $env={};const $json={};const $getWorkflowStaticData=()=>({});\n"
                with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
                    f.write(stub + js)
                    tmp = f.name
                r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
                os.unlink(tmp)
                if r.returncode != 0:
                    errs.append(f"{fname}/{n['name']}: JS syntax: {r.stderr[:160]}")
    if errs:
        print("VALIDATION FAILED:")
        for e in errs:
            print(" -", e)
        sys.exit(1)
    print("validation ok: 4 workflows (graph + JS syntax)")


if __name__ == "__main__":
    patch_pod_generation()
    write_workflow(
        "digital-pod-approve.json", approve_nodes, approve_connections,
        "digital: pod-approve",
        "Lever 2 (design-check): human ne design-print.png check kar liya -> "
        "{slug} bhejo -> Printify UNPUBLISHED draft banta hai. Pairs with "
        "digital-pod-generation (skipPrintify:true).",
    )
    write_workflow(
        "digital-presell-gate.json", presell_nodes, presell_connections,
        "digital: presell-gate",
        "Lever 1 (pre-sell validation): landing page se hits aate hain; "
        "DIGITAL_PRESELL_THRESHOLD (default 10) cross hote hi generation "
        "webhook auto-fire hota hai (ek baar). Pehle bikna, phir automation.",
    )
    write_workflow(
        "digital-ads-daily.json", ads_nodes, ads_connections,
        "digital: ads-daily",
        "Lever 3 (roz ka ads run): roz 09:00 IST par DIGITAL_ADS_QUEUE_JSON "
        "me se product rotate karke digital-ads-marketing fire karta hai. "
        "DIGITAL_ADS_AUTO_PUBLISH=true par hi auto-post hoga.",
    )
    validate()
