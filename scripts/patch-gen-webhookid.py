"""Patch gen scripts so webhook nodes they emit carry a webhookId (idempotent).

n8n's getNodeWebhookPath: a webhook node WITHOUT webhookId registers under
<workflowId>/<nodeName>/<path> instead of the short /webhook/<path>. The UI
assigns webhookId on save; the CLI import does not. Inject a deterministic
webhookId (uuid5 of the webhook path, unique per workflow) in the N()/node()
helpers whenever they build a webhook node.
"""
import re, sys

FILES = [
    'scripts/gen-auto-dm.py',
    'scripts/gen-digital-7point.py',
    'scripts/gen-digital-expansion.py',
    'scripts/gen-digital-levers.py',
    'scripts/gen-digital-machine.py',
    'scripts/gen-digital-pmf.py',
    'scripts/gen-digital-strategist.py',
    'scripts/gen-multi-platform.py',
]

SPREAD = ('**({"webhookId": str(uuid.uuid5(uuid.NAMESPACE_URL, params.get("path", name)))}'
          ' if ntype == "n8n-nodes-base.webhook" else {}),')

EXP_OLD = ('def node(name, ntype, version, pos, params):\n'
           '    return {"parameters": params, "name": name, "type": ntype, "typeVersion": version, "position": pos}')
EXP_NEW = ('def node(name, ntype, version, pos, params):\n'
           '    d = {"parameters": params, "name": name, "type": ntype, "typeVersion": version, "position": pos}\n'
           '    if ntype == "n8n-nodes-base.webhook":\n'
           '        d["webhookId"] = str(uuid.uuid5(uuid.NAMESPACE_URL, params.get("path", name)))\n'
           '    return d')

for f in FILES:
    src = open(f).read()
    if 'webhookId' in src and 'uuid.uuid5' in src:
        print('already patched', f)
        continue
    orig = src
    if 'import uuid' not in src:
        m = re.search(r'^(import .+\n|from .+ import .+\n)', src, re.M)
        assert m, f'no import line in {f}'
        src = src[:m.end()] + 'import uuid\n' + src[m.end():]
    if 'gen-digital-expansion.py' in f:
        assert EXP_OLD in src, f'node() anchor missing in {f}'
        src = src.replace(EXP_OLD, EXP_NEW)
    else:
        # Find the N() helper and its return dict's "parameters": params entry.
        m = re.search(r'def N\(name, ntype, params', src)
        assert m, f'N() def missing in {f}'
        # Look for "parameters": params, (comma form) after the N def.
        idx = src.find('"parameters": params,', m.start())
        if idx != -1:
            src = src[:idx] + '"parameters": params,\n        ' + SPREAD + src[idx + len('"parameters": params,'):]
        else:
            # Closing-brace form: "parameters": params}
            idx = src.find('"parameters": params}', m.start())
            assert idx != -1, f'parameters anchor missing in {f}'
            src = (src[:idx] + '"parameters": params,\n        ' + SPREAD.rstrip(',') + '}' +
                   src[idx + len('"parameters": params}') :])
    assert src != orig, f'no change in {f}'
    open(f, 'w').write(src)
    print('patched', f)

print('GEN PATCH OK')
