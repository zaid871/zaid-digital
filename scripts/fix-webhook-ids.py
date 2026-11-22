"""Add webhookId to every webhook node missing one (deterministic uuid5 of node id).

n8n's getNodeWebhookPath: a webhook node WITHOUT webhookId registers under
<workflowId>/<nodeName>/<path> instead of the short /webhook/<path> that all
callers use. n8n's UI assigns webhookId on save (resolveNodeWebhookId); the
CLI import does not, so generator-built workflows lack it. Fix: deterministic
uuid5(NAMESPACE_URL, node id) so re-runs are stable.
"""
import json, glob, uuid, sys

files = [f for f in glob.glob('n8n/workflows/*.json') + glob.glob('n8n/workflows/affiliate/*.json')
         if '_retired' not in f and 'v1-legacy' not in f and not f.endswith('digital-products.json')]
fixed_files = 0
fixed_nodes = 0
for f in sorted(files):
    d = json.load(open(f))
    changed = False
    for n in d.get('nodes', []):
        if n.get('type') == 'n8n-nodes-base.webhook' and 'webhookId' not in n:
            n['webhookId'] = str(uuid.uuid5(uuid.NAMESPACE_URL, n.get('id', n.get('name', ''))))
            changed = True
            fixed_nodes += 1
    if changed:
        json.dump(d, open(f, 'w'), indent=2)
        fixed_files += 1
        print('fixed', f)
print(f'files fixed: {fixed_files}, webhook nodes given webhookId: {fixed_nodes}')
