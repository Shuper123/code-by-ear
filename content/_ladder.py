# Builds the three steps of a ladder (spec section 4): Plan (level 1), Sketch (level 2), Dictate (level 3).
# All three steps share one problem, one reference solution and one set of tests.


def ladder(lang, unit, num, *, task, plan_rubric, plan_model, reference, model_answer, hints, vocab,
           topics, difficulty=2, dataset=None, order_matters=False, signature=None, function_name=None,
           tests=None, sketch_drive_ok=False, plan_drive_ok=True):
    pre = "sql" if lang == "sql" else "py"
    lid = f"{pre}-ladder-{num:03d}"
    u = unit.lower()
    shared = dict(ladder=lid, difficulty=difficulty, topics=topics)
    code_fields = dict(reference=reference, vocab=vocab, hints_spoken=hints, model_answer_spoken=model_answer)
    if lang == "sql":
        code_fields.update(dataset=dataset, order_matters=order_matters)
    else:
        code_fields.update(signature=signature, function_name=function_name, tests=tests)
    plan = dict(id=f"{pre}-{u}-plan-l{num:03d}", type="plan", drive_ok=plan_drive_ok, **shared,
                prompt_spoken=f"Plan this out loud. {task}", rubric=plan_rubric, model_answer_spoken=plan_model)
    if lang == "sql" and dataset:
        plan["dataset"] = dataset
    sketch = dict(id=f"{pre}-{u}-sketch-{num:03d}", type="sketch", drive_ok=sketch_drive_ok, **shared,
                  prompt_spoken=task, **code_fields)
    dictate = dict(id=f"{pre}-{u}-dictate-{num:03d}", type="dictate", drive_ok=False, **shared,
                   prompt_spoken=f"Dictate this in Verbal Syntax. {task}", **code_fields)
    return [plan, sketch, dictate]
