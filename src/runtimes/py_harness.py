# Test harness shared by scripts/validate_drills.py (CPython) and the in-app Pyodide worker.
# It runs learner or reference code in a fresh namespace, captures printed output, and checks
# function tests. Results are plain dicts so they can cross to JavaScript as JSON.
import contextlib
import io
import json


def to_jsonable(v):
    """Make a Python value comparable with JSON test expectations (tuples -> lists, sets -> sorted lists)."""
    if isinstance(v, (list, tuple)):
        return [to_jsonable(x) for x in v]
    if isinstance(v, (set, frozenset)):
        items = [to_jsonable(x) for x in v]
        try:
            return sorted(items)
        except TypeError:
            return sorted(items, key=repr)
    if isinstance(v, dict):
        return {str(k): to_jsonable(x) for k, x in v.items()}
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return v  # keep floats as floats; equality with ints still holds in Python
    return v


def run_code(code):
    """Execute code; return {'stdout', 'error', 'error_type', 'namespace'}."""
    ns = {"__name__": "__main__"}
    buf = io.StringIO()
    err = None
    etype = None
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(code, "<drill>", "exec"), ns)
    except Exception as e:  # noqa: BLE001 - we report any learner error
        err = f"{type(e).__name__}: {e}"
        etype = type(e).__name__
    return {"stdout": buf.getvalue(), "error": err, "error_type": etype, "namespace": ns}


def run_tests(code, function_name, tests):
    """Run code, then call function_name(*args) for each test. Returns a JSON-able summary."""
    r = run_code(code)
    out = {"ok": False, "stdout": r["stdout"], "error": r["error"], "results": []}
    if r["error"]:
        return out
    fn = r["namespace"].get(function_name)
    if not callable(fn):
        out["error"] = f"NameError: function {function_name} is not defined"
        return out
    all_ok = True
    for t in tests:
        args = t.get("args", [])
        expected = t.get("expected")
        try:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                got = fn(*args)
            got_j = to_jsonable(got)
            ok = got_j == expected
            out["results"].append({"args": args, "expected": expected, "got": got_j, "ok": ok})
        except Exception as e:  # noqa: BLE001
            ok = False
            out["results"].append({"args": args, "expected": expected, "error": f"{type(e).__name__}: {e}", "ok": False})
        all_ok = all_ok and ok
    out["ok"] = all_ok
    return out


def run_tests_json(code, function_name, tests_json):
    return json.dumps(run_tests(code, function_name, json.loads(tests_json)), default=repr)
