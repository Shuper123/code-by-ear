#!/usr/bin/env python3
"""Turn the drill sources in content/*.py into the JSON files the app loads (src/data/drills/<unit>.json).

Each content file defines LANG ("sql" or "python"), UNIT ("S1".."S6", "P1".."P6") and DRILLS, a list of
dicts in the drill format from spec section 8. Python triple-quoted strings keep the code readable; this
script fills in lang, unit, level and defaults, and writes one JSON file per unit.

Edit content/*.py, then run:  python3 scripts/build_drills.py && python3 scripts/validate_drills.py
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "src" / "data" / "drills"

LEVEL = {"predict": 1, "explain": 1, "spot_bug": 1, "plan": 1, "concept": 1, "sketch": 2, "dictate": 3}
KEY_ORDER = [
    "id", "lang", "unit", "level", "type", "ladder", "difficulty", "drive_ok", "dataset", "topics",
    "code", "code_spoken", "prompt_spoken", "expected", "answer_kind", "accept", "strict_numbers", "rubric", "bug",
    "reference", "order_matters", "signature", "function_name", "tests", "vocab", "hints_spoken",
    "model_answer_spoken",
]


def dedent_code(s):
    """Strip the common indentation and the leading/trailing blank lines of a triple-quoted block."""
    lines = s.split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    indent = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    return "\n".join(l[indent:] for l in lines)


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def normalize(d, lang, unit):
    d = dict(d)
    d["lang"] = lang
    d["unit"] = unit
    d.setdefault("level", LEVEL[d["type"]])
    d.setdefault("difficulty", 1)
    d.setdefault("drive_ok", d["level"] == 1)
    d.setdefault("topics", [])
    for k in ("code", "reference", "signature"):
        if k in d and isinstance(d[k], str):
            d[k] = dedent_code(d[k])
    if "bug" in d:
        d["bug"] = dict(d["bug"])
        d["bug"]["fixed_code"] = dedent_code(d["bug"]["fixed_code"])
    if d["type"] == "predict":
        d.setdefault("accept", [])
    d.setdefault("hints_spoken", [])
    extra = sorted(k for k in d if k not in KEY_ORDER)
    if extra:
        raise SystemExit(f"{d.get('id')}: unknown field(s) {extra}")
    return {k: d[k] for k in KEY_ORDER if k in d}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for path in sorted(CONTENT.glob("*.py")):
        if path.name.startswith("_"):
            continue
        mod = load(path)
        drills = [normalize(d, mod.LANG, mod.UNIT) for d in mod.DRILLS]
        out = OUT / f"{mod.UNIT.lower()}.json"
        out.write_text(json.dumps(drills, indent=2, ensure_ascii=False) + "\n")
        written.append(f"{out.name} ({len(drills)})")
    # remove JSON files whose content source is gone
    keep = {f"{load(p).UNIT.lower()}.json" for p in CONTENT.glob("*.py") if not p.name.startswith("_")}
    for f in OUT.glob("*.json"):
        if f.name not in keep:
            f.unlink()
    print("build_drills:", ", ".join(written))


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    main()
