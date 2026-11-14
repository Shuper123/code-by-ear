# S6: ROW_NUMBER, RANK, SUM OVER, LAG
LANG = "sql"
UNIT = "S6"

LOTS_1_5 = "Lots 1 to 5 have quantities 120, 340, 90, 200 and 120."
LOTS_1_3 = "Lots 1, 2 and 3 have quantities 120, 340 and 90."

DRILLS = [
    dict(
        id="sql-s6-predict-001", type="predict", difficulty=2, topics=["row_number"], dataset="factory",
        code="""
            SELECT lot_id FROM (
              SELECT lot_id, ROW_NUMBER() OVER (ORDER BY qty DESC) AS rn
              FROM lots WHERE lot_id <= 5
            ) WHERE rn = 2;
        """,
        code_spoken=("From a subquery that numbers lots 1 to 5 with row number over order by qty descending, as rn, "
                     "select the lot id where rn is 2."),
        prompt_spoken=f"{LOTS_1_5} What does this query return?",
        expected="4",
        hints_spoken=["Row 1 is the biggest. Which lot is second biggest?"],
        model_answer_spoken="It returns lot 4, the second largest at 200.",
    ),
    dict(
        id="sql-s6-predict-002", type="predict", difficulty=3, topics=["rank", "ties"], dataset="factory",
        code="""
            SELECT rnk FROM (
              SELECT lot_id, RANK() OVER (ORDER BY qty DESC) AS rnk
              FROM lots WHERE lot_id <= 5
            ) WHERE lot_id = 3;
        """,
        code_spoken=("From a subquery that ranks lots 1 to 5 with rank over order by qty descending, as rnk, select "
                     "rnk for lot 3."),
        prompt_spoken=f"{LOTS_1_5} Lot 3 is the one with 90. What does this query return?",
        expected="5",
        hints_spoken=["Lots 1 and 5 tie for third.", "Rank skips numbers after a tie."],
        model_answer_spoken="It returns 5. Lots 1 and 5 tie at rank 3, so rank skips 4 and lot 3 gets 5.",
    ),
    dict(
        id="sql-s6-predict-003", type="predict", difficulty=2, topics=["running total", "sum over"], dataset="factory",
        code="""
            SELECT SUM(qty) OVER (ORDER BY lot_id) AS running
            FROM lots WHERE lot_id <= 3;
        """,
        code_spoken="Select the sum of qty over order by lot id, as running, from lots where lot id is at most 3.",
        prompt_spoken=f"{LOTS_1_3} What does this query return?",
        expected="120\n460\n550",
        accept=["120 460 550"],
        hints_spoken=["Each row adds its quantity to the total so far."],
        model_answer_spoken="It returns a running total of 120, then 460, then 550.",
    ),
    dict(
        id="sql-s6-predict-004", type="predict", difficulty=3, topics=["lag"], dataset="factory",
        code="""
            SELECT qty - LAG(qty) OVER (ORDER BY lot_id)
            FROM lots WHERE lot_id <= 3;
        """,
        code_spoken="Select qty minus lag of qty over order by lot id, from lots where lot id is at most 3.",
        prompt_spoken=f"{LOTS_1_3} What does this query return?",
        expected="NULL\n220\n-250",
        accept=["null 220 negative 250", "none 220 minus 250"],
        hints_spoken=["Lag gives the previous row's value. The first row has none."],
        model_answer_spoken=("It returns null, then 220, then negative 250, each lot's change from the lot before. The "
                             "first lot has no previous lot."),
    ),
    dict(
        id="sql-s6-explain-001", type="explain", difficulty=2, topics=["row_number", "partition by"], dataset="factory",
        code="""
            SELECT part_id, lot_id,
              ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY produced_on) AS nth
            FROM lots;
        """,
        code_spoken=("Select part id, lot id, and row number over partition by part id, order by produced on, as nth, "
                     "from lots."),
        prompt_spoken="What does this query do?",
        rubric=["numbers each part's lots", "in production order", "the numbering restarts at 1 for every part"],
        model_answer_spoken="It numbers each part's lots in production order, starting again at 1 for every part.",
    ),
    dict(
        id="sql-s6-explain-002", type="explain", difficulty=2, topics=["avg over", "partition by"], dataset="factory",
        code="""
            SELECT lot_id, qty,
              AVG(qty) OVER (PARTITION BY part_id) AS part_avg
            FROM lots;
        """,
        code_spoken="Select lot id, qty, and the average qty over partition by part id, as part avg, from lots.",
        prompt_spoken="What does this query do?",
        rubric=["shows every lot", "next to the average quantity of all lots for the same part",
                "rows are not collapsed the way group by would"],
        model_answer_spoken=("It shows each lot next to the average quantity for its part, without collapsing rows the "
                             "way group by would."),
    ),
    dict(
        id="sql-s6-explain-003", type="explain", difficulty=3, topics=["lag", "partition by"], dataset="factory",
        code="""
            SELECT lot_id, machine_id, produced_on,
              LAG(produced_on) OVER (PARTITION BY machine_id ORDER BY produced_on) AS prev_run
            FROM lots;
        """,
        code_spoken=("Select lot id, machine id, produced on, and lag of produced on over partition by machine id, "
                     "order by produced on, as previous run, from lots."),
        prompt_spoken="What does this query do?",
        rubric=["for each lot, shows when the same machine made its previous lot", "partitioned by machine",
                "the first lot on each machine gets null", "useful to see gaps between runs"],
        model_answer_spoken=("For each lot it shows when the same machine made its previous lot, so you can see the gap "
                             "between runs. Each machine's first lot gets null."),
    ),
    dict(
        id="sql-s6-bug-001", type="spot_bug", difficulty=2, topics=["window functions", "where"], dataset="factory",
        order_matters=False,
        code="""
            SELECT lot_id, qty
            FROM lots
            WHERE ROW_NUMBER() OVER (ORDER BY qty DESC) <= 3;
        """,
        code_spoken=("Line 1, select lot id and qty. Line 2, from lots. Line 3, where row number over order by qty "
                     "descending is at most 3."),
        prompt_spoken="This should return the three biggest lots. Which line has the bug, and what's the fix?",
        bug=dict(line=3, fix_spoken=("On line 3, window functions can't go in where. Compute the row number in a "
                                     "subquery, then filter on it outside."),
                 fixed_code="""
                    SELECT lot_id, qty FROM (
                      SELECT lot_id, qty, ROW_NUMBER() OVER (ORDER BY qty DESC, lot_id) AS rn FROM lots
                    ) WHERE rn <= 3;
                 """),
        rubric=["names line 3", "window functions run after where, so they can't be used in it",
                "compute row number in a subquery or with clause and filter outside"],
        hints_spoken=["Window functions are computed after where runs."],
        model_answer_spoken=("Line 3. Window functions are computed after where, so they can't filter there. Number the "
                             "rows in a subquery and filter outside."),
    ),
    dict(
        id="sql-s6-bug-002", type="spot_bug", difficulty=2, topics=["partition by"], dataset="factory",
        code="""
            SELECT lot_id, part_id,
              ROW_NUMBER() OVER (ORDER BY produced_on, lot_id) AS nth
            FROM lots;
        """,
        code_spoken=("Line 1, select lot id and part id. Line 2, row number over order by produced on, as nth. Line 3, "
                     "from lots."),
        prompt_spoken=("This should number each part's lots separately, starting at 1 for every part. Which line has "
                       "the bug, and what's the fix?"),
        bug=dict(line=2, fix_spoken="On line 2, add partition by part id inside over.",
                 fixed_code="""
                    SELECT lot_id, part_id,
                      ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY produced_on, lot_id) AS nth
                    FROM lots;
                 """),
        rubric=["names line 2", "without partition by, numbering runs across all lots", "add partition by part id"],
        hints_spoken=["What makes the numbering restart?"],
        model_answer_spoken="Line 2. Without partition by, the numbering runs across every lot. Add partition by part id.",
    ),
    dict(
        id="sql-s6-concept-001", type="concept", difficulty=2, topics=["row_number", "rank"],
        prompt_spoken="What's the difference between row number and rank when values tie?",
        rubric=["row number gives every row a different number", "rank gives tied rows the same number",
                "rank then skips, so after two rows tied at 3 the next is 5"],
        model_answer_spoken=("Row number gives every row a different number, even on ties. Rank gives tied rows the same "
                             "number and then skips, so after two rows tied at 3, the next is 5."),
    ),
    dict(
        id="sql-s6-plan-001", type="plan", difficulty=3, topics=["lag", "partition by"],
        prompt_spoken=("Plan this out loud. For every lot, show how its quantity changed from the previous lot of the "
                       "same part."),
        rubric=["select lot id, part id and qty", "lag of qty over partition by part id order by produced on",
                "subtract the lag from qty to get the change"],
        model_answer_spoken=("Select lot id, part id and qty, plus lag of qty over partition by part id ordered by "
                             "produced on, and subtract it from qty to get the change."),
    ),
]

# ---------- ladders ----------
from _ladder import ladder  # noqa: E402

DRILLS += ladder(
    "sql", UNIT, 11, dataset="factory", topics=["row_number", "partition by"], difficulty=3,
    task=("For every lot, show the lot id, the part id, and the lot's number within its part, counting in lot "
          "id order."),
    plan_rubric=["select lot id and part id from lots", "row number over partition by part id",
                 "order by lot id inside over"],
    plan_model="Select lot id, part id, and row number over a window partitioned by part id and ordered by lot id.",
    reference="SELECT lot_id, part_id, ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY lot_id) FROM lots;",
    vocab=["lots", "lot_id", "part_id"],
    hints=["Row number restarts for each partition.", "Partition by part id, order by lot id."],
    model_answer="Select lot id, part id, and row number over partition by part id order by lot id, from lots.",
)
DRILLS += ladder(
    "sql", UNIT, 12, dataset="factory", topics=["running total", "sum over"], difficulty=2,
    task="Show each lot id, its quantity, and a running total of quantity in lot id order.",
    plan_rubric=["select lot id and qty from lots", "sum of qty over order by lot id", "no group by needed"],
    plan_model="Select lot id, quantity, and the sum of quantity over a window ordered by lot id.",
    reference="SELECT lot_id, qty, SUM(qty) OVER (ORDER BY lot_id) FROM lots;",
    vocab=["lots", "lot_id", "qty"],
    hints=["A running total is a sum over a window.", "Order the window by lot id."],
    model_answer="Select lot id, qty, and the sum of qty over order by lot id, from lots.",
)
