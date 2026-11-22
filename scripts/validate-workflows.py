#!/usr/bin/env python3
"""Statically validate n8n workflow JSONs (graph + Code-node JS syntax).

  - every node has a name, type, and position
  - every connection target names an existing node
  - every Code node's jsCode passes `node --check`

Run: python3 scripts/validate-workflows.py [file ...]
Default: all n8n/workflows/*.json
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WF_DIR = ROOT / "n8n" / "workflows"


def check_file(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        wf = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return [f"{path.name}: invalid JSON: {e}"]
    nodes = wf.get("nodes", [])
    names = set()
    for n in nodes:
        if not n.get("name") or not n.get("type"):
            errors.append(f"{path.name}: node missing name/type: {n}")
        if "position" not in n:
            errors.append(f"{path.name}: node {n.get('name')} missing position")
        names.add(n.get("name"))
    conns = wf.get("connections", {})
    for src, outs in conns.items():
        if src not in names:
            errors.append(f"{path.name}: connection from unknown node {src}")
        for out_list in (outs.get("main") or []):
            for c in out_list:
                if c.get("node") not in names:
                    errors.append(f"{path.name}: {src} -> unknown node {c.get('node')}")
    for n in nodes:
        if n.get("type") == "n8n-nodes-base.code":
            js = (n.get("parameters") or {}).get("jsCode", "")
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
                f.write(js)
                tmp = f.name
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            if r.returncode != 0:
                errors.append(f"{path.name}: node {n.get('name')} JS syntax error: {r.stderr.strip()[:300]}")
    return errors


def main() -> int:
    files = [Path(a) for a in sys.argv[1:]] or sorted(WF_DIR.glob("*.json"))
    total = 0
    all_errors: list[str] = []
    for f in files:
        total += 1
        errs = check_file(f)
        if errs:
            all_errors.extend(errs)
            print(f"FAIL  {f.name} ({len(errs)} error(s))")
        else:
            print(f"PASS  {f.name}")
    print(f"\n{total} workflows checked, {len(all_errors)} error(s)")
    for e in all_errors:
        print("  -", e)
    return 1 if all_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
