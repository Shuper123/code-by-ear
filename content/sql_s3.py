# S3: COUNT, SUM, AVG, MIN, MAX, GROUP BY, HAVING
LANG = "sql"
UNIT = "S3"

LOTS_1_5 = "Lots 1 to 5 have quantities 120, 340, 90, 200 and 120."

DRILLS = [
    dict(
        id="sql-s3-predict-001", type="predict", difficulty=2, topics=["count", "null"], dataset="factory",
        code="SELECT COUNT(shift) FROM lots;",
        code_spoken="Select count of shift from lots.",
        prompt_spoken="The lots table has 120 rows, and 6 of them have a null shift. What does this query return?",
        expected="114",
        hints_spoken=["Counting a column skips nulls."],
        model_answer_spoken="It returns 114. Count of a column skips the 6 nulls.",
    ),
    dict(
        id="sql-s3-predict-002", type="predict", difficulty=1, topics=["sum"], dataset="factory",
        code="SELECT SUM(qty) FROM lots WHERE lot_id <= 5;",
        code_spoken="Select the sum of qty from lots where lot id is at most 5.",
        prompt_spoken=f"{LOTS_1_5} What does this query return?",
        expected="870",
        hints_spoken=["Add the five quantities."],
        model_answer_spoken="It returns 870, the five quantities added up.",
    ),
    dict(
        id="sql-s3-predict-003", type="predict", difficulty=1, topics=["avg"], dataset="factory",
        code="SELECT AVG(qty) FROM lots WHERE lot_id IN (1, 3);",
        code_spoken="Select the average qty from lots where lot id is in 1 or 3.",
        prompt_spoken="Lot 1 has quantity 120 and lot 3 has 90. What does this query return?",
        expected="105.0",
        hints_spoken=["Add the two and divide by 2."],
        model_answer_spoken="It returns 105, the average of 120 and 90.",
    ),
    dict(
        id="sql-s3-predict-004", type="predict", difficulty=2, topics=["max", "min"], dataset="factory",
        code="SELECT MAX(qty) - MIN(qty) FROM lots WHERE lot_id <= 5;",
        code_spoken="Select the max of qty minus the min of qty, from lots where lot id is at most 5.",
        prompt_spoken=f"{LOTS_1_5} What does this query return?",
        expected="250",
        hints_spoken=["Largest is 340, smallest is 90."],
        model_answer_spoken="It returns 250, the largest quantity 340 minus the smallest 90.",
    ),
    dict(
        id="sql-s3-predict-005", type="predict", difficulty=2, topics=["group by"], dataset="factory",
        answer_kind="row_count",
        code="SELECT machine_id, COUNT(*) FROM lots GROUP BY machine_id;",
        code_spoken="Select machine id and the count of rows from lots, grouped by machine id.",
        prompt_spoken="There are 6 machines, but machine 6 has never made a lot. How many rows does this return?",
        expected="5",
        hints_spoken=["Group by makes one row per value that appears in lots."],
        model_answer_spoken="It returns 5 rows, one per machine that appears in lots. Machine 6 has no lots, so it's missing.",
    ),
    dict(
        id="sql-s3-predict-006", type="predict", difficulty=2, topics=["having"], dataset="factory",
        code="""
            SELECT part_id FROM lots
            WHERE lot_id <= 5
            GROUP BY part_id
            HAVING COUNT(*) > 1;
        """,
        code_spoken=("Select part id from lots where lot id is at most 5, grouped by part id, having a count greater "
                     "than 1."),
        prompt_spoken="Lots 1 to 5 are for parts 1, 2, 5, 9 and 1. What does this query return?",
        expected="1",
        hints_spoken=["Which part appears more than once?"],
        model_answer_spoken="It returns part 1, the only part with more than one of those lots.",
    ),
    dict(
        id="sql-s3-explain-001", type="explain", difficulty=1, topics=["group by", "sum", "order by"], dataset="factory",
        code="""
            SELECT part_id, SUM(qty) AS total
            FROM lots
            GROUP BY part_id
            ORDER BY total DESC;
        """,
        code_spoken="Select part id and the sum of qty as total from lots, grouped by part id, order by total descending.",
        prompt_spoken="What does this query do?",
        rubric=["totals the quantity produced for each part", "one row per part", "highest total first"],
        model_answer_spoken="It totals the quantity produced for each part and lists the parts from the highest total down.",
    ),
    dict(
        id="sql-s3-explain-002", type="explain", difficulty=2, topics=["group by", "having"], dataset="factory",
        code="""
            SELECT defect_code, COUNT(*)
            FROM defects
            GROUP BY defect_code
            HAVING COUNT(*) >= 20;
        """,
        code_spoken=("Select defect code and the count of rows from defects, grouped by defect code, having a count of "
                     "at least 20."),
        prompt_spoken="What does this query do?",
        rubric=["counts defect records for each defect code", "keeps only codes with at least 20 records",
                "having filters after grouping"],
        model_answer_spoken="It counts defect records for each defect code and keeps only the codes with at least 20.",
    ),
    dict(
        id="sql-s3-bug-001", type="spot_bug", difficulty=1, topics=["group by"], dataset="factory",
        code="""
            SELECT part_id, SUM(qty)
            FROM lots;
        """,
        code_spoken="Line 1, select part id and the sum of qty. Line 2, from lots.",
        prompt_spoken="This should give the total quantity for each part. Which line has the bug, and what's the fix?",
        bug=dict(line=2, fix_spoken="After line 2, add group by part id. Without it, every lot is added into one row.",
                 fixed_code="""
                    SELECT part_id, SUM(qty)
                    FROM lots
                    GROUP BY part_id;
                 """),
        rubric=["the group by part id is missing", "without it SQL sums every lot into one row", "add group by part id"],
        hints_spoken=["How many rows does a sum with no group by return?"],
        model_answer_spoken="The group by is missing after line 2, so SQL adds every lot into a single row. Add group by part id.",
    ),
    dict(
        id="sql-s3-bug-002", type="spot_bug", difficulty=2, topics=["having", "where"], dataset="factory",
        code="""
            SELECT machine_id, COUNT(*)
            FROM lots
            WHERE COUNT(*) > 20
            GROUP BY machine_id;
        """,
        code_spoken=("Line 1, select machine id and the count of rows. Line 2, from lots. Line 3, where the count is "
                     "greater than 20. Line 4, group by machine id."),
        prompt_spoken="This should list machines with more than 20 lots. Which line has the bug, and what's the fix?",
        bug=dict(line=3, fix_spoken="On line 3, move the count condition to a having clause after the group by.",
                 fixed_code="""
                    SELECT machine_id, COUNT(*)
                    FROM lots
                    GROUP BY machine_id
                    HAVING COUNT(*) > 20;
                 """),
        rubric=["names line 3", "where runs before grouping, so it can't use count", "use having after group by"],
        hints_spoken=["Where runs before the groups exist."],
        model_answer_spoken="Line 3. Where runs before grouping and can't use count. Put the condition in a having clause.",
    ),
    dict(
        id="sql-s3-concept-001", type="concept", difficulty=1, topics=["where", "having"],
        prompt_spoken="What's the difference between where and having?",
        rubric=["where filters rows before grouping", "having filters groups after aggregates are computed",
                "having can use count or sum"],
        model_answer_spoken=("Where filters individual rows before grouping. Having filters groups after the aggregates "
                             "are computed, so it can use count or sum."),
    ),
    dict(
        id="sql-s3-plan-001", type="plan", difficulty=1, topics=["group by", "null"],
        prompt_spoken="Plan this out loud. Find how many lots each shift produced, leaving out lots with no shift.",
        rubric=["select shift and a count from lots", "where shift is not null", "group by shift"],
        model_answer_spoken="Select shift and the count of rows from lots, where shift is not null, grouped by shift.",
    ),
]
