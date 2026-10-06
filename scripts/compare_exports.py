"""Compare fresh ComfyUI-frontend exports (saved by scripts/export-templates.js) with the shipped templates.

Usage: python scripts/compare_exports.py <exports_dir>
Exit code 0 only if all 20 templates are identical to the re-exported graphs.
"""
import json
import sys
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / "server" / "templates"


def main(exports: Path) -> int:
    bad = 0
    for tpl in sorted(TEMPLATES.glob("*.json")):
        exp_file = exports / tpl.name
        if not exp_file.is_file():
            print(f"MISSING   {tpl.stem}")
            bad += 1
            continue
        t = json.loads(tpl.read_text("utf-8"))
        e = json.loads(exp_file.read_text("utf-8"))
        if t == e:
            print(f"IDENTICAL {tpl.stem} ({len(t)} nodes)")
            continue
        bad += 1
        print(f"DIFF      {tpl.stem}")
        for nid in sorted(set(t) | set(e)):
            if nid not in t:
                print(f"  export-only node {nid} ({e[nid]['class_type']})")
            elif nid not in e:
                print(f"  template-only node {nid} ({t[nid]['class_type']})")
            else:
                for k in sorted(set(t[nid]["inputs"]) | set(e[nid]["inputs"])):
                    if t[nid]["inputs"].get(k) != e[nid]["inputs"].get(k):
                        print(f"  {nid}.{k}: {str(t[nid]['inputs'].get(k))[:60]!r} != {str(e[nid]['inputs'].get(k))[:60]!r}")
    print(f"\n{20 - bad}/20 identical" if bad else "\nall 20 identical")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
