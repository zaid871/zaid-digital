#!/usr/bin/env python3
"""Generate n8n/workflows/affiliate/multi-platform-publish.json.

webhook (product payload) -> backend POST /api/v1/publishing/multi-publish
(analyze-then-promote router) -> log results.

Trigger with: { "product": { "name": "...", "category": "kitchen",
"link": "https://...", "imageUrl": "https://...", "description": "...",
"features": ["..."] }, "platforms": ["pinterest","linkedin","x"] }
Omit "platforms" to let the router pick by fit.
"""
import json
import uuid
from pathlib import Path

OUT = Path(__file__).parent.parent / "n8n" / "workflows" / "affiliate" / "multi-platform-publish.json"

VERSIONS = {
    "n8n-nodes-base.webhook": 2,
    "n8n-nodes-base.httpRequest": 4.2,
    "n8n-nodes-base.code": 2,
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


LOG_JS = """\
// Structured log of the multi-publish run. Drafts (X) are printed in full
// so the operator can copy-paste them into the X app.
const body = $json.body ?? $json;
const data = body.data ?? body;
const results = Array.isArray(data.results) ? data.results : [];
for (const r of results) {
  console.log(JSON.stringify({
    event: 'multi_publish_result',
    platform: r.platform, status: r.status, id: r.id ?? null,
    reason: r.reason ?? null, at: new Date().toISOString(),
  }));
  if (r.status === 'draft' && r.text) console.log(`--- X DRAFT ---\\n${r.text}\\n---------------`);
}
return [{ product: data.product ?? null, results }];
"""

nodes = [
    N("webhook-entry", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "path": "affiliate/multi-publish"},
      0, 300, "Product payload in; omit 'platforms' to auto-route by fit."),
    N("multi-publish", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "={{ $env.BACKEND_URL }}/api/v1/publishing/multi-publish",
       "options": {"timeout": 60000},
       "sendBody": True, "specifyBody": "json",
       "jsonBody": "={{ JSON.stringify($json.body ?? $json) }}",
       "sendHeaders": True,
       "headerParameters": {"parameters": [
           {"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]}},
      260, 300, "Backend analyzes fit, publishes (Pinterest/LinkedIn), drafts X."),
    N("log-results", "n8n-nodes-base.code",
      {"mode": "runOnceForAllItems", "jsCode": LOG_JS},
      520, 300, "Logs per-platform outcomes; prints X drafts for manual posting."),
]

connections = {
    "webhook-entry": {"main": [[{"node": "multi-publish"}]]},
    "multi-publish": {"main": [[{"node": "log-results"}]]},
}

workflow = {
    "name": "affiliate: multi-platform-publish",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1"},
    "staticData": None,
    "tags": [{"name": "affiliate-system"}],
    "notes": (
        "Analyze-then-promote: the backend ranks Pinterest/X/LinkedIn by product "
        "fit, publishes to Pinterest + LinkedIn via their free APIs, and returns "
        "an X draft (X API is pay-per-use since Feb 2026 — manual posting only). "
        "Needs BACKEND_URL, N8N_WEBHOOK_SECRET, and backend env for the platforms "
        "(PINTEREST_ACCESS_TOKEN/BOARD_ID, LINKEDIN_ACCESS_TOKEN/AUTHOR_URN)."
    ),
}

OUT.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT} ({len(nodes)} nodes)")
