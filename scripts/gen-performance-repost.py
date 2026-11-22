#!/usr/bin/env python3
"""Generate n8n/workflows/affiliate/performance-repost.json — the repost ("second chance") loop.

schedule -> sweep (backend) -> per variant: poll caption build -> best-time gate
-> create container -> poll processing -> publish -> record. Mirrors the node
patterns of instagram-publishing.json (23 nodes, verified).
"""
import json
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).parent.parent / "n8n/workflows/affiliate/performance-repost.json"

X = 0


def N(name, ntype, params, x, y, notes="", type_version=None):
    versions = {
        "n8n-nodes-base.scheduleTrigger": 1.2,
        "n8n-nodes-base.httpRequest": 4.2,
        "n8n-nodes-base.code": 2,
        "n8n-nodes-base.if": 1,
        "n8n-nodes-base.wait": 1.1,
        "n8n-nodes-base.splitInBatches": 3,
    }
    return {
        "id": name,
        "name": name,
        "type": ntype,
        "typeVersion": type_version or versions[ntype],
        "position": [x, y],
        **({"notes": notes} if notes else {}),
        "parameters": params,
    }


def code(js):
    return {"mode": "runOnceForAllItems", "jsCode": js}


def http_post(url, json_body, timeout=30000, with_secret=True):
    p = {
        "method": "POST",
        "url": url,
        "options": {"timeout": timeout},
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": json_body,
    }
    if with_secret:
        p["sendHeaders"] = True
        p["headerParameters"] = {
            "parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]
        }
    return p


def http_get(url, timeout=15000, with_secret=True):
    p = {"method": "GET", "url": url, "options": {"timeout": timeout}}
    if with_secret:
        p["sendHeaders"] = True
        p["headerParameters"] = {
            "parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]
        }
    return p


def if_node(cond_type, value1, op, value2):
    return {
        "combineOperation": "all",
        "conditions": {cond_type: [{"operation": op, "value1": value1, "value2": value2}]},
    }


nodes = [
    N("schedule-trigger", "n8n-nodes-base.scheduleTrigger",
      {"rule": {"interval": [{"field": "cronExpression", "expression": "0 2 * * *"}]}},
      0, 300, "Daily 07:30 IST. Drives the repost sweep."),
    N("sweep", "n8n-nodes-base.httpRequest",
      http_post("={{ $env.BACKEND_URL }}/api/v1/publishing/sweep", "={{ JSON.stringify({}) }}", timeout=120000),
      240, 300, "Backend: monitor published Reels, analyze, create variant records (max 2/run)."),
    N("if-variants", "n8n-nodes-base.if",
      if_node("number", "={{ $json.data.variants.length }}", "larger", 0),
      480, 300),
    N("no-variants", "n8n-nodes-base.code",
      code("console.log('[repost] no variants this run'); return [{ json: { done: true } }];"),
      720, 120, "Terminal: nothing to repost today."),
    N("run-complete", "n8n-nodes-base.code",
      code("console.log('[repost] run complete'); return [{ json: { done: true } }];"),
      960, 120, "Terminal: all variants handled."),
    N("loop-variants", "n8n-nodes-base.splitInBatches",
      {"batchSize": 1, "options": {}},
      720, 420, "One variant at a time (IG daily limits + serial safety)."),
    N("init-poll", "n8n-nodes-base.code",
      code("const v = $input.first().json;\n"
           "return [{ json: { variantId: v.variantId, pollStart: Date.now(), maxWaitMs: 30 * 60 * 1000 } }];"),
      960, 420),
    N("poll-variant", "n8n-nodes-base.httpRequest",
      http_get("={{ $env.BACKEND_URL }}/api/v1/publishing/variants/{{ $json.variantId }}", timeout=15000),
      1200, 420, "Worker builds the new caption; poll until ready."),
    N("check-ready", "n8n-nodes-base.code",
      code("const res = $input.first().json.data ?? {};\n"
           "const init = $('init-poll').first().json;\n"
           "return [{ json: { variantId: init.variantId, status: res.status ?? 'UNKNOWN',\n"
           "  caption: res.caption ?? null, videoUrl: res.videoUrl ?? null,\n"
           "  elapsedMs: Date.now() - init.pollStart, maxWaitMs: init.maxWaitMs } }];"),
      1440, 420),
    N("if-parked", "n8n-nodes-base.if",
      if_node("string", "={{ $json.status }}", "equals", "needs_review"),
      1680, 420),
    N("park-variant-review", "n8n-nodes-base.code",
      code("console.log('[repost] variant needs review, not auto-publishing:', $input.first().json.variantId);\n"
           "return [{ json: { parked: 'needs_review' } }];"),
      1920, 240, "Caption failed compliance -> human review, never auto-publish."),
    N("if-ready", "n8n-nodes-base.if",
      if_node("string", "={{ $json.status }}", "equals", "ready"),
      1920, 540),
    N("if-timed-out", "n8n-nodes-base.if",
      if_node("number", "={{ $json.elapsedMs }}", "larger", "={{ $json.maxWaitMs }}"),
      2160, 420),
    N("park-variant-timeout", "n8n-nodes-base.code",
      code("console.log('[repost] variant build timed out:', $input.first().json.variantId);\n"
           "return [{ json: { parked: 'timeout' } }];"),
      2400, 240),
    N("wait-60s", "n8n-nodes-base.wait",
      {"amount": 60, "resume": "afterTimeInterval", "unit": "seconds"},
      2400, 540, "60s between caption-build polls."),
    N("best-time-gate", "n8n-nodes-base.code",
      code("// Best-time gate (mirrors src/lib/publishing/best-time.ts): IST peak\n"
           "// windows 07:00-09:00 + 19:00-22:00. Off-peak -> wait until next slot.\n"
           "const item = $input.first().json;\n"
           "const istNow = new Date(Date.now() + (5 * 60 + 30) * 60000);\n"
           "const mins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();\n"
           "const peak = (mins >= 420 && mins < 540) || (mins >= 1140 && mins < 1320);\n"
           "const slots = [450, 510, 1170, 1230];\n"
           "const next = slots.find((s) => s > mins);\n"
           "const dayStartUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());\n"
           "const off = (5 * 60 + 30) * 60000;\n"
           "const slotUtcMs = next === undefined ? dayStartUtc + 86400000 + 450 * 60000 - off : dayStartUtc + next * 60000 - off;\n"
           "return [{ json: { ...item, bestTime: { peakNow: peak, nextSlotIso: new Date(slotUtcMs).toISOString() } } }];"),
      2160, 680),
    N("if-peak", "n8n-nodes-base.if",
      if_node("boolean", "={{ $json.bestTime.peakNow }}", "true", True),
      2400, 680),
    N("wait-until-slot", "n8n-nodes-base.wait",
      {"resume": "specificTime", "dateTime": "={{ $json.bestTime.nextSlotIso }}"},
      2640, 540, "Wait for the next IST peak slot, then publish."),
    N("create-variant-container", "n8n-nodes-base.httpRequest",
      {
          "method": "POST",
          "url": "https://graph.facebook.com/v21.0/{{ $env.IG_USER_ID }}/media",
          "options": {"timeout": 30000},
          "sendBody": True, "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ media_type: 'REELS', video_url: $json.videoUrl, "
                      "caption: ($json.caption ?? '') + '\\n\\nAffiliate disclosure: contains affiliate links.', "
                      "access_token: $env.IG_ACCESS_TOKEN }) }}",
      },
      2640, 800, "Same video, new caption. Never reposts without a new caption."),
    N("if-container-ok", "n8n-nodes-base.if",
      if_node("string", "={{ $json.id }}", "notEmpty", ""),
      2880, 800),
    N("park-container-fail", "n8n-nodes-base.code",
      code("console.log('[repost] container creation failed');\nreturn [{ json: { parked: 'container_failed' } }];"),
      3120, 660),
    N("init-proc-poll", "n8n-nodes-base.code",
      code("const prev = $('check-ready').first().json;\n"
           "return [{ json: { containerId: $input.first().json.id, variantId: prev.variantId, attempts: 0 } }];"),
      3120, 920),
    N("check-processing", "n8n-nodes-base.httpRequest",
      {"method": "GET",
       "url": "https://graph.facebook.com/v21.0/{{ $json.containerId }}?fields=status_code&access_token={{ $env.IG_ACCESS_TOKEN }}",
       "options": {"timeout": 15000}},
      3360, 920),
    N("normalize-proc", "n8n-nodes-base.code",
      code("const res = $input.first().json;\n"
           "const prev = $('init-proc-poll').first().json;\n"
           "return [{ json: { containerId: prev.containerId, variantId: prev.variantId,\n"
           "  attempts: prev.attempts + 1, status: res.status_code ?? 'UNKNOWN' } }];"),
      3600, 920),
    N("is-proc-done", "n8n-nodes-base.if",
      if_node("string", "={{ $json.status }}", "regex", "^(FINISHED|ERROR)$"),
      3840, 920),
    N("if-proc-ok", "n8n-nodes-base.if",
      if_node("string", "={{ $json.status }}", "equals", "FINISHED"),
      4080, 800),
    N("park-proc-fail", "n8n-nodes-base.code",
      code("console.log('[repost] processing failed:', $input.first().json.status);\nreturn [{ json: { parked: 'processing_failed' } }];"),
      4320, 660),
    N("proc-within-limit", "n8n-nodes-base.if",
      if_node("number", "={{ $json.attempts }}", "smallerEqual", 10),
      4080, 1040),
    N("wait-proc", "n8n-nodes-base.wait",
      {"amount": 30, "resume": "afterTimeInterval", "unit": "seconds"},
      4320, 1040, "30s between processing polls."),
    N("publish-variant", "n8n-nodes-base.httpRequest",
      {
          "method": "POST",
          "url": "https://graph.facebook.com/v21.0/{{ $env.IG_USER_ID }}/media_publish",
          "options": {"timeout": 30000},
          "sendBody": True, "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ creation_id: $json.containerId, access_token: $env.IG_ACCESS_TOKEN }) }}",
      },
      4320, 800),
    N("if-published", "n8n-nodes-base.if",
      if_node("string", "={{ $json.id }}", "notEmpty", ""),
      4560, 800),
    N("park-publish-fail", "n8n-nodes-base.code",
      code("console.log('[repost] publish failed');\nreturn [{ json: { parked: 'publish_failed' } }];"),
      4800, 660),
    N("update-variant-record", "n8n-nodes-base.httpRequest",
      http_post("={{ $env.BACKEND_URL }}/api/v1/publishing/records",
                "={{ JSON.stringify({ id: $('check-ready').first().json.variantId, "
                "platformMediaId: $json.id, status: 'published', publishedAt: new Date().toISOString() }) }}",
                timeout=15000),
      4800, 920, "Link the new media ID to the variant record (variantOf stays)."),
]

C = {
    "schedule-trigger": {"main": [[{"node": "sweep"}]]},
    "sweep": {"main": [[{"node": "if-variants"}]]},
    "if-variants": {"main": [[{"node": "loop-variants"}], [{"node": "no-variants"}]]},
    "loop-variants": {"main": [[{"node": "init-poll"}], [{"node": "run-complete"}]]},
    "init-poll": {"main": [[{"node": "poll-variant"}]]},
    "poll-variant": {"main": [[{"node": "check-ready"}]]},
    "check-ready": {"main": [[{"node": "if-parked"}]]},
    "if-parked": {"main": [[{"node": "park-variant-review"}], [{"node": "if-ready"}]]},
    "park-variant-review": {"main": [[{"node": "loop-variants"}]]},
    "if-ready": {"main": [[{"node": "best-time-gate"}], [{"node": "if-timed-out"}]]},
    "if-timed-out": {"main": [[{"node": "park-variant-timeout"}], [{"node": "wait-60s"}]]},
    "park-variant-timeout": {"main": [[{"node": "loop-variants"}]]},
    "wait-60s": {"main": [[{"node": "poll-variant"}]]},
    "best-time-gate": {"main": [[{"node": "if-peak"}]]},
    "if-peak": {"main": [[{"node": "create-variant-container"}], [{"node": "wait-until-slot"}]]},
    "wait-until-slot": {"main": [[{"node": "create-variant-container"}]]},
    "create-variant-container": {"main": [[{"node": "if-container-ok"}]]},
    "if-container-ok": {"main": [[{"node": "init-proc-poll"}], [{"node": "park-container-fail"}]]},
    "park-container-fail": {"main": [[{"node": "loop-variants"}]]},
    "init-proc-poll": {"main": [[{"node": "check-processing"}]]},
    "check-processing": {"main": [[{"node": "normalize-proc"}]]},
    "normalize-proc": {"main": [[{"node": "is-proc-done"}]]},
    "is-proc-done": {"main": [[{"node": "if-proc-ok"}], [{"node": "proc-within-limit"}]]},
    "if-proc-ok": {"main": [[{"node": "publish-variant"}], [{"node": "park-proc-fail"}]]},
    "park-proc-fail": {"main": [[{"node": "loop-variants"}]]},
    "proc-within-limit": {"main": [[{"node": "wait-proc"}], [{"node": "park-proc-fail"}]]},
    "wait-proc": {"main": [[{"node": "check-processing"}]]},
    "publish-variant": {"main": [[{"node": "if-published"}]]},
    "if-published": {"main": [[{"node": "update-variant-record"}], [{"node": "park-publish-fail"}]]},
    "park-publish-fail": {"main": [[{"node": "loop-variants"}]]},
    "update-variant-record": {"main": [[{"node": "loop-variants"}]]},
}

wf = {
    "name": "affiliate-performance-repost",
    "description": "Repost ('second chance') loop: daily sweep of published IG Reels, "
                   "hypothesis-labeled underperformance analysis in the backend, new-caption "
                   "variants built by the worker, auto-republish at best-time slots. "
                   "Limits: 1 variant per original, 48h min age, max 2 variants per run, "
                   "parked (needs_review) variants never auto-publish.",
    "version": "1.0.0",
    "nodes": nodes,
    "connections": C,
    "requiredEnv": ["BACKEND_URL", "N8N_WEBHOOK_SECRET", "IG_USER_ID", "IG_ACCESS_TOKEN"],
    "tags": ["affiliate-system"],
    "errorWorkflow": "affiliate-error-recovery",
}

OUT.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT} ({len(nodes)} nodes)")

# ---- validate: JSON, node refs, JS syntax ----
d = json.loads(OUT.read_text())
names = {n["name"] for n in d["nodes"]}
missing = set()
for src, outs in d["connections"].items():
    assert src in names, f"connection from unknown node {src}"
    for branch in outs["main"]:
        for t in branch:
            if t["node"] not in names:
                missing.add(t["node"])
assert not missing, f"dangling targets: {missing}"
# unique ids/names
assert len(names) == len(d["nodes"]), "duplicate node names"
# JS syntax check of every Code node (via temp files: node --check can't read pipes here)
import tempfile
bad = 0
for n in d["nodes"]:
    if n["type"] == "n8n-nodes-base.code":
        js = n["parameters"]["jsCode"]
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(js)
            tmp = f.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True)
        Path(tmp).unlink(missing_ok=True)
        if r.returncode != 0:
            bad += 1
            print(f"JS SYNTAX ERROR in {n['name']}:", r.stderr.decode()[:300])
assert bad == 0, f"{bad} code nodes have JS syntax errors"
# scheduleTrigger typeVersion sanity
print("connections valid, JS syntax OK, node refs OK")
