# S5: subqueries, WITH, CASE WHEN
LANG = "sql"
UNIT = "S5"

LOTS_1_5 = "Lots 1 to 5 have quantities 120, 340, 90, 200 and 120."

DRILLS = [
    dict(
        id="sql-s5-predict-001", type="predict", difficulty=1, topics=["case when"],
        code="SELECT CASE WHEN 7 > 5 THEN 'high' ELSE 'low' END;",
        code_spoken="Select case when 7 is greater than 5 then the string high, else the string low, end.",
        prompt_spoken="What does this query return?",
        expected="high",
        hints_spoken=["Is 7 greater than 5?"],
        model_answer_spoken="It returns high, because 7 is greater than 5.",
    ),
    dict(
        id="sql-s5-predict-002", type="predict", difficulty=2, topics=["case when", "null"],
        code="SELECT CASE WHEN NULL THEN 'yes' ELSE 'no' END;",
        code_spoken="Select case when null then the string yes, else the string no, end.",
        prompt_spoken="What does this query return?",
        expected="no",
        hints_spoken=["A null condition is not true."],
        model_answer_spoken="It returns no. A null condition isn't true, so the else branch runs.",
    ),
    dict(
        id="sql-s5-predict-003", type="predict", difficulty=3, topics=["subquery", "avg"], dataset="factory",
        code="""
            SELECT COUNT(*) FROM lots
            WHERE lot_id <= 5
              AND qty > (SELECT AVG(qty) FROM lots WHERE lot_id <= 5);
        """,
        code_spoken=("Select the count of rows from lots where lot id is at most 5, and qty is greater than a "
                     "subquery, the average qty of lots where lot id is at most 5."),
        prompt_spoken=f"{LOTS_1_5} What does this query return?",
        expected="2",
        hints_spoken=["The average of the five is 174."],
        model_answer_spoken="It returns 2. The average is 174, and only 340 and 200 are above it.",
    ),
    dict(
        id="sql-s5-predict-004", type="predict", difficulty=2, topics=["with", "cte"], dataset="factory",
        code="""
            WITH big AS (
              SELECT lot_id FROM lots WHERE lot_id <= 5 AND qty >= 150
            )
            SELECT COUNT(*) FROM big;
        """,
        code_spoken=("With big as, select lot id from lots where lot id is at most 5 and qty is at least 150. Then "
                     "select the count of rows from big."),
        prompt_spoken=f"{LOTS_1_5} What does this query return?",
        expected="2",
        hints_spoken=["Which of the five are at least 150?"],
        model_answer_spoken="It returns 2, the lots with 340 and 200.",
    ),
    dict(
        id="sql-s5-explain-001", type="explain", difficulty=1, topics=["case when"], dataset="factory",
        code="""
            SELECT lot_id, qty,
              CASE WHEN qty >= 300 THEN 'large'
                   WHEN qty >= 150 THEN 'medium'
                   ELSE 'small' END AS size
            FROM lots;
        """,
        drive_ok=False,
        code_spoken=("Select lot id, qty, and case when qty is at least 300 then large, when qty is at least 150 then "
                     "medium, else small, end, as size, from lots."),
        prompt_spoken="What does this query do?",
        rubric=["labels every lot by quantity", "300 or more is large", "150 to 299 is medium", "anything lower is small"],
        model_answer_spoken=("It labels every lot as large, medium or small by quantity. 300 or more is large, 150 or "
                             "more is medium, and the rest are small."),
    ),
    dict(
        id="sql-s5-explain-002", type="explain", difficulty=2, topics=["subquery", "in"], dataset="factory",
        code="""
            SELECT part_name FROM parts
            WHERE part_id IN (SELECT part_id FROM lots WHERE qty > 450);
        """,
        code_spoken="Select part name from parts where part id is in a subquery, select part id from lots where qty is greater than 450.",
        prompt_spoken="What does this query do?",
        rubric=["the subquery finds parts that had a lot over 450", "the outer query lists those parts' names",
                "each part appears once"],
        model_answer_spoken="It lists the parts that have at least one lot with more than 450 units.",
    ),
    dict(
        id="sql-s5-explain-003", type="explain", difficulty=2, topics=["with", "group by"], dataset="shop",
        code="""
            WITH totals AS (
              SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id
            )
            SELECT customer_id FROM totals WHERE n >= 6;
        """,
        code_spoken=("With totals as, select customer id and the count of orders as n, grouped by customer id. Then "
                     "select customer id from totals where n is at least 6."),
        prompt_spoken="What does this query do?",
        rubric=["the with clause counts orders per customer", "the main query keeps customers with 6 or more orders",
                "returns their customer ids"],
        model_answer_spoken="It counts orders for each customer, then lists the customers with six or more orders.",
    ),
    dict(
        id="sql-s5-bug-001", type="spot_bug", difficulty=2, topics=["subquery", "in"], dataset="factory",
        code="""
            SELECT part_name
            FROM parts
            WHERE part_id = (SELECT part_id FROM lots WHERE qty > 400);
        """,
        code_spoken=("Line 1, select part name. Line 2, from parts. Line 3, where part id equals a subquery, select "
                     "part id from lots where qty is greater than 400."),
        prompt_spoken="This should list every part with a lot over 400. Which line has the bug, and what's the fix?",
        bug=dict(line=3, fix_spoken="On line 3, use in instead of equals. The subquery returns many part ids.",
                 fixed_code="""
                    SELECT part_name
                    FROM parts
                    WHERE part_id IN (SELECT part_id FROM lots WHERE qty > 400);
                 """),
        rubric=["names line 3", "the subquery returns many rows but equals compares with just one",
                "use in"],
        hints_spoken=["How many rows does the subquery return?"],
        model_answer_spoken="Line 3. The subquery returns many part ids, but equals only uses one. Use in.",
    ),
    dict(
        id="sql-s5-bug-002", type="spot_bug", difficulty=2, topics=["case when", "branch order"], dataset="factory",
        code="""
            SELECT lot_id,
              CASE WHEN qty > 100 THEN 'ok' WHEN qty > 300 THEN 'large' END AS label
            FROM lots;
        """,
        code_spoken=("Line 1, select lot id. Line 2, case when qty is greater than 100 then ok, when qty is greater "
                     "than 300 then large, end, as label. Line 3, from lots."),
        prompt_spoken=("Lots over 300 should be labeled large, and other lots over 100 should be labeled ok. Which line "
                       "has the bug, and what's the fix?"),
        bug=dict(line=2, fix_spoken="On line 2, check greater than 300 first. Case stops at the first true branch.",
                 fixed_code="""
                    SELECT lot_id,
                      CASE WHEN qty > 300 THEN 'large' WHEN qty > 100 THEN 'ok' END AS label
                    FROM lots;
                 """),
        rubric=["names line 2", "case stops at the first true branch", "big lots match over 100 first, so large never appears",
                "put the over 300 branch first"],
        hints_spoken=["A lot of 400 is also greater than 100."],
        model_answer_spoken="Line 2. Case stops at the first true branch, so large lots get ok. Check over 300 first.",
    ),
    dict(
        id="sql-s5-concept-001", type="concept", difficulty=2, topics=["with", "subqueries"],
        prompt_spoken="When would you use a with clause, a common table expression, instead of a subquery?",
        rubric=["it names an intermediate result", "the query reads top to bottom", "it helps when the result is used more than once"],
        model_answer_spoken=("Use a with clause to name an intermediate result so the query reads top to bottom, or when "
                             "you need the same result more than once. A subquery is fine for a small one-off filter."),
    ),
    dict(
        id="sql-s5-plan-001", type="plan", difficulty=3, topics=["case when", "exists"],
        prompt_spoken=("Plan this out loud. For each customer, show their name and whether they've ever had a cancelled "
                       "order, as yes or no."),
        rubric=["select name from customers", "case when exists a cancelled order for that customer",
                "then yes, else no", "or left join the cancelled orders and check for null"],
        model_answer_spoken=("Select name from customers, plus a case when exists a cancelled order for that customer, "
                             "then yes, else no. Or left join to cancelled orders and check for null."),
    ),
]
