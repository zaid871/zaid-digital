#!/usr/bin/env python3
"""Generate the template-expansion n8n workflows (v2 pattern).

  digital-docs-generation        topic/content in -> DOCX/PPTX/EPUB out
  digital-spreadsheets-generation title+kind/sheets in -> XLSX out
  digital-planners-generation     title+range in -> printable A4 planner PDF
  digital-thumbnails-generation   title in -> 1280x720 thumbnail / 1920x1080 intro/outro PNG
  digital-prompts-generation      topic in -> prompt library (md/txt/json)
  digital-icons-generation        theme in -> 16 SVG icons + 4 pattern tiles + sprite
  digital-landing-generation      business name in -> static index.html
  digital-luts-generation         presets in -> 5 .cube LUTs
  digital-presets-generation      presets in -> 5 Lightroom .xmp looks

Pattern (same as digital-ebook-generation v2):
  webhook -> validate (secret + input) -> if-valid -> demand pre-check
  (GET /api/v1/discovery/problem-miner/latest, never blocks) -> branch
  -> call-api -> normalize -> check-ok -> retry once after 60s on
  transient failure (never on compliance_rejected) -> respond.

Docs adds a hub-draft branch (no content supplied -> hub/run long-doc
drafts the JSON sections/slides/chapters, parse-draft validates them).
Spreadsheets adds a deterministic bank branch (kind -> headers + rows
with working SUM formulas; caller-supplied sheets skip the bank).
Icons / LUTs / presets are deterministic asset packs (no topic, no AI):
their validate nodes skip the demand check by default — the guardrail
is for topic-based generation, not for an explicitly requested pack.

Run: python3 scripts/gen-digital-expansion.py
Output: n8n/workflows/digital-{docs,spreadsheets,planners,thumbnails,prompts,icons,landing,luts,presets}-generation.json
"""
import json
import uuid
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "n8n", "workflows")

SECRET_CHECK = """const item = $input.first().json;
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

MATCH_DEMAND = """// Demand pre-check (plan guardrail #1): match topic/niche against the
// weekly Problem Miner top-10 (GET latest). Never blocks when the miner
// never ran or is unreachable — proceeds with a warning instead.
const r = $input.first().json;
const v = $('validate-input').first().json;
const skip = v.skipDemandCheck === true;
const key = String(v.demandKey ?? '');
if (skip) return [{ json: { demandOk: true, demandNote: 'demand_check_skipped',
  payload: v.payload, retries: 0, type: v.type } }];
const data = (r && r.ok === true && r.data) ? r.data : null;
if (!data) return [{ json: { demandOk: true, demandNote: 'demand_not_checked',
  payload: v.payload, retries: 0, type: v.type } }];
if (data.mined !== true) return [{ json: { demandOk: true, demandNote: 'not_mined_yet',
  payload: v.payload, retries: 0, type: v.type } }];
const words = key.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
const problems = (data.problems ?? []).map(p => String(p.text ?? ''));
const hits = problems.filter(t => words.some(w => t.toLowerCase().includes(w)));
if (hits.length) return [{ json: { demandOk: true, demandNote: 'demand_matched',
  matched: hits.slice(0, 3), payload: v.payload, retries: 0, type: v.type } }];
return [{ json: { demandOk: false, demandNote: 'no_demand_match',
  hints: problems.slice(0, 3), payload: v.payload, retries: 0, type: v.type } }];
"""

NEEDS_VALIDATION = """const j=$input.first().json; return [{ json: { ok:false, code:'needs_validation', error:'Is topic/niche ke liye mined problems me koi match nahi mila \\u2014 pehle demand validate karo ya skipDemandCheck:true bhejo.', hints: j.hints ?? [], demandNote: j.demandNote } }];"""

BUMP_RETRY = """const j = $input.first().json;
return [{ json: { payload: j.payload, retries: (Number(j.retries ?? 0) + 1),
  demandNote: j.demandNote ?? '', type: j.type, format: j.format } }];"""

RETRYABLE = """const retryable = ['generation_failed','unavailable','internal_error','timeout','mine_failed'].includes(code)
  || (r && r.ok !== true && !r.data && !code);"""


def node(name, ntype, version, pos, params):
    d = {"parameters": params, "name": name, "type": ntype, "typeVersion": version, "position": pos}
    if ntype == "n8n-nodes-base.webhook":
        d["webhookId"] = str(uuid.uuid5(uuid.NAMESPACE_URL, params.get("path", name)))
    return d


def webhook(path):
    return node("webhook-entry", "n8n-nodes-base.webhook", 2, [0, 300],
                {"httpMethod": "POST", "options": {"responseMode": "responseNode"}, "path": path})


def code_node(name, pos, js):
    return node(name, "n8n-nodes-base.code", 2, pos, {"jsCode": js, "mode": "runOnceForAllItems"})


def if_bool(name, pos, expr):
    return node(name, "n8n-nodes-base.if", 1, pos,
                {"combineOperation": "all", "conditions": {"boolean": [{"value1": expr, "value2": True}]}})


def http_get_latest(name, pos):
    return node(name, "n8n-nodes-base.httpRequest", 4.2, pos,
                {"method": "GET", "url": "={{ $env.BACKEND_URL }}/api/v1/discovery/problem-miner/latest",
                 "options": {"timeout": 15000}, "onError": "continueRegularOutput", "sendHeaders": True,
                 "headerParameters": {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]}})


def http_post(name, pos, url, body_expr, timeout, headers=True):
    params = {"method": "POST", "url": url, "sendBody": True, "specifyBody": "json",
              "jsonBody": body_expr, "options": {"timeout": timeout}, "onError": "continueRegularOutput"}
    if headers:
        params["sendHeaders"] = True
        params["headerParameters"] = {"parameters": [{"name": "x-n8n-secret", "value": "={{ $env.N8N_WEBHOOK_SECRET }}"}]}
    return node(name, "n8n-nodes-base.httpRequest", 4.2, pos, params)


def respond(name, pos, code):
    return node(name, "n8n-nodes-base.respondToWebhook", 1, pos,
                {"options": {"responseCode": code}, "respondWith": "json", "responseBody": "={{ $json }}"})


def link(conns, src, dst, out=0):
    conns.setdefault(src, {"main": []})
    while len(conns[src]["main"]) <= out:
        conns[src]["main"].append([])
    conns[src]["main"][out].append({"node": dst, "type": "main", "index": 0})


def base_nodes(webhook_path):
    """Shared 17-node skeleton (positions match digital-ebook-generation)."""
    return [
        webhook(webhook_path),
        if_bool("if-valid", [440, 300], "={{ $json.valid }}"),
        respond("respond-invalid", [660, 480], 400),
        http_get_latest("check-demand", [660, 220]),
        code_node("match-demand", [880, 220], MATCH_DEMAND),
        if_bool("if-demand", [1100, 220], "={{ $json.demandOk }}"),
        code_node("build-needs-validation", [1320, 380], NEEDS_VALIDATION),
        respond("respond-needs-validation", [1540, 380], 200),
        code_node("normalize-result", [1540, 140], ""),  # filled per workflow
        if_bool("check-ok", [1760, 140], "={{ $json.ok }}"),
        node("is-retryable", "n8n-nodes-base.if", 1, [1980, 300],
             {"combineOperation": "all", "conditions": {
                 "boolean": [{"value1": "={{ $json.retryable }}", "value2": True}],
                 "number": [{"value1": "={{ $json.retries }}", "value2": 1, "operation": "smaller"}]}}),
        node("wait-retry", "n8n-nodes-base.wait", 1.1, [1980, 140],
             {"amount": 60, "resume": "afterTimeInterval", "unit": "seconds"}),
        code_node("bump-retry", [2200, 140], BUMP_RETRY),
        respond("respond-success", [1980, -20], 200),
        respond("respond-failed", [2200, 300], 502),
    ]


def base_connections(conns, branch_node):
    link(conns, "webhook-entry", "validate-input")
    link(conns, "validate-input", "if-valid")
    link(conns, "if-valid", "check-demand", 0)
    link(conns, "if-valid", "respond-invalid", 1)
    link(conns, "check-demand", "match-demand")
    link(conns, "match-demand", "if-demand")
    link(conns, "if-demand", branch_node, 0)
    link(conns, "if-demand", "build-needs-validation", 1)
    link(conns, "build-needs-validation", "respond-needs-validation")
    link(conns, "call-api", "normalize-result")
    link(conns, "normalize-result", "check-ok")
    link(conns, "check-ok", "respond-success", 0)
    link(conns, "check-ok", "is-retryable", 1)
    link(conns, "is-retryable", "wait-retry", 0)
    link(conns, "is-retryable", "respond-failed", 1)
    link(conns, "wait-retry", "bump-retry")
    link(conns, "bump-retry", "call-api")


def normalize_js(type_label, prev_chain, success_fields, extra_prev=""):
    return f"""const r = $input.first().json;
let prev = null;
{prev_chain}
prev = prev ?? {{}};
let demandNote = prev.demandNote ?? '';
if (!demandNote) {{ try {{ demandNote = $('match-demand').first().json.demandNote ?? ''; }} catch {{}} }}
const retries = Number(prev.retries ?? 0);
const code = (r && r.code) || '';
{RETRYABLE}
if (r && r.ok === true && r.data) {{
  const d = r.data;
  return [{{ json: {{ ok: true, type: '{type_label}', retries, demandNote,
    payload: prev.payload ?? {{}},
{success_fields} }} }}];
}}
return [{{ json: {{ ok: false, type: '{type_label}', retries, retryable,
  demandNote, payload: prev.payload ?? {{}},
  error: (r && (r.message ?? r.error)) || 'Generation failed', code: code || 'generation_failed'{extra_prev} }} }}];
"""


def prev_try(names):
    lines = []
    for i, name in enumerate(names):
        if i == 0:
            lines.append(f"try {{ prev = $('{name}').first().json; }} catch {{}}")
        else:
            lines.append(f"if (!prev) {{ try {{ prev = $('{name}').first().json; }} catch {{}} }}")
    return "\n".join(lines)


# ---------------------------------------------------------------- docs
DOCS_VALIDATE = SECRET_CHECK + """
const format = String(body.format ?? 'docx').trim().toLowerCase();
if (!['docx','pptx','epub'].includes(format)) return [{ json: { valid: false, error: 'format docx, pptx ya epub hona chahiye' } }];
const title = String(body.title ?? body.topic ?? '').trim();
if (title.length < 3) return [{ json: { valid: false, error: 'title (min 3 chars) zaroori hai' } }];
const payload = { format, title };
for (const k of ['subtitle','author','language']) if (body[k] !== undefined) payload[k] = body[k];
const contentKey = format === 'docx' ? 'sections' : format === 'pptx' ? 'slides' : 'chapters';
const hasContent = Array.isArray(body[contentKey]) && body[contentKey].length > 0;
if (hasContent) payload[contentKey] = body[contentKey];
const topic = String(body.topic ?? title).trim();
const draftPrompt = format === 'pptx'
  ? `Write a presentation titled "${title}" about the topic "${topic}". Reply with ONLY a JSON array of 6-8 slides, no other text. Each slide: {"title": "short slide title", "bullets": ["3-5 short bullets, max 12 words each"], "notes": "one speaker-note sentence"}. Write in Roman-script Hinglish. Practical, specific content — no prices, no discounts, no income or result promises, no fake claims.`
  : format === 'epub'
  ? `Write an ebook titled "${title}" about the topic "${topic}". Reply with ONLY a JSON array of 4-6 chapters, no other text. Each chapter: {"heading": "chapter title", "paragraphs": ["3-4 paragraphs of real, useful content"]}. Write in Roman-script Hinglish. Practical, specific content — no prices, no discounts, no income or result promises, no fake claims.`
  : `Write a document titled "${title}" about the topic "${topic}". Reply with ONLY a JSON array of 4-6 sections, no other text. Each section: {"heading": "short heading", "paragraphs": ["2-3 useful paragraphs, plain text"], "bullets": ["up to 4 short bullets"]}. Write in Roman-script Hinglish. Practical, specific content — no prices, no discounts, no income or result promises, no fake claims.`;
return [{ json: { valid: true, type: 'document', format, payload, hasContent, topic, draftPrompt, demandKey: title, skipDemandCheck: body.skipDemandCheck === true, retries: 0 } }];
"""

PARSE_DRAFT = """// Hub draft -> structured content for POST /api/v1/digital/docs.
// Strict shape check: bad JSON or empty content fails loudly (no fake doc).
const r = $input.first().json;
const v = $('validate-input').first().json;
const format = v.format;
const contentKey = format === 'docx' ? 'sections' : format === 'pptx' ? 'slides' : 'chapters';
const text = (r && r.ok === true && r.data && r.data.output && r.data.output.text) ? String(r.data.output.text) : '';
if (!text) throw new Error('Hub draft failed: no text returned');
const start = text.indexOf('[');
const end = text.lastIndexOf(']');
if (start < 0 || end <= start) throw new Error('Hub draft failed: no JSON array found');
let arr;
try { arr = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('Hub draft failed: JSON parse nahi hua'); }
if (!Array.isArray(arr) || arr.length === 0) throw new Error('Hub draft failed: empty content');
const max = format === 'pptx' ? 40 : 30;
const clean = arr.slice(0, max).map((it) => {
  if (!it || typeof it !== 'object') return null;
  const t = String(it.title ?? it.heading ?? '').trim();
  if (!t) return null;
  if (format === 'pptx') return { title: t,
    bullets: (Array.isArray(it.bullets) ? it.bullets : []).map((b) => String(b).slice(0, 500)).slice(0, 8),
    notes: String(it.notes ?? '').slice(0, 1000) || undefined };
  if (format === 'docx') return { heading: t,
    paragraphs: (Array.isArray(it.paragraphs) ? it.paragraphs : []).map((p) => String(p).slice(0, 4000)).slice(0, 40),
    bullets: (Array.isArray(it.bullets) ? it.bullets : []).map((b) => String(b).slice(0, 500)).slice(0, 12) };
  return { heading: t,
    paragraphs: (Array.isArray(it.paragraphs) ? it.paragraphs : []).map((p) => String(p).slice(0, 4000)).slice(0, 40) };
}).filter(Boolean);
if (!clean.length) throw new Error('Hub draft failed: no usable sections');
const payload = { ...v.payload };
payload[contentKey] = clean;
return [{ json: { ...v, payload, retries: 0 } }];
"""

DOCS_NORMALIZE = normalize_js(
    "document",
    prev_try(["bump-retry", "parse-draft", "validate-input"]),
    "    format: prev.format ?? 'docx',\n    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    file: d.file ?? null, count: d.count ?? 0, files: d.files ?? {}, warnings: d.warnings ?? [],",
    ", format: prev.format ?? 'docx'",
)


def build_docs():
    nodes = base_nodes("digital-docs-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], DOCS_VALIDATE))
    nodes.append(code_node("has-content", [1320, 220], "") )  # replaced below (IF node)
    nodes[-1] = if_bool("has-content", [1320, 220], "={{ $json.hasContent }}")
    nodes.append(http_post("draft-hub", [1540, 380],
                           "={{ $env.BACKEND_URL }}/api/v1/hub/run",
                           "={{ JSON.stringify({ task: { kind: 'long-doc', prompt: $json.draftPrompt, mode: 'pipeline' }, deliver: { format: 'text' } }) }}",
                           300000))
    nodes.append(code_node("parse-draft", [1760, 380], PARSE_DRAFT))
    nodes.append(http_post("call-api", [1760, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/docs",
                           "={{ JSON.stringify($json.payload) }}", 300000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = DOCS_NORMALIZE
    # move call-api position: base has none; ensure order is stable
    conns = {}
    base_connections(conns, "has-content")
    link(conns, "has-content", "call-api", 0)
    link(conns, "has-content", "draft-hub", 1)
    link(conns, "draft-hub", "parse-draft")
    link(conns, "parse-draft", "call-api")
    return {"name": "digital-docs-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# ------------------------------------------------------- spreadsheets
SHEETS_VALIDATE = SECRET_CHECK + """
const title = String(body.title ?? '').trim();
if (title.length < 3) return [{ json: { valid: false, error: 'title (min 3 chars) zaroori hai' } }];
const kind = String(body.kind ?? '').trim().toLowerCase();
const kinds = ['budget','expense','inventory','sales','attendance','profit'];
const hasSheets = Array.isArray(body.sheets) && body.sheets.length > 0;
if (!hasSheets && !kinds.includes(kind)) return [{ json: { valid: false, error: 'sheets do, ya kind: budget/expense/inventory/sales/attendance/profit' } }];
const payload = { title };
if (hasSheets) payload.sheets = body.sheets;
return [{ json: { valid: true, type: 'spreadsheet', payload, hasSheets, kind: hasSheets ? '' : kind, demandKey: title, skipDemandCheck: body.skipDemandCheck === true, retries: 0 } }];
"""

BUILD_BANK = """// Deterministic tracker templates: headers + example rows + working
// formulas (strings starting with '=' — openpyxl stores them as real
// formulas, so SUMs keep working in Excel/Sheets).
const v = $('validate-input').first().json;
const kind = v.kind;
const BANKS = {
  budget: { sheets: [{ name: 'Budget', headers: ['Category','Budgeted','Actual','Difference'], rows: [
    ['Rent', 15000, 15000, '=B3-C3'],
    ['Groceries', 8000, 7200, '=B4-C4'],
    ['Transport', 3000, 3400, '=B5-C5'],
    ['Utilities', 2500, 2300, '=B6-C6'],
    ['Savings', 5000, 5000, '=B7-C7'],
    ['Other', 2000, 1500, '=B8-C8'],
    ['TOTAL', '=SUM(B3:B8)', '=SUM(C3:C8)', '=SUM(D3:D8)'],
  ]}] },
  expense: { sheets: [{ name: 'Expenses', headers: ['Date','Category','Description','Amount'], rows: [
    ['2026-11-01','Groceries','Weekly shop', 2450],
    ['2026-11-02','Transport','Metro card', 500],
    ['2026-11-03','Food','Lunch', 350],
    ['2026-11-05','Utilities','Electricity', 1200],
    ['2026-11-07','Health','Pharmacy', 800],
    ['TOTAL','','','=SUM(D3:D7)'],
  ]}] },
  inventory: { sheets: [{ name: 'Inventory', headers: ['Item','SKU','Stock','Reorder Level','Price','Value'], rows: [
    ['T-shirt Black','TS-BLK-01', 48, 20, 499, '=C3*E3'],
    ['T-shirt White','TS-WHT-01', 35, 20, 499, '=C4*E4'],
    ['Mug','MUG-01', 60, 25, 299, '=C5*E5'],
    ['Notebook','NB-01', 120, 50, 199, '=C6*E6'],
    ['TOTAL','','','','','=SUM(F3:F6)'],
  ]}] },
  sales: { sheets: [{ name: 'Sales', headers: ['Date','Product','Qty','Price','Total'], rows: [
    ['2026-11-01','Ebook', 3, 499, '=C3*D3'],
    ['2026-11-02','Template Pack', 2, 799, '=C4*D4'],
    ['2026-11-03','Ebook', 1, 499, '=C5*D5'],
    ['2026-11-04','Planner', 4, 299, '=C6*D6'],
    ['TOTAL','','','','=SUM(E3:E6)'],
  ]}] },
  attendance: { sheets: [{ name: 'Attendance', headers: ['Employee','Date','Status','Hours'], rows: [
    ['Ayesha','2026-11-03','Present', 8],
    ['Bilal','2026-11-03','Present', 8],
    ['Ayesha','2026-11-04','Present', 7.5],
    ['Bilal','2026-11-04','Leave', 0],
    ['TOTAL','','','=SUM(D3:D6)'],
  ]}] },
  profit: { sheets: [{ name: 'Profit', headers: ['Month','Revenue','Expenses','Profit'], rows: [
    ['Jan', 25000, 12000, '=B3-C3'],
    ['Feb', 32000, 14000, '=B4-C4'],
    ['Mar', 28000, 13000, '=B5-C5'],
    ['TOTAL', '=SUM(B3:B5)', '=SUM(C3:C5)', '=SUM(D3:D5)'],
  ]}] },
};
const bank = BANKS[kind];
if (!bank) throw new Error('Unknown tracker kind: ' + kind);
const payload = { title: v.payload.title, sheets: bank.sheets };
return [{ json: { ...v, payload, retries: 0 } }];
"""

SHEETS_NORMALIZE = normalize_js(
    "spreadsheet",
    prev_try(["bump-retry", "build-bank", "validate-input"]),
    "    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    file: d.file ?? null, count: d.count ?? 0, files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_spreadsheets():
    nodes = base_nodes("digital-spreadsheets-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], SHEETS_VALIDATE))
    nodes.append(if_bool("has-sheets", [1320, 220], "={{ $json.hasSheets }}"))
    nodes.append(code_node("build-bank", [1540, 380], BUILD_BANK))
    nodes.append(http_post("call-api", [1760, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/spreadsheets",
                           "={{ JSON.stringify($json.payload) }}", 300000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = SHEETS_NORMALIZE
    conns = {}
    base_connections(conns, "has-sheets")
    link(conns, "has-sheets", "call-api", 0)
    link(conns, "has-sheets", "build-bank", 1)
    link(conns, "build-bank", "call-api")
    return {"name": "digital-spreadsheets-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# ------------------------------------------------------------ planners
PLANNER_VALIDATE = SECRET_CHECK + """
const type = String(body.type ?? 'daily').trim().toLowerCase();
if (!['daily','weekly'].includes(type)) return [{ json: { valid: false, error: 'type daily ya weekly hona chahiye' } }];
const title = String(body.title ?? '').trim();
if (title.length < 3) return [{ json: { valid: false, error: 'title (min 3 chars) zaroori hai' } }];
const payload = { type, title };
for (const k of ['startDate','count','goals','habits']) if (body[k] !== undefined) payload[k] = body[k];
return [{ json: { valid: true, type: 'planner', payload, demandKey: title, skipDemandCheck: body.skipDemandCheck === true, retries: 0 } }];
"""

PLANNER_NORMALIZE = normalize_js(
    "planner",
    prev_try(["bump-retry", "match-demand"]),
    "    plannerType: d.type ?? 'daily',\n    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    file: d.file ?? null, count: d.count ?? 0, files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_planners():
    nodes = base_nodes("digital-planners-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], PLANNER_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/planners",
                           "={{ JSON.stringify($json.payload) }}", 300000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = PLANNER_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-planners-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# ----------------------------------------------------------- thumbnails
THUMB_VALIDATE = SECRET_CHECK + """
const title = String(body.title ?? '').trim();
if (title.length < 3) return [{ json: { valid: false, error: 'title (min 3 chars) zaroori hai' } }];
const style = String(body.style ?? 'dark').trim().toLowerCase();
if (!['dark','light'].includes(style)) return [{ json: { valid: false, error: 'style dark ya light hona chahiye' } }];
const format = String(body.format ?? 'thumbnail').trim().toLowerCase();
if (!['thumbnail','intro','outro'].includes(format)) return [{ json: { valid: false, error: 'format thumbnail, intro ya outro hona chahiye' } }];
const payload = { title, style, format };
for (const k of ['subtitle','backgroundPrompt']) if (body[k] !== undefined) payload[k] = body[k];
return [{ json: { valid: true, type: 'thumbnail', payload, demandKey: title, skipDemandCheck: body.skipDemandCheck === true, retries: 0 } }];
"""

THUMB_NORMALIZE = normalize_js(
    "thumbnail",
    prev_try(["bump-retry", "match-demand"]),
    "    format: d.kind ?? prev.format ?? 'thumbnail',\n    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    file: d.file ?? null, files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_thumbnails():
    nodes = base_nodes("digital-thumbnails-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], THUMB_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/thumbnails",
                           "={{ JSON.stringify($json.payload) }}", 600000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = THUMB_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-thumbnails-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


def main():
    os.makedirs(OUT, exist_ok=True)
    for build in (build_docs, build_spreadsheets, build_planners, build_thumbnails,
                  build_prompts, build_icons, build_landing, build_luts, build_presets):
        wf = build()
        path = os.path.join(OUT, wf["name"] + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(wf, f, indent=1, ensure_ascii=False)
        print(f"WROTE {path} ({len(wf['nodes'])} nodes)")


# ------------------------------------------------------------- prompts
PROMPTS_VALIDATE = SECRET_CHECK + """
const topic = String(body.topic ?? '').trim();
if (topic.length < 3) return [{ json: { valid: false, error: 'topic (min 3 chars) zaroori hai' } }];
const payload = { topic };
if (body.count !== undefined) payload.count = body.count;
for (const k of ['category','useAi']) if (body[k] !== undefined) payload[k] = body[k];
return [{ json: { valid: true, type: 'prompt_library', payload, demandKey: topic, skipDemandCheck: body.skipDemandCheck === true, retries: 0 } }];
"""

PROMPTS_NORMALIZE = normalize_js(
    "prompt_library",
    prev_try(["bump-retry", "match-demand"]),
    "    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    count: d.count ?? 0, prompts: d.prompts ?? [], files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_prompts():
    nodes = base_nodes("digital-prompts-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], PROMPTS_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/prompt-libraries",
                           "={{ JSON.stringify($json.payload) }}", 300000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = PROMPTS_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-prompts-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# --------------------------------------------------------------- icons
ICONS_VALIDATE = SECRET_CHECK + """
const theme = String(body.theme ?? 'dark').trim().toLowerCase();
if (!['dark','light'].includes(theme)) return [{ json: { valid: false, error: 'theme dark ya light hona chahiye' } }];
const payload = { theme };
for (const k of ['accent','includePatterns']) if (body[k] !== undefined) payload[k] = body[k];
// Deterministic asset pack — no topic, no AI: demand check is skipped
// by default (caller can enforce it with skipDemandCheck:false).
return [{ json: { valid: true, type: 'icon_bundle', payload, demandKey: 'icon bundle', skipDemandCheck: body.skipDemandCheck !== false, retries: 0 } }];
"""

ICONS_NORMALIZE = normalize_js(
    "icon_bundle",
    prev_try(["bump-retry", "match-demand"]),
    "    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    icons: d.icons ?? [], patterns: d.patterns ?? [], files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_icons():
    nodes = base_nodes("digital-icons-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], ICONS_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/icon-bundles",
                           "={{ JSON.stringify($json.payload) }}", 180000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = ICONS_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-icons-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# -------------------------------------------------------------- landing
LANDING_VALIDATE = SECRET_CHECK + """
const businessName = String(body.businessName ?? '').trim();
if (businessName.length < 2) return [{ json: { valid: false, error: 'businessName (min 2 chars) zaroori hai' } }];
const payload = { businessName };
for (const k of ['topic','tagline','features','ctaText','theme','useAi']) if (body[k] !== undefined) payload[k] = body[k];
return [{ json: { valid: true, type: 'landing_page', payload, demandKey: businessName, skipDemandCheck: body.skipDemandCheck === true, retries: 0 } }];
"""

LANDING_NORMALIZE = normalize_js(
    "landing_page",
    prev_try(["bump-retry", "match-demand"]),
    "    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    file: d.file ?? null, files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_landing():
    nodes = base_nodes("digital-landing-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], LANDING_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/landing-pages",
                           "={{ JSON.stringify($json.payload) }}", 300000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = LANDING_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-landing-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# ------------------------------------------------------------------ luts
LUTS_VALIDATE = SECRET_CHECK + """
const payload = {};
if (Array.isArray(body.presets)) payload.presets = body.presets;
// Deterministic asset pack — no topic, no AI: demand check is skipped
// by default (caller can enforce it with skipDemandCheck:false).
return [{ json: { valid: true, type: 'lut_pack', payload, demandKey: 'lut pack', skipDemandCheck: body.skipDemandCheck !== false, retries: 0 } }];
"""

LUTS_NORMALIZE = normalize_js(
    "lut_pack",
    prev_try(["bump-retry", "match-demand"]),
    "    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    presets: d.presets ?? [], files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_luts():
    nodes = base_nodes("digital-luts-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], LUTS_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/luts",
                           "={{ JSON.stringify($json.payload) }}", 120000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = LUTS_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-luts-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


# -------------------------------------------------------------- presets
PRESETS_VALIDATE = SECRET_CHECK + """
const payload = {};
if (Array.isArray(body.presets)) payload.presets = body.presets;
// Deterministic asset pack — no topic, no AI: demand check is skipped
// by default (caller can enforce it with skipDemandCheck:false).
return [{ json: { valid: true, type: 'preset_pack', payload, demandKey: 'preset pack', skipDemandCheck: body.skipDemandCheck !== false, retries: 0 } }];
"""

PRESETS_NORMALIZE = normalize_js(
    "preset_pack",
    prev_try(["bump-retry", "match-demand"]),
    "    title: d.title ?? '', slug: d.slug ?? '', dir: d.dir ?? '',\n    presets: d.presets ?? [], files: d.files ?? {}, warnings: d.warnings ?? [],",
)


def build_presets():
    nodes = base_nodes("digital-presets-generation")
    nodes.insert(1, code_node("validate-input", [220, 300], PRESETS_VALIDATE))
    nodes.append(http_post("call-api", [1320, 140],
                           "={{ $env.BACKEND_URL }}/api/v1/digital/presets",
                           "={{ JSON.stringify($json.payload) }}", 120000, headers=False))
    for n in nodes:
        if n["name"] == "normalize-result":
            n["parameters"]["jsCode"] = PRESETS_NORMALIZE
    conns = {}
    base_connections(conns, "call-api")
    return {"name": "digital-presets-generation", "pinData": {}, "active": False, "nodes": nodes, "connections": conns}


if __name__ == "__main__":
    main()
