#!/usr/bin/env python3
"""Build digital-marketing-goal-loop.json — weekly goal-loop sweep.

Schedule (Sundays 08:00 IST) -> POST /api/v1/marketing/goals/sweep ->
GET /api/v1/marketing/reports/weekly -> post the weekly report when
REPORT_WEBHOOK_URL is set -> format the report -> log. The backend does
gap-check + LLM diagnosis; underperformers get hypotheses + best-config
to re-apply. The weekly report (real data: publish records + live
insights + goal gaps + brain calibration) is the affiliate weekly
reporting technique, now shared by both sides through one endpoint.
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
    "n8n-nodes-base.httpRequest": 4.2,
    "n8n-nodes-base.code": 2,
    "n8n-nodes-base.if": 1,
}


def N(name, ntype, params, x, y, notes=""):
    return {"id": name, "name": name, "type": ntype, "typeVersion": V[ntype],
            "position": [x, y], **({"notes": notes} if notes else {}),
            "parameters": params}


REPORT = """\
const safe = (name) => { try { return $(name).first().json; } catch { return null; } };
const sweepRaw = safe('sweep');
const d = (sweepRaw && sweepRaw.data) ? sweepRaw.data : (sweepRaw ?? {});
const weeklyRaw = safe('weekly-report');
const w = (weeklyRaw && weeklyRaw.data) ? weeklyRaw.data : (weeklyRaw ?? {});
const posted = safe('post-report');
const lines = [];
lines.push(`Goal-loop sweep ${d.checkedAt ?? ''}: ${d.goalsChecked ?? 0} goals checked, ${(d.underperforming ?? []).length} underperforming.`);
for (const u of (d.underperforming ?? [])) {
  lines.push(`UNDER: ${u.productKey}/${u.channel} ${u.primaryMetric} latest=${u.latest} target=${u.target} gap=${u.gapPct}%`);
  for (const h of (u.diagnosis?.hypotheses ?? []))
    lines.push(`  hypothesis [${h.confidence}]: ${h.cause} | evidence: ${h.evidence}`);
  for (const f of (u.diagnosis?.suggestedFixes ?? []))
    lines.push(`  fix: ${f}`);
  lines.push(`  re-apply best config: ${JSON.stringify(u.diagnosis?.reapplyConfig ?? {})}`);
}
for (const w of (d.warnings ?? [])) lines.push(`warning: ${w}`);
lines.push('--- winners (3x rule) ---');
for (const wn of (d.winners ?? [])) {
  lines.push(`WINNER: ${wn.productKey}/${wn.channel} ${wn.primaryMetric}=${wn.value} (${wn.multiple}x median)`);
  for (const a of (wn.subAngles ?? [])) lines.push(`  queued angle: ${a}`);
}
lines.push('--- north star ---');
for (const n of (d.northStar ?? []))
  lines.push(`STAR: ${n.productKey}/${n.channel} ${n.metric} ${n.latest}/${n.northStar} (${n.pctOfStar}%)${n.reached ? ' REACHED' : ''}`);
lines.push('--- weakness audit ---');
for (const c of (d.weaknessAudit ?? []))
  lines.push(`AUDIT [${c.status.toUpperCase()}] ${c.name}: ${c.evidence}`);
lines.push('--- weekly report ---');
lines.push(`Week ${w.week ?? ''}: ${w.totals?.posts ?? 0} posts, ${w.totals?.views ?? 0} views, ${w.totals?.likes ?? 0} likes, ${w.totals?.comments ?? 0} comments.`);
for (const t of (w.topPosts ?? []))
  lines.push(`TOP: ${t.platform} ${t.productKey} views=${t.views} likes=${t.likes} comments=${t.comments}`);
for (const n of (w.notes ?? [])) lines.push(`note: ${n}`);
if (w.calibration)
  lines.push(`Brain calibration: ${w.calibration.wins}/${w.calibration.days} days correct${w.calibration.accuracy != null ? ` (${Math.round(w.calibration.accuracy * 100)}%)` : ' (cold start)'}.`);
lines.push(`Report posted: ${posted ? 'yes (REPORT_WEBHOOK_URL)' : 'no (REPORT_WEBHOOK_URL not set)'}.`);
console.log(lines.join('\\n'));
return [{ json: { ok: true, report: lines.join('\\n') } }];
"""

nodes = [
    N("schedule-trigger", "n8n-nodes-base.scheduleTrigger",
      {"rule": {"interval": [{"field": "cronExpression", "expression": "30 2 * * 0"}]}},
      0, 300, "Weekly Sundays 08:00 IST (02:30 UTC)."),
    N("sweep", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "={{ $env.BACKEND_URL }}/api/v1/marketing/goals/sweep",
       "sendBody": True, "specifyBody": "json", "jsonBody": "{}",
       "options": {"timeout": 600000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      240, 300, "Gap-check + diagnose. 10 min timeout (LLM calls)."),
    N("weekly-report", "n8n-nodes-base.httpRequest",
      {"method": "GET",
       "url": "={{ $env.BACKEND_URL }}/api/v1/marketing/reports/weekly",
       "options": {"timeout": 120000},
       "sendHeaders": True,
       "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]},
       "onError": "continueRegularOutput"},
      480, 300, "Weekly performance report (real data — same endpoint the affiliate weekly report uses)."),
    N("build-weekly", "n8n-nodes-base.code",
      {"mode": "runOnceForAllItems",
       "jsCode": "const r = $input.first().json;\nreturn [{ json: { report: r.data ?? r } }];"},
      720, 300, "Unwraps the report envelope into { report } for posting."),
    N("report-configured", "n8n-nodes-base.if",
      {"combineOperation": "all",
       "conditions": {"string": [{"operation": "notEmpty",
                                  "value1": "={{ $env.REPORT_WEBHOOK_URL }}",
                                  "value2": ""}]}},
      960, 300, "Post the report only when REPORT_WEBHOOK_URL is set."),
    N("post-report", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "={{ $env.REPORT_WEBHOOK_URL }}",
       "options": {"timeout": 15000},
       "sendBody": True, "specifyBody": "json",
       "jsonBody": "={{ JSON.stringify($json.report) }}"},
      1200, 180, "Posts the weekly report to REPORT_WEBHOOK_URL."),
    N("report", "n8n-nodes-base.code",
      {"mode": "runOnceForAllItems", "jsCode": REPORT}, 1200, 300,
      "Formats the sweep + weekly report into the execution log."),
]
connections = {
    "schedule-trigger": {"main": [[{"node": "sweep", "type": "main", "index": 0}]]},
    "sweep": {"main": [[{"node": "weekly-report", "type": "main", "index": 0}]]},
    "weekly-report": {"main": [[{"node": "build-weekly", "type": "main", "index": 0}]]},
    "build-weekly": {"main": [[{"node": "report-configured", "type": "main", "index": 0}]]},
    "report-configured": {"main": [[{"node": "post-report", "type": "main", "index": 0}],
                                   [{"node": "report", "type": "main", "index": 0}]]},
    "post-report": {"main": [[{"node": "report", "type": "main", "index": 0}]]},
}

wf = {"name": "digital: marketing-goal-loop", "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "staticData": None,
      "tags": [{"name": "affiliate-system"}],
      "errorWorkflow": "digital-error-recovery",
      "notes": "Weekly goal loop: max-result targets, gap diagnosis, best-config re-apply."}
out = WF / "digital-marketing-goal-loop.json"
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
