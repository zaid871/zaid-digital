#!/usr/bin/env python3
"""Generate n8n/workflows/affiliate/instagram-auto-dm.json — the comment-to-DM
auto-reply loop (ManyChat-style, but free and self-hosted).

Flow A (one-time Meta verification):  GET  /affiliate/ig-comments
    -> verify-challenge (hub.verify_token check) -> respond with hub.challenge
Flow B (live comments):             POST /affiliate/ig-comments
    -> extract top-level comments (skip own) -> keyword match (word boundary)
    -> build DM (template + affiliate link + disclosure, price-gated)
    -> POST graph.facebook.com/{IG_USER_ID}/messages (Private Replies:
       recipient.comment_id — 1 reply per comment, 7-day window)

Env: META_VERIFY_TOKEN, IG_USER_ID, IG_ACCESS_TOKEN, DM_KEYWORDS (default
LINK — include the digital videos' keywords too, e.g. RSVP),
DM_REPLY_TEMPLATE ({{username}} {{keyword}} {{link}} placeholders),
DM_DEFAULT_LINK, DM_LINK_MAP_JSON (media_id -> link), DM_DISCLOSURE.
Digital lane (added 2026-11-13, cross-transfer): DM_DIGITAL_LINK_MAP_JSON
(media_id -> own-product link) + DM_DIGITAL_TEMPLATE (no disclosure).
Meta allows ONE webhook callback URL per app, so a separate digital
auto-DM workflow could never receive comment events — the branch lives
in this workflow: a media in the digital map gets the own-product
template with NO affiliate disclosure; everything else keeps the
affiliate template + disclosure.
"""
import json
import uuid
from pathlib import Path

OUT = Path(__file__).parent.parent / "n8n" / "workflows" / "affiliate" / "instagram-auto-dm.json"

VERSIONS = {
    "n8n-nodes-base.webhook": 2,
    "n8n-nodes-base.respondToWebhook": 1.1,
    "n8n-nodes-base.code": 2,
    "n8n-nodes-base.if": 1,
    "n8n-nodes-base.httpRequest": 4.2,
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


VERIFY_JS = """\
// Meta webhook verification handshake (GET). Meta calls once at setup with
// ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... — we echo the
// challenge only when the token matches META_VERIFY_TOKEN.
const q = $json.query ?? {};
const mode = q['hub.mode'];
const token = q['hub.verify_token'];
const challenge = q['hub.challenge'];
const expected = $env.META_VERIFY_TOKEN;
if (!expected) throw new Error('META_VERIFY_TOKEN is not set on this n8n instance.');
if (mode === 'subscribe' && token === expected && challenge) {
  return [{ challenge: String(challenge) }];
}
throw new Error('Webhook verification failed (hub.mode / hub.verify_token mismatch).');
"""

EXTRACT_JS = """\
// Pull top-level comments out of the Meta webhook payload.
// Skips: non-comment fields, replies (parent_id), empty text, and the
// account's own comments (from.id === entry.id) so we never DM ourselves.
const body = $json.body ?? $json;
const entries = Array.isArray(body.entry) ? body.entry : [];
const out = [];
for (const entry of entries) {
  const accountId = String(entry.id ?? '');
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  for (const ch of changes) {
    if (ch.field !== 'comments') continue;
    const v = ch.value ?? {};
    if (!v.id || !v.text) continue;
    if (v.parent_id) continue;
    const fromId = String(v.from?.id ?? '');
    if (fromId && accountId && fromId === accountId) continue;
    out.push({
      commentId: String(v.id),
      text: String(v.text),
      username: String(v.from?.username ?? 'dost'),
      mediaId: String(v.media?.id ?? ''),
      commentedAt: v.timestamp ?? null,
    });
  }
}
return out;
"""

KEYWORD_JS = """\
// Keyword match with word boundaries, case-insensitive.
// DM_KEYWORDS="LINK,link bhej" -> matches "LINK" but not "BLINK".
const rawKws = ($env.DM_KEYWORDS || 'LINK').split(',').map((s) => s.trim()).filter(Boolean);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
const re = new RegExp(`\\\\b(${rawKws.map(escapeRe).join('|')})\\\\b`, 'i');
const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const m = String(j.text ?? '').match(re);
  out.push({ ...j, keyword: m ? m[1].toUpperCase() : null, matched: !!m });
}
return out;
"""

BUILD_DM_JS = """\
// Compose the DM: template + resolved link (+ disclosure for affiliate).
// Two lanes on the ONE webhook (Meta allows a single callback URL per
// app, so a separate digital auto-DM workflow could never receive
// comment events — the branch lives here):
//  - DIGITAL lane: mediaId in DM_DIGITAL_LINK_MAP_JSON -> own-product
//    template (DM_DIGITAL_TEMPLATE), NO affiliate disclosure.
//  - AFFILIATE lane: mediaId in DM_LINK_MAP_JSON (or DM_DEFAULT_LINK)
//    -> affiliate template + disclosure.
// HARD GATES (fail-safe, never send on violation):
//  1. No link resolvable for this media -> do not send.
//  2. Price/offer pattern in the final text -> do not send.
//  3. Over 900 chars -> do not send.
const DISCLOSURE = $env.DM_DISCLOSURE
  || 'Affiliate disclosure: is link se aapko koi extra kharch nahi hota, humein chhota sa commission mil sakta hai.';
const affiliateTemplate = $env.DM_REPLY_TEMPLATE
  || 'Namaste {{username}}! Aapne {{keyword}} comment kiya \\u2014 ye raha product ka link: {{link}}';
const digitalTemplate = $env.DM_DIGITAL_TEMPLATE
  || 'Namaste {{username}}! Aapne {{keyword}} comment kiya \\u2014 ye raha aapke product ka link: {{link}}';
let linkMap = {};
try { linkMap = JSON.parse($env.DM_LINK_MAP_JSON || '{}'); } catch (e) { linkMap = {}; }
let digitalMap = {};
try { digitalMap = JSON.parse($env.DM_DIGITAL_LINK_MAP_JSON || '{}'); } catch (e) { digitalMap = {}; }
const priceRe = /(\\u20b9|\\brs\\.?\\b|\\brupees?\\b|%\\s?off|\\bdiscount\\b|\\boffer\\b|\\bdeal\\b|\\bprice\\b|\\bcost\\b|\\b\\d[\\d,]*\\s?(\\u20b9|rs|inr)\\b)/i;
const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const isDigital = !!digitalMap[j.mediaId];
  const link = isDigital ? digitalMap[j.mediaId] : (linkMap[j.mediaId] || $env.DM_DEFAULT_LINK || '');
  if (!link) {
    out.push({ ...j, send: false, reason: 'no link for this media (set DM_DIGITAL_LINK_MAP_JSON / DM_LINK_MAP_JSON / DM_DEFAULT_LINK)' });
    continue;
  }
  const template = isDigital ? digitalTemplate : affiliateTemplate;
  let text = template.split('{{username}}').join(j.username)
    .split('{{keyword}}').join(j.keyword || 'LINK')
    .split('{{link}}').join(link);
  if (!isDigital) text = `${text}\\n\\n${DISCLOSURE}`;
  if (priceRe.test(text)) {
    out.push({ ...j, send: false, reason: 'price/offer pattern in DM text — blocked by compliance gate' });
    continue;
  }
  if (text.length > 900) {
    out.push({ ...j, send: false, reason: 'DM text exceeds 900 chars' });
    continue;
  }
  out.push({ ...j, send: true, dmText: text, link, lane: isDigital ? 'digital' : 'affiliate' });
}
return out;
"""

LOG_SENT_JS = """\
const rows = $input.all().map((i) => i.json);
for (const r of rows) {
  console.log(JSON.stringify({ event: 'auto_dm_sent', commentId: r.commentId, username: r.username, keyword: r.keyword, mediaId: r.mediaId, lane: r.lane ?? 'affiliate', at: new Date().toISOString() }));
}
return rows.map((r) => ({ commentId: r.commentId, username: r.username, keyword: r.keyword, lane: r.lane ?? 'affiliate', sent: true }));
"""

LOG_SKIP_JS = """\
const rows = $input.all().map((i) => i.json);
for (const r of rows) {
  console.log(JSON.stringify({ event: 'auto_dm_skipped', commentId: r.commentId ?? null, username: r.username ?? null, reason: r.send === false ? r.reason : 'keyword not matched', at: new Date().toISOString() }));
}
return rows.map((r) => ({ commentId: r.commentId ?? null, sent: false, reason: r.send === false ? r.reason : 'keyword not matched' }));
"""

nodes = [
    N("webhook-verify", "n8n-nodes-base.webhook",
      {"httpMethod": "GET", "path": "affiliate/ig-comments"},
      0, 100, "Meta verification handshake (GET, one-time at setup)."),
    N("verify-challenge", "n8n-nodes-base.code", code(VERIFY_JS), 240, 100,
      "Echo hub.challenge only when hub.verify_token matches META_VERIFY_TOKEN."),
    N("respond-challenge", "n8n-nodes-base.respondToWebhook",
      {"respondWith": "text", "responseBody": "={{ $json.challenge }}"},
      480, 100, "Returns the challenge text with HTTP 200."),

    N("webhook-events", "n8n-nodes-base.webhook",
      {"httpMethod": "POST", "path": "affiliate/ig-comments"},
      0, 400, "Meta comment webhook (POST). Subscribe the 'comments' field in the Meta app dashboard."),
    N("extract-comments", "n8n-nodes-base.code", code(EXTRACT_JS), 240, 400,
      "Top-level comments only; skips replies and the account's own comments."),
    N("keyword-match", "n8n-nodes-base.code", code(KEYWORD_JS), 480, 400,
      "Word-boundary keyword match (DM_KEYWORDS, default LINK)."),
    N("is-keyword", "n8n-nodes-base.if",
      {"combineOperation": "all",
       "conditions": {"boolean": [{"value1": "={{ $json.matched }}", "value2": True}]}},
      720, 400, "Only keyword comments continue to the DM."),
    N("build-dm", "n8n-nodes-base.code", code(BUILD_DM_JS), 960, 340,
      "Template + affiliate link + disclosure. Price-gated: violations never send."),
    N("should-send", "n8n-nodes-base.if",
      {"combineOperation": "all",
       "conditions": {"boolean": [{"value1": "={{ $json.send }}", "value2": True}]}},
      1200, 340, "Compliance gate output."),
    N("send-private-reply", "n8n-nodes-base.httpRequest",
      {"method": "POST",
       "url": "https://graph.facebook.com/v21.0/{{ $env.IG_USER_ID }}/messages?access_token={{ $env.IG_ACCESS_TOKEN }}",
       "options": {"timeout": 20000},
       "sendBody": True, "specifyBody": "json",
       "jsonBody": json.dumps({
           "recipient": {"comment_id": "={{ $json.commentId }}"},
           "message": {"text": "={{ $json.dmText }}"},
       }, indent=1)},
      1440, 280,
      "Private Replies API: 1 reply per comment, 7-day window, 750/hour/account."),
    N("log-sent", "n8n-nodes-base.code", code(LOG_SENT_JS), 1680, 280,
      "Structured log of sent DMs."),
    N("log-skipped", "n8n-nodes-base.code", code(LOG_SKIP_JS), 1440, 480,
      "Structured log of skipped comments (no keyword / gate blocked)."),
]

def C(node: str) -> dict:
    """Long-form connection entry (n8n 2.x import requires type+index)."""
    return {"node": node, "type": "main", "index": 0}


connections = {
    "webhook-verify": {"main": [[C("verify-challenge")]]},
    "verify-challenge": {"main": [[C("respond-challenge")]]},
    "webhook-events": {"main": [[C("extract-comments")]]},
    "extract-comments": {"main": [[C("keyword-match")]]},
    "keyword-match": {"main": [[C("is-keyword")]]},
    "is-keyword": {"main": [[C("build-dm")], [C("log-skipped")]]},
    "build-dm": {"main": [[C("should-send")]]},
    "should-send": {"main": [[C("send-private-reply")], [C("log-skipped")]]},
    "send-private-reply": {"main": [[C("log-sent")]]},
}

workflow = {
    "name": "affiliate: instagram-auto-dm",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1"},
    "staticData": None,
    "tags": [{"name": "affiliate-system"}],
    "notes": (
        "Comment-to-DM auto-reply (official Meta Private Replies API — no password bots). "
        "SETUP: 1) Meta app dashboard -> Webhooks -> subscribe 'comments' field to "
        "https://<n8n-domain>/webhook/affiliate/ig-comments with META_VERIFY_TOKEN. "
        "2) Grant the app instagram_manage_comments + instagram_manage_messages (Facebook Login flow; "
        "dev mode is enough for your own account). 3) Set env: META_VERIFY_TOKEN, IG_USER_ID, "
        "IG_ACCESS_TOKEN, DM_KEYWORDS (include digital videos' keywords too, e.g. RSVP), "
        "DM_REPLY_TEMPLATE, DM_DEFAULT_LINK, DM_LINK_MAP_JSON, DM_DIGITAL_LINK_MAP_JSON, "
        "DM_DIGITAL_TEMPLATE. "
        "Two lanes: a media in DM_DIGITAL_LINK_MAP_JSON gets the own-product template with NO "
        "affiliate disclosure; everything else keeps the affiliate template + disclosure. "
        "The DM always ends with the affiliate disclosure on the affiliate lane; price/offer text can never be sent."
    ),
}

OUT.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {OUT} ({len(nodes)} nodes)")
