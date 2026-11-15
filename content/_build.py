# Build tasks: a question asked the way a manager would ask it, answered by writing the query out loud one
# clause at a time. `say` is the reference as spoken steps; tests/build.test.ts runs those steps through the
# parser and checks the rows against the reference, and validate_drills.py runs the reference itself.


def build(unit, num, *, task, reference, say, model_answer, hints, topics, pattern, difficulty=2,
          dataset="factory", order_matters=False):
    return dict(
        id=f"sql-{unit.lower()}-build-{num:03d}", type="build", drive_ok=False, difficulty=difficulty, topics=topics,
        pattern=pattern, dataset=dataset, order_matters=order_matters, prompt_spoken=task, reference=reference,
        say=say, hints_spoken=hints, model_answer_spoken=model_answer,
    )
