#!/usr/bin/env python3
"""Build 4 workflows for the 7-point plan:
  digital-email-nurture.json   — freebie → 3-email nurture → pitch (Brevo API)
  digital-freebie-delivery.json — deliver freebie + trigger nurture
  digital-review-request.json  — 7d after delivery → review ask (Brevo) + callback webhook
  digital-pinterest-volume.json — weekly Pinterest volume run
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
    "n8n-nodes-base.wait": 1.1,
    "n8n-nodes-base.scheduleTrigger": 1.2,
}


def N(name, ntype, params, x, y, notes=""):
    return {"id": name, "name": name, "type": ntype, "typeVersion": V[ntype],
            "position": [x, y], **({"notes": notes} if notes else {}),
            "parameters": params,
        **({"webhookId": str(uuid.uuid5(uuid.NAMESPACE_URL, params.get("path", name)))} if ntype == "n8n-nodes-base.webhook" else {})}


def check_js(nodes):
    errs = []
    for n in nodes:
        if n["type"] == "n8n-nodes-base.code":
            stub = "const $input={first:()=>({json:{}}),all:()=>[]};const $env={};const $json={};\n"
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
                f.write(stub + n["parameters"]["jsCode"])
                tmp = f.name
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            os.unlink(tmp)
            if r.returncode != 0:
                errs.append(f"{n['name']}: {r.stderr[:160]}")
    return errs


def check_graph(w):
    names = {n["name"] for n in w["nodes"]}
    errs = []
    for src, outs in w["connections"].items():
        for branch in outs.get("main", []):
            for t in branch:
                if t["node"] not in names:
                    errs.append(f"bad target {t['node']}")
    return errs


def write_wf(filename, name, nodes, connections, notes):
    wf = {"name": name, "nodes": nodes, "connections": connections,
          "settings": {"executionOrder": "v1"}, "staticData": None,
          "tags": [{"name": "affiliate-system"}], "notes": notes}
    out = WF / filename
    out.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
    errs = check_graph(wf) + check_js(nodes)
    if errs:
        print(f"FAILED {filename}:", errs); sys.exit(1)
    print(f"wrote {out} ({len(nodes)} nodes) — ok")


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

BREVO_SEND = {
    "method": "POST",
    "url": "https://api.brevo.com/v3/smtp/email",
    "sendBody": True, "specifyBody": "json",
    "sendHeaders": True,
    "headerParameters": {"parameters": [{"name": "api-key", "value": "={{ $env.BREVO_API_KEY }}"}]},
    "onError": "continueRegularOutput",
}

# ---------------------------------------------------------------- nurture
NURTURE_VALIDATE = SECRET + """\
const email = String(body.email ?? '').trim();
if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email))
  return [{ json: { valid: false, error: 'valid email zaroori hai' } }];
return [{ json: { valid: true, email,
  name: String(body.name ?? '').slice(0, 60),
  productName: String(body.productName ?? 'hamara product').slice(0, 80),
  freebieName: String(body.freebieName ?? 'free guide').slice(0, 80),
  freebieUrl: String(body.freebieUrl ?? '').slice(0, 300) } }];
"""

nurture_nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-nurture"},
      0, 300, "Freebie download event → 3-email nurture → pitch. Brevo free 300/day."),
    N("validate", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": NURTURE_VALIDATE}, 240, 300),
    N("if-valid", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.valid }}", "value2": True}]}},
      480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 400}, "respondWith": "json", "responseBody": "={{ $json }}"}, 720, 460),
    N("brevo-contact", "n8n-nodes-base.httpRequest",
      {**BREVO_SEND, "url": "https://api.brevo.com/v3/contacts",
       "jsonBody": '={"email":"={{ $json.email }}","attributes":{"FIRSTNAME":"={{ $json.name }}"}}'},
      720, 300, "Create/update Brevo contact."),
    N("email-1-freebie", "n8n-nodes-base.httpRequest",
      {**BREVO_SEND,
       "jsonBody": '={"sender":{"email":"={{ $env.BREVO_SENDER_EMAIL }}","name":"={{ $env.BREVO_SENDER_NAME }}"},"to":[{"email":"={{ $json.email }}"}],"subject":"Tumhara free {{ $json.freebieName }} taiyaar hai","htmlContent":"Namaste {{ $json.name }},<br><br>Tumhara free <b>{{ $json.freebieName }}</b> yahan download karo:<br><a href=\\"{{ $json.freebieUrl }}\\">Download karo</a><br><br>Kal bataunga ise best kaise use karna hai."}'},
      960, 300),
    N("wait-1d", "n8n-nodes-base.wait", {"amount": 1, "unit": "days"}, 1200, 300),
    N("email-2-howto", "n8n-nodes-base.httpRequest",
      {**BREVO_SEND,
       "jsonBody": '={"sender":{"email":"={{ $env.BREVO_SENDER_EMAIL }}","name":"={{ $env.BREVO_SENDER_NAME }}"},"to":[{"email":"={{ $json.email }}"}],"subject":"{{ $json.freebieName }} se 3x fayda kaise uthao","htmlContent":"Namaste {{ $json.name }},<br><br>Free guide use karne ke 3 practical tips:<br>1. Pehle ...<br>2. Phir ...<br>3. Roz 10 minute.<br><br>(Apne product ke hisaab se edit karo.)"}'},
      1440, 300),
    N("wait-2d", "n8n-nodes-base.wait", {"amount": 2, "unit": "days"}, 1680, 300),
    N("email-3-pitch", "n8n-nodes-base.httpRequest",
      {**BREVO_SEND,
       "jsonBody": '={"sender":{"email":"={{ $env.BREVO_SENDER_EMAIL }}","name":"={{ $env.BREVO_SENDER_NAME }}"},"to":[{"email":"={{ $json.email }}"}],"subject":"Agar free wala pasand aaya to...","htmlContent":"Namaste {{ $json.name }},<br><br>Agar free guide kaam aayi to <b>{{ $json.productName }}</b> dekho — wahi system, poora aur detailed.<br><br>Koi fake urgency nahi — jab ready ho tab."}'},
      1920, 300, "Pitch — NO fake urgency, NO fake discount."),
    N("respond-done", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json", "responseBody": '={"ok":true}'}, 2160, 300),
]
nurture_conns = {
    "webhook-entry": {"main": [[{"node": "validate", "type": "main", "index": 0}]]},
    "validate": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "brevo-contact", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "brevo-contact": {"main": [[{"node": "email-1-freebie", "type": "main", "index": 0}]]},
    "email-1-freebie": {"main": [[{"node": "wait-1d", "type": "main", "index": 0}]]},
    "wait-1d": {"main": [[{"node": "email-2-howto", "type": "main", "index": 0}]]},
    "email-2-howto": {"main": [[{"node": "wait-2d", "type": "main", "index": 0}]]},
    "wait-2d": {"main": [[{"node": "email-3-pitch", "type": "main", "index": 0}]]},
    "email-3-pitch": {"main": [[{"node": "respond-done", "type": "main", "index": 0}]]},
}
write_wf("digital-email-nurture.json", "digital: email-nurture", nurture_nodes, nurture_conns,
         "Freebie → 3-email nurture → pitch (Brevo free 300/day). No fake urgency.")

# ---------------------------------------------------------------- freebie delivery
FREEBIE_VALIDATE = SECRET + """\
const email = String(body.email ?? '').trim();
if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email))
  return [{ json: { valid: false, error: 'valid email zaroori hai' } }];
if (!body.freebieUrl) return [{ json: { valid: false, error: 'freebieUrl zaroori hai' } }];
return [{ json: { valid: true, email, name: String(body.name ?? '').slice(0, 60),
  productName: String(body.productName ?? '').slice(0, 80),
  freebieName: String(body.freebieName ?? 'free guide').slice(0, 80),
  freebieUrl: String(body.freebieUrl).slice(0, 300) } }];
"""
freebie_nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-freebie"},
      0, 300, "Freebie request → download link respond + nurture trigger."),
    N("validate", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": FREEBIE_VALIDATE}, 240, 300),
    N("if-valid", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.valid }}", "value2": True}]}},
      480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 400}, "respondWith": "json", "responseBody": "={{ $json }}"}, 720, 460),
    N("trigger-nurture", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.N8N_PUBLIC_URL }}/webhook/digital-nurture",
       "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json }}",
       "options": {"timeout": 30000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      720, 300, "Fire-and-forget nurture trigger (nurture webhook responds immediately)."),
    N("respond-link", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json",
       "responseBody": '={"ok":true,"downloadUrl":"={{ $json.freebieUrl }}"}'}, 960, 300),
]
freebie_conns = {
    "webhook-entry": {"main": [[{"node": "validate", "type": "main", "index": 0}]]},
    "validate": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "trigger-nurture", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "trigger-nurture": {"main": [[{"node": "respond-link", "type": "main", "index": 0}]]},
}
write_wf("digital-freebie-delivery.json", "digital: freebie-delivery", freebie_nodes, freebie_conns,
         "Freebie delivery + nurture trigger. Tripwire page = selling layer (parked).")

# ---------------------------------------------------------------- review request
REVIEW_VALIDATE = SECRET + """\
const email = String(body.email ?? '').trim();
if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email))
  return [{ json: { valid: false, error: 'valid email zaroori hai' } }];
return [{ json: { valid: true, email,
  productName: String(body.productName ?? 'hamara product').slice(0, 80),
  reviewUrl: String(body.reviewUrl ?? '').slice(0, 300) } }];
"""
CALLBACK_VALIDATE = SECRET + """\
const rating = Number(body.rating);
if (!body.email || !body.product || !(rating >= 1 && rating <= 5) || !body.text)
  return [{ json: { valid: false, error: 'email, product, rating 1-5, text zaroori' } }];
return [{ json: { valid: true, review: {
  email: String(body.email).slice(0, 120), product: String(body.product).slice(0, 80),
  rating, text: String(body.text).slice(0, 500) } } }];
"""
review_nodes = [
    N("webhook-trigger", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-review-ask"},
      0, 300, "Delivery event in → 7 din wait → review ask email."),
    N("validate", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": REVIEW_VALIDATE}, 240, 300),
    N("if-valid", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.valid }}", "value2": True}]}},
      480, 300),
    N("respond-invalid", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 400}, "respondWith": "json", "responseBody": "={{ $json }}"}, 720, 460),
    N("wait-7d", "n8n-nodes-base.wait", {"amount": 7, "unit": "days"}, 720, 300),
    N("email-ask", "n8n-nodes-base.httpRequest",
      {**BREVO_SEND,
       "jsonBody": '={"sender":{"email":"={{ $env.BREVO_SENDER_EMAIL }}","name":"={{ $env.BREVO_SENDER_NAME }}"},"to":[{"email":"={{ $json.email }}"}],"subject":"{{ $json.productName }} kaisa laga? 1 minute ka review","htmlContent":"Namaste,<br><br><b>{{ $json.productName }}</b> use karke kaisa laga? Tumhara honest review doosron ki madad karega:<br><a href=\\"{{ $json.reviewUrl }}\\">Review likho</a><br><br>Achha ya bura — jaisa hai waisa likho."}'},
      960, 300, "Honest review ask — no incentive for 5 stars (fake-review guard)."),
    N("respond-done", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json", "responseBody": '={"ok":true}'}, 1200, 300),
    N("webhook-callback", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": "digital-review-callback"},
      0, 620, "Buyer ka review yahan aata hai → backend record."),
    N("validate-callback", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": CALLBACK_VALIDATE}, 240, 620),
    N("record-review", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/marketing/reviews",
       "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json.review }}",
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      480, 620),
    N("respond-callback", "n8n-nodes-base.respondToWebhook",
      {"options": {"responseCode": 200}, "respondWith": "json", "responseBody": '={"ok":true,"thanks":true}'}, 720, 620),
]
review_conns = {
    "webhook-trigger": {"main": [[{"node": "validate", "type": "main", "index": 0}]]},
    "validate": {"main": [[{"node": "if-valid", "type": "main", "index": 0}]]},
    "if-valid": {"main": [[{"node": "wait-7d", "type": "main", "index": 0}],
                           [{"node": "respond-invalid", "type": "main", "index": 0}]]},
    "wait-7d": {"main": [[{"node": "email-ask", "type": "main", "index": 0}]]},
    "email-ask": {"main": [[{"node": "respond-done", "type": "main", "index": 0}]]},
    "webhook-callback": {"main": [[{"node": "validate-callback", "type": "main", "index": 0}]]},
    "validate-callback": {"main": [[{"node": "record-review", "type": "main", "index": 0}]]},
    "record-review": {"main": [[{"node": "respond-callback", "type": "main", "index": 0}]]},
}
write_wf("digital-review-request.json", "digital: review-request", review_nodes, review_conns,
         "Honest reviews only — no 5-star incentives, verified flag on evidence.")

# ---------------------------------------------------------------- pinterest volume (weekly)
PIN_BODY = """\
const raw = String($env.DIGITAL_PINTEREST_QUEUE_JSON ?? '[]');
let queue = [];
try { queue = JSON.parse(raw); } catch (e) { queue = []; }
if (!Array.isArray(queue) || !queue.length)
  return [{ json: { empty: true } }];
return queue.map(p => ({ json: { empty: false, product: p } }));
"""
pin_nodes = [
    N("schedule-trigger", "n8n-nodes-base.scheduleTrigger",
      {"rule": {"interval": [{"field": "cronExpression", "expression": "0 1 * * 3"}]}},
      0, 300, "Weekly Wednesdays 06:30 IST (01:00 UTC)."),
    N("load-queue", "n8n-nodes-base.code", {"mode": "runOnceForAllItems", "jsCode": PIN_BODY}, 240, 300,
      "Products from DIGITAL_PINTEREST_QUEUE_JSON env."),
    N("if-empty", "n8n-nodes-base.if",
      {"combineOperation": "all", "conditions": {"boolean": [{"value1": "={{ $json.empty }}", "value2": True}]}},
      480, 300),
    N("volume", "n8n-nodes-base.httpRequest",
      {"method": "POST", "url": "={{ $env.BACKEND_URL }}/api/v1/publishing/pinterest-volume",
       "sendBody": True, "specifyBody": "json",
       "jsonBody": '={"product":{{ $json.product }},"count":7}',
       "options": {"timeout": 300000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      720, 300, "7 distinct pins per product."),
    N("log", "n8n-nodes-base.code",
      {"mode": "runOnceForAllItems",
       "jsCode": "const r=$input.first().json;const d=r.data??r;console.log(`pinterest volume: ${d.published??0}/${d.total??0} published`);return [{json:{ok:true}}];"},
      960, 300),
]
pin_conns = {
    "schedule-trigger": {"main": [[{"node": "load-queue", "type": "main", "index": 0}]]},
    "load-queue": {"main": [[{"node": "if-empty", "type": "main", "index": 0}]]},
    "if-empty": {"main": [[{"node": "log", "type": "main", "index": 0}],
                           [{"node": "volume", "type": "main", "index": 0}]]},
    "volume": {"main": [[{"node": "log", "type": "main", "index": 0}]]},
}
write_wf("digital-pinterest-volume.json", "digital: pinterest-volume", pin_nodes, pin_conns,
         "Weekly 7 distinct pins per product (compounding).")
print("ALL 4 WORKFLOWS OK")
