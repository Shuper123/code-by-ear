#!/usr/bin/env python3
"""Validate every drill by running it (spec section 8, Validation). Fails on any error.

1. Run every Predict drill's code (real Python, real SQLite) and confirm the expected output.
2. Run every reference solution against its tests, and store a hash of each reference query's rows.
3. For Spot the bug, confirm the buggy code fails and the fixed code passes.
4. Lint: spoken fields contain no raw symbols, ids are unique, every ladder has all three steps,
   Drive drills meet the length limits.
5. Write reports/validation.md and reports/validation.json; exit 1 on any error.

Output is deterministic (no timestamps) so the report only changes when drills change.
"""
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRILL_DIR = ROOT / "src" / "data" / "drills"
DATASET_DIR = ROOT / "src" / "data" / "datasets"
HARNESS_DIR = ROOT / "src" / "runtimes"
REPORT_MD = ROOT / "reports" / "validation.md"
REPORT_JSON = ROOT / "reports" / "validation.json"
HASHES = ROOT / "src" / "data" / "reference_hashes.json"

MIN_L1_PER_LANG = 40
MIN_LADDERS_PER_LANG = 12
DRIVE_MAX_LINES = 4
DRIVE_MAX_WORDS = 60
TYPES = {"predict", "explain", "spot_bug", "plan", "concept", "sketch", "dictate", "build"}
TYPE_SLUG = {"predict": "predict", "explain": "explain", "spot_bug": "bug", "plan": "plan", "concept": "concept",
             "sketch": "sketch", "dictate": "dictate", "build": "build"}
LEVEL = {"predict": 1, "explain": 1, "spot_bug": 1, "plan": 1, "concept": 1, "sketch": 2, "dictate": 3, "build": 2}
# Raw code symbols that must never reach text-to-speech. A hyphen is fine between words, not before a digit.
BANNED = re.compile(r"[()\[\]{}=:#_<>*/%+\"`|\\;]|-(?=\d)")
SPOKEN_FIELDS = ("code_spoken", "prompt_spoken", "model_answer_spoken")

PY_WORKER = r"""
import json, signal, sys
sys.path.insert(0, sys.argv[1])
import py_harness as H

class Timeout(Exception):
    pass

def on_alarm(*_):
    raise Timeout("ran longer than 3 seconds")

signal.signal(signal.SIGALRM, on_alarm)
jobs = json.load(sys.stdin)
out = []
for job in jobs:
    signal.setitimer(signal.ITIMER_REAL, 3.0)
    try:
        if job["kind"] == "run":
            r = H.run_code(job["code"])
            r.pop("namespace", None)
        else:
            r = H.run_tests(job["code"], job["fn"], job["tests"])
    except Timeout as e:
        r = {"stdout": "", "error": "Timeout: " + str(e), "error_type": "Timeout", "ok": False}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    out.append(r)
print(json.dumps(out, default=repr))
"""


def run_python_jobs(jobs):
    if not jobs:
        return []
    p = subprocess.run([sys.executable, "-I", "-c", PY_WORKER, str(HARNESS_DIR)], input=json.dumps(jobs),
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        raise SystemExit(f"python worker crashed:\n{p.stderr}")
    return json.loads(p.stdout)


_datasets = {}


def dataset_sql(name):
    if name not in _datasets:
        _datasets[name] = (DATASET_DIR / f"{name}.sql").read_text()
    return _datasets[name]


def sql_run(query, dataset):
    """Run one query on a fresh copy of the dataset. Returns (rows, error)."""
    con = sqlite3.connect(":memory:")
    try:
        if dataset:
            con.executescript(dataset_sql(dataset))
        cur = con.execute(query)
        return cur.fetchall(), None
    except sqlite3.Error as e:
        return None, f"{type(e).__name__}: {e}"
    finally:
        con.close()


def fmt_value(v):
    if v is None:
        return "NULL"
    if isinstance(v, float):
        return repr(v)
    return str(v)


def fmt_rows(rows):
    return "\n".join(", ".join(fmt_value(v) for v in r) for r in rows)


def canon_rows(rows, order_matters):
    """Canonical rows for comparison: ignore column names, round floats, sort unless order matters."""
    def cv(v):
        if isinstance(v, float):
            v = round(v, 6)
            return int(v) if v.is_integer() else v
        return v
    out = [[cv(v) for v in r] for r in rows]
    if not order_matters:
        out.sort(key=lambda r: json.dumps(r))
    return out


def rows_hash(rows, order_matters):
    return hashlib.sha256(json.dumps(canon_rows(rows, order_matters)).encode()).hexdigest()[:16]


def tokens(s):
    s = s.strip().lower()
    s = re.sub(r"[\[\](){}'\",]", " ", s)
    return s.split()


def same_tokens(actual, expected, strict=False):
    a, b = tokens(actual), tokens(expected)
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x == y:
            continue
        if strict:
            return False
        try:
            if float(x) != float(y):
                return False
        except ValueError:
            return False
    return True


def code_lines(code):
    return [l for l in (code or "").split("\n") if l.strip()]


def word_count(s):
    return len(re.findall(r"[A-Za-z0-9']+", s or ""))


def main():
    drills = []
    for f in sorted(DRILL_DIR.glob("*.json")):
        for d in json.loads(f.read_text()):
            d["_file"] = f.name
            drills.append(d)

    errors = defaultdict(list)
    warnings = defaultdict(list)
    ids = Counter(d.get("id") for d in drills)
    for i, n in ids.items():
        if n > 1:
            errors[i].append(f"duplicate id ({n} drills)")

    # ---------- lint ----------
    for d in drills:
        did = d.get("id", "?")
        t = d.get("type")
        if t not in TYPES:
            errors[did].append(f"unknown type {t!r}")
            continue
        lang = d.get("lang")
        unit = d.get("unit", "")
        if lang not in ("sql", "python"):
            errors[did].append(f"bad lang {lang!r}")
        if (lang == "sql") != unit.startswith("S"):
            errors[did].append(f"unit {unit} does not match lang {lang}")
        if d.get("level") != LEVEL[t]:
            errors[did].append(f"level {d.get('level')} should be {LEVEL[t]} for {t}")
        prefix = f"{'sql' if lang == 'sql' else 'py'}-{unit.lower()}-{TYPE_SLUG[t]}-"
        if not did.startswith(prefix):
            errors[did].append(f"id should start with {prefix}")
        if not d.get("prompt_spoken"):
            errors[did].append("missing prompt_spoken")
        if not d.get("model_answer_spoken"):
            errors[did].append("missing model_answer_spoken")
        if d.get("code") and not d.get("code_spoken"):
            errors[did].append("code without code_spoken (raw code never goes to speech)")
        spoken = [(k, d.get(k)) for k in SPOKEN_FIELDS if d.get(k)]
        spoken += [(f"hints_spoken[{i}]", h) for i, h in enumerate(d.get("hints_spoken") or [])]
        spoken += [(f"say[{i}]", s) for i, s in enumerate(d.get("say") or [])]
        if d.get("bug"):
            spoken.append(("bug.fix_spoken", d["bug"].get("fix_spoken", "")))
        for k, v in spoken:
            m = BANNED.search(v)
            if m:
                errors[did].append(f"{k} contains raw symbol {m.group(0)!r}: {v[:80]}")
        if t in ("explain", "plan", "concept", "spot_bug") and not d.get("rubric"):
            errors[did].append("missing rubric (key points for AI grading)")
        if len(d.get("hints_spoken") or []) > 3:
            warnings[did].append("more than 3 hints")
        if not d.get("hints_spoken") and t in ("predict", "spot_bug", "sketch", "dictate", "build"):
            warnings[did].append("no hints")
        if d.get("drive_ok"):
            if t == "dictate":
                errors[did].append("Dictate is Parked only (drive_ok must be false)")
            if t == "build":
                errors[did].append("Build is Parked only for now (drive_ok must be false)")
            n_lines = len(code_lines(d.get("code")))
            if n_lines > DRIVE_MAX_LINES:
                errors[did].append(f"Drive drill has {n_lines} lines of code (max {DRIVE_MAX_LINES})")
            words = word_count(d.get("code_spoken", "")) + word_count(d.get("prompt_spoken", ""))
            if words > DRIVE_MAX_WORDS:
                errors[did].append(f"Drive drill prompt is {words} spoken words (max {DRIVE_MAX_WORDS})")
        if t == "predict" and "expected" not in d:
            errors[did].append("predict drill without expected")
        if t == "spot_bug":
            bug = d.get("bug") or {}
            if not bug.get("fixed_code") or not bug.get("fix_spoken") or not isinstance(bug.get("line"), int):
                errors[did].append("spot_bug needs bug.line, bug.fix_spoken and bug.fixed_code")
            elif not (1 <= bug["line"] <= len((d.get("code") or "").split("\n"))):
                errors[did].append(f"bug.line {bug['line']} is outside the code")
            if "line 1" not in (d.get("code_spoken") or "").lower():
                errors[did].append("spot_bug code_spoken should number its lines (Line 1, ...)")
        if t in ("sketch", "dictate"):
            if not d.get("reference"):
                errors[did].append("missing reference solution")
            if lang == "python" and (not d.get("tests") or not d.get("function_name") or not d.get("signature")):
                errors[did].append("Python Sketch/Dictate needs signature, function_name and tests")
            if lang == "sql" and not d.get("dataset"):
                errors[did].append("SQL Sketch/Dictate needs a dataset")
            if not d.get("vocab"):
                warnings[did].append("no vocab list")
        if t == "build":
            if lang != "sql":
                errors[did].append("Build tasks are SQL only for now")
            if not d.get("reference") or not d.get("dataset"):
                errors[did].append("Build task needs a reference query and a dataset")
            say = d.get("say")
            if not isinstance(say, list) or not say or not all(isinstance(s, str) and s.strip() for s in say):
                errors[did].append("Build task needs say: the reference as spoken steps")
            if not d.get("pattern"):
                errors[did].append("Build task needs a pattern name")

    # ---------- ladders ----------
    ladders = defaultdict(dict)
    for d in drills:
        if d.get("ladder"):
            ladders[d["ladder"]][d["type"]] = d["id"]
    for lid, steps in sorted(ladders.items()):
        missing = [s for s in ("plan", "sketch", "dictate") if s not in steps]
        if missing:
            errors[lid].append(f"ladder missing step(s): {', '.join(missing)}")

    # ---------- run code ----------
    py_jobs, py_meta = [], []

    def py_run(did, code, purpose):
        py_jobs.append({"kind": "run", "code": code})
        py_meta.append((did, purpose))

    def py_tests(did, code, fn, tests, purpose):
        py_jobs.append({"kind": "tests", "code": code, "fn": fn, "tests": tests})
        py_meta.append((did, purpose))

    hashes = {}
    checked = Counter()
    for d in drills:
        did, t, lang = d["id"], d["type"], d["lang"]
        code, ds = d.get("code"), d.get("dataset")
        if lang == "python":
            if t == "predict" and code:
                py_run(did, code, "predict")
            elif t == "spot_bug" and code and d.get("bug"):
                if d.get("tests"):
                    py_tests(did, code, d["function_name"], d["tests"], "bug-buggy")
                    py_tests(did, d["bug"]["fixed_code"], d["function_name"], d["tests"], "bug-fixed")
                else:
                    py_run(did, code, "bug-buggy")
                    py_run(did, d["bug"]["fixed_code"], "bug-fixed")
            elif t in ("sketch", "dictate") and d.get("reference") and d.get("tests"):
                py_tests(did, d["reference"], d["function_name"], d["tests"], "reference")
            elif code:
                py_run(did, code, "runs")
        else:
            if t == "predict" and code:
                rows, err = sql_run(code, ds)
                checked["sql"] += 1
                if err:
                    errors[did].append(f"query failed: {err}")
                elif d.get("answer_kind") == "row_count":
                    if str(len(rows)) != str(d.get("expected", "")).strip():
                        errors[did].append(f"expected {d.get('expected')!r} rows but the query returns {len(rows)}")
                else:
                    actual = fmt_rows(rows)
                    if not same_tokens(actual, d.get("expected", ""), d.get("strict_numbers", False)):
                        errors[did].append(f"expected {d.get('expected')!r} but the query returns {actual!r}")
            elif t == "spot_bug" and code and d.get("bug"):
                fixed, ferr = sql_run(d["bug"]["fixed_code"], ds)
                buggy, berr = sql_run(code, ds)
                checked["sql"] += 2
                om = d.get("order_matters", False)
                if ferr:
                    errors[did].append(f"fixed query fails: {ferr}")
                elif "expected" in d and not same_tokens(fmt_rows(fixed), d["expected"]):
                    errors[did].append(f"fixed query returns {fmt_rows(fixed)!r}, expected {d['expected']!r}")
                elif d.get("reference"):
                    ref, rerr = sql_run(d["reference"], ds)
                    if rerr or canon_rows(ref, om) != canon_rows(fixed, om):
                        errors[did].append("fixed query does not match the reference rows")
                if not ferr and not berr and canon_rows(buggy, om) == canon_rows(fixed, om):
                    errors[did].append("buggy query returns the same rows as the fixed query (the bug has no effect)")
            elif t in ("sketch", "dictate", "build") and d.get("reference"):
                rows, err = sql_run(d["reference"], ds)
                checked["sql"] += 1
                if err:
                    errors[did].append(f"reference query failed: {err}")
                elif not rows:
                    errors[did].append("reference query returns no rows")
                else:
                    hashes[did] = {"hash": rows_hash(rows, d.get("order_matters", False)), "rows": len(rows)}
            elif code:
                rows, err = sql_run(code, ds)
                checked["sql"] += 1
                if err:
                    errors[did].append(f"query failed: {err}")

    by_id = {d["id"]: d for d in drills}
    results = run_python_jobs(py_jobs)
    checked["python"] += len(results)
    pending_bug = {}
    for (did, purpose), r in zip(py_meta, results):
        d = by_id[did]
        if purpose == "predict":
            exp = d.get("expected", "")
            if r.get("error"):
                if r.get("error_type") != exp.strip():
                    errors[did].append(f"code raised {r['error']} but expected {exp!r}")
            else:
                actual = r["stdout"].replace("\r\n", "\n").strip()
                if actual != exp.strip():
                    errors[did].append(f"expected {exp!r} but the code prints {actual!r}")
        elif purpose == "runs":
            if r.get("error") and d.get("expected") != r.get("error_type"):
                errors[did].append(f"code does not run: {r['error']}")
        elif purpose == "reference":
            if not r.get("ok"):
                bad = [x for x in r.get("results", []) if not x.get("ok")]
                errors[did].append(f"reference fails its tests: {r.get('error') or bad[:2]}")
        elif purpose.startswith("bug-"):
            pending_bug.setdefault(did, {})[purpose] = r
    for did, rs in pending_bug.items():
        d = by_id[did]
        fixed, buggy = rs.get("bug-fixed"), rs.get("bug-buggy")
        if d.get("tests"):
            if not fixed.get("ok"):
                errors[did].append(f"fixed code fails its tests: {fixed.get('error') or fixed.get('results')}")
            if buggy.get("ok"):
                errors[did].append("buggy code passes every test (the bug has no effect)")
        else:
            exp = (d.get("expected") or "").strip()
            fixed_out = fixed["stdout"].strip()
            if fixed.get("error"):
                errors[did].append(f"fixed code raises {fixed['error']}")
            elif exp and fixed_out != exp:
                errors[did].append(f"fixed code prints {fixed_out!r}, expected {exp!r}")
            buggy_out = buggy["stdout"].strip()
            if not buggy.get("error") and buggy_out == fixed_out:
                errors[did].append("buggy code prints the same as the fixed code (the bug has no effect)")

    # ---------- counts ----------
    per_unit = defaultdict(Counter)
    for d in drills:
        per_unit[d["unit"]][d["type"]] += 1
        if d.get("drive_ok"):
            per_unit[d["unit"]]["drive_ok"] += 1
    l1 = Counter(d["lang"] for d in drills if d["level"] == 1 and not d.get("ladder"))
    ladder_count = Counter()
    for lid, steps in ladders.items():
        any_id = next(iter(steps.values()))
        ladder_count[by_id[any_id]["lang"]] += 1
    for lang in ("sql", "python"):
        if l1[lang] < MIN_L1_PER_LANG:
            errors[f"({lang})"].append(f"only {l1[lang]} Level 1 drills (need at least {MIN_L1_PER_LANG})")
        if ladder_count[lang] < MIN_LADDERS_PER_LANG:
            errors[f"({lang})"].append(f"only {ladder_count[lang]} ladders (need at least {MIN_LADDERS_PER_LANG})")

    # ---------- report ----------
    n_err = sum(len(v) for v in errors.values())
    n_warn = sum(len(v) for v in warnings.values())
    lines = [
        "# Drill validation report",
        "",
        "Generated by `scripts/validate_drills.py`. Every drill below was run with real Python and real SQLite.",
        "",
        f"- Drills: {len(drills)} ({l1['sql']} SQL and {l1['python']} Python Level 1 drills outside ladders;"
        f" ladders: {ladder_count['sql']} SQL, {ladder_count['python']} Python)",
        f"- Code runs: {checked['python']} Python, {checked['sql']} SQL",
        f"- Errors: {n_err}",
        f"- Warnings: {n_warn}",
        f"- Result: {'PASS' if n_err == 0 else 'FAIL'}",
        "",
        "## Drills per unit",
        "",
        "| Unit | Predict | Explain | Spot the bug | Plan | Concept | Sketch | Dictate | Build | Drive-ok |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for unit in sorted(per_unit, key=lambda u: (u[0] != "S", u)):
        c = per_unit[unit]
        lines.append(f"| {unit} | {c['predict']} | {c['explain']} | {c['spot_bug']} | {c['plan']} | {c['concept']} |"
                     f" {c['sketch']} | {c['dictate']} | {c['build']} | {c['drive_ok']} |")
    lines += ["", "## Errors", ""]
    lines += [f"- `{k}`: {m}" for k in sorted(errors) for m in errors[k]] or ["None."]
    lines += ["", "## Warnings", ""]
    lines += [f"- `{k}`: {m}" for k in sorted(warnings) for m in warnings[k]] or ["None."]
    if hashes:
        lines += ["", "## Reference row hashes (SQL Sketch, Dictate and Build)", "", "| Drill | Rows | Hash |", "| --- | --- | --- |"]
        lines += [f"| {k} | {v['rows']} | `{v['hash']}` |" for k, v in sorted(hashes.items())]
    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_MD.write_text("\n".join(lines) + "\n")
    REPORT_JSON.write_text(json.dumps({
        "drills": len(drills), "level1": dict(l1), "ladders": dict(ladder_count), "errors": {k: v for k, v in sorted(errors.items())},
        "warnings": {k: v for k, v in sorted(warnings.items())}, "reference_hashes": dict(sorted(hashes.items())),
    }, indent=2) + "\n")
    HASHES.write_text(json.dumps(dict(sorted(hashes.items())), indent=2) + "\n")

    print(f"validate_drills: {len(drills)} drills, {checked['python']} Python runs, {checked['sql']} SQL runs, "
          f"{n_err} errors, {n_warn} warnings -> {REPORT_MD.relative_to(ROOT)}")
    for k in sorted(errors):
        for m in errors[k]:
            print(f"  ERROR {k}: {m}")
    sys.exit(1 if n_err else 0)


if __name__ == "__main__":
    main()
