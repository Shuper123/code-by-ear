# S4: INNER and LEFT joins, aliases
LANG = "sql"
UNIT = "S4"

DRILLS = [
    dict(
        id="sql-s4-predict-001", type="predict", difficulty=2, topics=["left join", "null"], dataset="factory",
        code="""
            SELECT m.machine_id
            FROM machines m
            LEFT JOIN lots l ON l.machine_id = m.machine_id
            WHERE l.lot_id IS NULL;
        """,
        code_spoken=("Select m dot machine id from machines m, left join lots l on l dot machine id equals m dot "
                     "machine id, where l dot lot id is null."),
        prompt_spoken="Machine 6 has never made a lot. Every other machine has. What does this query return?",
        expected="6",
        hints_spoken=["A left join keeps machines with no lots, with nulls on the lots side."],
        model_answer_spoken="It returns machine 6, the only machine with no matching lots.",
    ),
    dict(
        id="sql-s4-predict-002", type="predict", difficulty=1, topics=["inner join"], dataset="factory",
        code="""
            SELECT COUNT(*)
            FROM machines m
            JOIN lots l ON l.machine_id = m.machine_id;
        """,
        code_spoken="Select the count of rows from machines m, joined to lots l on l dot machine id equals m dot machine id.",
        prompt_spoken="All 120 lots were made on machines in the machines table. What does this query return?",
        expected="120",
        hints_spoken=["Each lot matches exactly one machine."],
        model_answer_spoken="It returns 120. Each lot matches one machine, so there's one row per lot.",
    ),
    dict(
        id="sql-s4-predict-003", type="predict", difficulty=3, topics=["left join", "row counts"], dataset="factory",
        code="""
            SELECT COUNT(*)
            FROM machines m
            LEFT JOIN lots l ON l.machine_id = m.machine_id;
        """,
        code_spoken=("Select the count of rows from machines m, left joined to lots l on l dot machine id equals m dot "
                     "machine id."),
        prompt_spoken="There are 120 lots and 6 machines, and machine 6 has no lots. What does this query return?",
        expected="121",
        hints_spoken=["One row per matching lot, plus rows for machines with no match."],
        model_answer_spoken="It returns 121, one row for each of the 120 lots, plus one row for machine 6 with nulls.",
    ),
    dict(
        id="sql-s4-predict-004", type="predict", difficulty=1, topics=["inner join"], dataset="factory",
        code="""
            SELECT COUNT(*)
            FROM lots l
            JOIN defects d ON d.lot_id = l.lot_id
            WHERE l.lot_id = 1;
        """,
        code_spoken=("Select the count of rows from lots l, joined to defects d on d dot lot id equals l dot lot id, "
                     "where l dot lot id is 1."),
        prompt_spoken="Lot 1 has two defect records. What does this query return?",
        expected="2",
        hints_spoken=["One row per matching defect."],
        model_answer_spoken="It returns 2, one row for each of lot 1's defects.",
    ),
    dict(
        id="sql-s4-predict-005", type="predict", difficulty=2, topics=["left join"], dataset="factory",
        code="""
            SELECT COUNT(*)
            FROM lots l
            LEFT JOIN defects d ON d.lot_id = l.lot_id
            WHERE l.lot_id = 3;
        """,
        code_spoken=("Select the count of rows from lots l, left joined to defects d on d dot lot id equals l dot lot "
                     "id, where l dot lot id is 3."),
        prompt_spoken="Lot 3 has no defect records. What does this query return?",
        expected="1",
        hints_spoken=["A left join keeps the lot even with no match."],
        model_answer_spoken="It returns 1. The left join keeps lot 3 once, with nulls for the defect columns.",
    ),
    dict(
        id="sql-s4-explain-001", type="explain", difficulty=2, topics=["left join", "count"], dataset="factory",
        code="""
            SELECT p.part_name, COUNT(l.lot_id)
            FROM parts p
            LEFT JOIN lots l ON l.part_id = p.part_id
            GROUP BY p.part_name;
        """,
        code_spoken=("Select p dot part name and the count of l dot lot id from parts p, left join lots l on l dot "
                     "part id equals p dot part id, grouped by part name."),
        prompt_spoken="What does this query do?",
        rubric=["counts lots for every part", "the left join keeps parts with no lots", "those parts show a count of 0"],
        model_answer_spoken="It counts the lots for every part. Because of the left join, a part with no lots still shows up with 0.",
    ),
    dict(
        id="sql-s4-explain-002", type="explain", difficulty=1, topics=["inner join", "where"], dataset="shop",
        code="""
            SELECT o.order_id, c.name
            FROM orders o
            JOIN customers c ON c.customer_id = o.customer_id
            WHERE o.status = 'cancelled';
        """,
        code_spoken=("Select o dot order id and c dot name from orders o, joined to customers c on c dot customer id "
                     "equals o dot customer id, where o dot status is cancelled."),
        prompt_spoken="What does this query do?",
        rubric=["only cancelled orders", "joins each order to its customer", "shows the order id and the customer's name"],
        model_answer_spoken="It lists each cancelled order with the name of the customer who placed it.",
    ),
    dict(
        id="sql-s4-bug-001", type="spot_bug", difficulty=1, topics=["left join"], dataset="shop",
        code="""
            SELECT c.name, o.order_id
            FROM customers c
            JOIN orders o ON o.customer_id = c.customer_id;
        """,
        code_spoken=("Line 1, select c dot name and o dot order id. Line 2, from customers c. Line 3, join orders o on "
                     "o dot customer id equals c dot customer id."),
        prompt_spoken=("This should list every customer, including customers with no orders. Which line has the bug, "
                       "and what's the fix?"),
        bug=dict(line=3, fix_spoken="On line 3, use a left join so customers with no orders still appear.",
                 fixed_code="""
                    SELECT c.name, o.order_id
                    FROM customers c
                    LEFT JOIN orders o ON o.customer_id = c.customer_id;
                 """),
        rubric=["names line 3", "an inner join drops customers with no orders", "use a left join"],
        hints_spoken=["What happens to a customer with no matching order?"],
        model_answer_spoken="Line 3. An inner join drops customers who never ordered. Use a left join.",
    ),
    dict(
        id="sql-s4-bug-002", type="spot_bug", difficulty=2, topics=["join keys"], dataset="factory",
        code="""
            SELECT l.lot_id, p.part_name
            FROM lots l
            JOIN parts p ON p.part_id = l.lot_id;
        """,
        code_spoken=("Line 1, select l dot lot id and p dot part name. Line 2, from lots l. Line 3, join parts p on "
                     "p dot part id equals l dot lot id."),
        prompt_spoken="This should show each lot with its part name. Which line has the bug, and what's the fix?",
        bug=dict(line=3, fix_spoken="On line 3, join on l dot part id, not l dot lot id.",
                 fixed_code="""
                    SELECT l.lot_id, p.part_name
                    FROM lots l
                    JOIN parts p ON p.part_id = l.part_id;
                 """),
        rubric=["names line 3", "it matches part id to lot id, which is the wrong key", "join on l dot part id"],
        hints_spoken=["Which column in lots points to parts?"],
        model_answer_spoken="Line 3. It matches part id to the lot id. Join on l dot part id instead.",
    ),
    dict(
        id="sql-s4-bug-003", type="spot_bug", difficulty=2, topics=["aliases", "ambiguous columns"], dataset="factory",
        code="""
            SELECT machine_id, line, part_name
            FROM machines m
            JOIN parts p ON p.line = m.line;
        """,
        code_spoken=("Line 1, select machine id, line, and part name. Line 2, from machines m. Line 3, join parts p on "
                     "p dot line equals m dot line."),
        prompt_spoken=("This should list each machine with the parts made on its line. Which line has the bug, and "
                       "what's the fix?"),
        bug=dict(line=1, fix_spoken="On line 1, write m dot line. Both tables have a line column.",
                 fixed_code="""
                    SELECT machine_id, m.line, part_name
                    FROM machines m
                    JOIN parts p ON p.line = m.line;
                 """),
        rubric=["names line 1", "line exists in both tables, so plain line is ambiguous", "qualify it as m dot line"],
        hints_spoken=["Which tables have a column called line?"],
        model_answer_spoken="Line 1. Both tables have a line column, so plain line is ambiguous. Write m dot line.",
    ),
    dict(
        id="sql-s4-concept-001", type="concept", difficulty=1, topics=["inner join", "left join"],
        prompt_spoken="What's the difference between an inner join and a left join?",
        rubric=["inner join keeps only rows that match in both tables",
                "left join keeps every row from the left table", "unmatched rows get nulls"],
        model_answer_spoken=("An inner join keeps only rows that match in both tables. A left join keeps every row from "
                             "the left table and fills in nulls where there's no match."),
    ),
    dict(
        id="sql-s4-plan-001", type="plan", difficulty=2, topics=["joins"],
        prompt_spoken=("Plan this out loud. List each defect with its lot's production date and the description of "
                       "its defect code."),
        rubric=["start from defects", "join lots on lot id for produced on", "join defect codes on defect code for the description"],
        model_answer_spoken=("Select from defects, join lots on lot id to get produced on, and join defect codes on "
                             "defect code to get the description."),
    ),
]

# ---------- ladders ----------
from _ladder import ladder  # noqa: E402

DRILLS += ladder(
    "sql", UNIT, 7, dataset="factory", topics=["inner join"], difficulty=2, sketch_drive_ok=True,
    task="List each lot id with the name of its part.",
    plan_rubric=["from lots", "join parts on part id", "select lot id and part name"],
    plan_model="Start from lots, join parts on matching part id, and select the lot id and the part name.",
    reference="SELECT l.lot_id, p.part_name FROM lots l JOIN parts p ON p.part_id = l.part_id;",
    vocab=["lots", "parts", "lot_id", "part_id", "part_name"],
    hints=["The two tables share part id.", "Join parts to lots on part id."],
    model_answer="Select lot id and part name from lots joined to parts on part id.",
)
DRILLS += ladder(
    "sql", UNIT, 8, dataset="factory", topics=["left join", "count"], difficulty=3,
    task="List every machine id with the number of lots it made, including machines with none.",
    plan_rubric=["start from machines", "left join lots on machine id", "count lot id, not star, so empty machines get 0",
                 "group by machine id"],
    plan_model=("Start from machines, left join lots on machine id, count the lot ids so a machine with no lots "
                "gets zero, and group by machine id."),
    reference=("SELECT m.machine_id, COUNT(l.lot_id) FROM machines m "
               "LEFT JOIN lots l ON l.machine_id = m.machine_id GROUP BY m.machine_id;"),
    vocab=["machines", "lots", "machine_id", "lot_id"],
    hints=["A left join keeps machines with no lots.", "Count lot id so missing lots count as zero."],
    model_answer=("Select machine id and the count of lot id from machines, left join lots on machine id, grouped "
                  "by machine id."),
)

# ---------- build tasks ----------
from _build import build  # noqa: E402

DRILLS += [
    build(
        UNIT, 1, pattern="join-aggregate", difficulty=2, topics=["inner join", "group by", "sum", "ambiguous columns"],
        task="How many defective pieces has each machine produced? Show the machine id and the total defect quantity.",
        reference="SELECT l.machine_id, SUM(d.qty) FROM defects d JOIN lots l ON l.lot_id = d.lot_id GROUP BY l.machine_id;",
        say=["from defects", "join lots using lot id", "group by machine id",
             "select machine id, sum of defects dot quantity"],
        hints=["Defect quantities are in defects. The machine is on the lot.",
               "Join defects to lots on lot id. Both tables have a quantity, so say defects dot quantity."],
        model_answer="Join defects to lots on lot id, group by machine id, and sum the defects quantity.",
    ),
    build(
        UNIT, 2, pattern="join-filter", difficulty=2, topics=["inner join", "where", "count"],
        task="How many defect records are structural?",
        reference=("SELECT COUNT(*) FROM defects d JOIN defect_codes c ON c.defect_code = d.defect_code "
                   "WHERE c.category = 'structural';"),
        say=["from defects", "join defect codes using defect code", "where category equals structural",
             "select count star"],
        hints=["The category is in the defect codes table.",
               "Join defects to defect codes on defect code, then filter on the category."],
        model_answer="Join defects to defect codes on defect code, keep the structural category, and count the rows.",
    ),
    build(
        UNIT, 3, pattern="anti-join", difficulty=3, topics=["left join", "null"],
        task="Which lots have no defects at all? List the lot ids.",
        reference="SELECT l.lot_id FROM lots l LEFT JOIN defects d ON d.lot_id = l.lot_id WHERE d.defect_id IS NULL;",
        say=["from lots", "left join defects using lot id", "where defect id is null", "select lot id"],
        hints=["Start from lots and keep every lot, even the ones with no match in defects.",
               "After a left join, a lot with no defects has null in the defect columns."],
        model_answer="Left join defects to lots on lot id, and keep the rows where the defect id is null.",
    ),
    build(
        UNIT, 4, pattern="three-table-join", difficulty=3, topics=["inner join", "group by", "sum"],
        task="How many defective pieces does each part have? Show the part name and the total defect quantity.",
        reference=("SELECT p.part_name, SUM(d.qty) FROM defects d JOIN lots l ON l.lot_id = d.lot_id "
                   "JOIN parts p ON p.part_id = l.part_id GROUP BY p.part_name;"),
        say=["from defects", "join lots using lot id", "join parts using part id", "group by part name",
             "select part name, sum of defects dot quantity"],
        hints=["Defects link to lots, and lots link to parts.", "Two joins. Lots on lot id, then parts on part id."],
        model_answer=("Join defects to lots on lot id and lots to parts on part id, group by part name, and sum the "
                      "defects quantity."),
    ),
    build(
        UNIT, 5, pattern="join-expression", difficulty=3, topics=["inner join", "group by", "sum", "expressions"],
        task="What is the material cost of everything produced on each line? Cost is quantity times unit cost.",
        reference="SELECT p.line, SUM(l.qty * p.unit_cost) FROM lots l JOIN parts p ON p.part_id = l.part_id GROUP BY p.line;",
        say=["from lots", "join parts using part id", "group by line",
             "select line, sum of open paren quantity times unit cost close paren"],
        hints=["The unit cost and the line are on the part.",
               "Multiply inside the sum. Say open paren before quantity and close paren after unit cost."],
        model_answer="Join lots to parts on part id, group by line, and sum quantity times unit cost.",
    ),
]
