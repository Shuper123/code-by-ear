# S2: NULL, DISTINCT, LIKE, IN, BETWEEN, dates
LANG = "sql"
UNIT = "S2"

DRILLS = [
    dict(
        id="sql-s2-predict-001", type="predict", difficulty=2, topics=["null"],
        code="SELECT NULL = NULL;",
        code_spoken="Select null is equal to null.",
        prompt_spoken="What does this query return?",
        expected="NULL",
        accept=["none", "unknown"],
        hints_spoken=["Null means unknown. Is unknown equal to unknown?"],
        model_answer_spoken="It returns null, not true. Comparing anything with null gives null.",
    ),
    dict(
        id="sql-s2-predict-002", type="predict", difficulty=2, topics=["null", "where"], dataset="factory",
        code="SELECT COUNT(*) FROM lots WHERE shift = NULL;",
        code_spoken="Select the count of rows from lots where shift equals null.",
        prompt_spoken="Six lots have no shift recorded. What does this query return?",
        expected="0",
        hints_spoken=["Equals null is never true."],
        model_answer_spoken="It returns 0. Equals null is never true. You need is null to find them.",
    ),
    dict(
        id="sql-s2-predict-003", type="predict", difficulty=1, topics=["coalesce", "null"],
        code="SELECT COALESCE(NULL, 'unknown');",
        code_spoken="Select coalesce of null and the string unknown.",
        prompt_spoken="What does this query return?",
        expected="unknown",
        hints_spoken=["Coalesce returns the first value that isn't null."],
        model_answer_spoken="It returns unknown, the first value that isn't null.",
    ),
    dict(
        id="sql-s2-predict-004", type="predict", difficulty=1, topics=["like"],
        code="SELECT 'gasket' LIKE 'g%';",
        code_spoken="Select the string gasket like the pattern g percent.",
        prompt_spoken="What does this query return?",
        expected="1",
        accept=["true", "yes", "it matches"],
        hints_spoken=["Percent matches any run of characters."],
        model_answer_spoken="It returns 1, meaning true. The pattern g percent matches anything that starts with g.",
    ),
    dict(
        id="sql-s2-predict-005", type="predict", difficulty=1, topics=["in"], dataset="factory",
        code="SELECT COUNT(*) FROM parts WHERE line IN ('A', 'C');",
        code_spoken="Select the count of rows from parts where line is in A or C.",
        prompt_spoken="Lines A, B and C each have 4 parts. What does this query return?",
        expected="8",
        hints_spoken=["In matches either value."],
        model_answer_spoken="It returns 8, the 4 parts on line A plus the 4 on line C.",
    ),
    dict(
        id="sql-s2-predict-006", type="predict", difficulty=2, topics=["distinct"], dataset="factory",
        code="SELECT COUNT(DISTINCT part_id) FROM lots WHERE lot_id <= 5;",
        code_spoken="Select the count of distinct part id from lots where lot id is at most 5.",
        prompt_spoken="Lots 1 to 5 are for parts 1, 2, 5, 9 and 1. What does this query return?",
        expected="4",
        hints_spoken=["Part 1 appears twice."],
        model_answer_spoken="It returns 4. Part 1 appears twice, so there are four different parts.",
    ),
    dict(
        id="sql-s2-predict-007", type="predict", difficulty=1, topics=["between"], dataset="factory",
        code="SELECT COUNT(*) FROM lots WHERE lot_id BETWEEN 3 AND 5;",
        code_spoken="Select the count of rows from lots where lot id is between 3 and 5.",
        prompt_spoken="Lot ids run from 1 to 120 with no gaps. What does this query return?",
        expected="3",
        hints_spoken=["Between includes both ends."],
        model_answer_spoken="It returns 3, lots 3, 4 and 5. Between includes both ends.",
    ),
    dict(
        id="sql-s2-explain-001", type="explain", difficulty=1, topics=["distinct", "dates", "between"], dataset="factory",
        code="""
            SELECT DISTINCT part_id
            FROM lots
            WHERE produced_on BETWEEN '2026-02-01' AND '2026-02-28';
        """,
        code_spoken=("Select distinct part id from lots where produced on is between February 1st and February 28th, "
                     "2026."),
        prompt_spoken="What does this query do?",
        rubric=["parts that had at least one lot in February 2026", "each part listed once", "between includes both dates"],
        model_answer_spoken="It lists each part that had at least one lot produced in February 2026, without repeats.",
    ),
    dict(
        id="sql-s2-explain-002", type="explain", difficulty=1, topics=["in", "like"], dataset="shop",
        code="""
            SELECT name
            FROM customers
            WHERE city IN ('Riverton', 'Oakdale')
              AND name LIKE 'A%';
        """,
        code_spoken=("Select name from customers where city is in Riverton or Oakdale, and name is like the pattern A "
                     "percent."),
        prompt_spoken="What does this query do?",
        rubric=["customers in Riverton or Oakdale", "whose names start with A", "returns their names"],
        model_answer_spoken="It finds the customers in Riverton or Oakdale whose names start with A.",
    ),
    dict(
        id="sql-s2-bug-001", type="spot_bug", difficulty=1, topics=["null"], dataset="factory",
        code="""
            SELECT lot_id
            FROM lots
            WHERE shift = NULL;
        """,
        code_spoken="Line 1, select lot id. Line 2, from lots. Line 3, where shift equals null.",
        prompt_spoken="This should list the lots with no shift. Which line has the bug, and what's the fix?",
        bug=dict(line=3, fix_spoken="On line 3, write where shift is null instead of equals null.",
                 fixed_code="""
                    SELECT lot_id
                    FROM lots
                    WHERE shift IS NULL;
                 """),
        rubric=["names line 3", "equals null is never true, so it returns no rows", "use is null"],
        hints_spoken=["How do you test for a missing value?"],
        model_answer_spoken="Line 3. Equals null is never true, so it returns nothing. Use is null.",
    ),
    dict(
        id="sql-s2-bug-002", type="spot_bug", difficulty=2, topics=["distinct"], dataset="factory",
        code="""
            SELECT DISTINCT part_id, qty
            FROM lots;
        """,
        code_spoken="Line 1, select distinct part id and qty. Line 2, from lots.",
        prompt_spoken="This should list each part id once. Which line has the bug, and what's the fix?",
        bug=dict(line=1, fix_spoken="On line 1, select only part id. Distinct applies to the whole row.",
                 fixed_code="""
                    SELECT DISTINCT part_id
                    FROM lots;
                 """),
        rubric=["names line 1", "distinct applies to the whole row, so each part repeats with different quantities",
                "select only part id"],
        hints_spoken=["What does distinct look at, one column or the whole row?"],
        model_answer_spoken=("Line 1. Distinct works on the whole row, so a part shows up once per different quantity. "
                             "Select only part id."),
    ),
    dict(
        id="sql-s2-concept-001", type="concept", difficulty=1, topics=["null"],
        prompt_spoken="What's the difference between where shift equals null and where shift is null?",
        rubric=["equals null is never true because null means unknown", "so it matches nothing",
                "is null is the right test for missing values"],
        model_answer_spoken=("Equals null is never true, because null means unknown, so it matches nothing. Is null is "
                             "the correct test for missing values."),
    ),
    dict(
        id="sql-s2-plan-001", type="plan", difficulty=2, topics=["like", "dates"],
        prompt_spoken=("Plan this out loud. List every customer whose name starts with B and who signed up in March "
                       "2026."),
        rubric=["from customers", "name like B percent", "signup date between March 1st and March 31st, 2026",
                "combine the two conditions with and"],
        model_answer_spoken=("Select from customers where name is like B percent, and signup date is between March 1st "
                             "and March 31st, 2026."),
    ),
]
