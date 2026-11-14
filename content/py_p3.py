# P3: conditionals and loops
LANG = "python"
UNIT = "P3"

DRILLS = [
    dict(
        id="py-p3-predict-001", type="predict", difficulty=1, topics=["if", "modulo"],
        code="""
            x = 7
            if x % 2 == 0:
                print("even")
            print("end")
        """,
        code_spoken=("x equals 7. If x mod 2 is equal to 0, inside the if, print the string even. After the if, "
                     "print the string end."),
        prompt_spoken="What does this print?",
        expected="end",
        accept=["just end", "only end"],
        hints_spoken=["What is 7 mod 2?"],
        model_answer_spoken="It prints only end. 7 mod 2 is 1, so the if body is skipped.",
    ),
    dict(
        id="py-p3-predict-002", type="predict", difficulty=1, topics=["for loop", "accumulator"],
        code="""
            total = 0
            for n in [1, 2, 3, 4]:
                total += n
            print(total)
        """,
        code_spoken=("total equals 0. For each n in the list 1, 2, 3, 4, inside the loop, add n to total. After the "
                     "loop, print total."),
        prompt_spoken="What does this print?",
        expected="10",
        hints_spoken=["Add the four numbers."],
        model_answer_spoken="It prints 10, the sum of 1 through 4.",
    ),
    dict(
        id="py-p3-predict-003", type="predict", difficulty=1, topics=["range"],
        code="""
            for i in range(3):
                print(i)
        """,
        code_spoken="For each i in range of 3, inside the loop, print i.",
        prompt_spoken="What does this print?",
        expected="0\n1\n2",
        accept=["zero one two", "0 to 2"],
        hints_spoken=["range of 3 starts at 0 and stops before 3."],
        model_answer_spoken="It prints 0, 1 and 2 on separate lines. Range of 3 stops before 3.",
    ),
    dict(
        id="py-p3-predict-004", type="predict", difficulty=2, topics=["while loop"],
        code="""
            n = 0
            while n < 10:
                n += 4
            print(n)
        """,
        code_spoken="n equals 0. While n is less than 10, inside the loop, add 4 to n. After the loop, print n.",
        prompt_spoken="What does this print?",
        expected="12",
        hints_spoken=["Track n. It goes 4, then 8, then what?"],
        model_answer_spoken="It prints 12. n goes 4, 8, then 12, and 12 is not less than 10, so the loop stops.",
    ),
    dict(
        id="py-p3-predict-005", type="predict", difficulty=2, topics=["break", "strings"],
        code="""
            for c in "abc":
                if c == "b":
                    break
                print(c)
        """,
        code_spoken=("For each c in the string abc. Inside the loop, if c is equal to the string b, break. Then, still "
                     "inside the loop, print c."),
        prompt_spoken="What does this print?",
        expected="a",
        accept=["just a", "only a", "the letter a"],
        hints_spoken=["break ends the whole loop."],
        model_answer_spoken="It prints only a. When c reaches b the loop breaks before printing.",
    ),
    dict(
        id="py-p3-predict-006", type="predict", difficulty=2, topics=["continue", "range"],
        code="""
            for i in range(5):
                if i % 2 == 1:
                    continue
                print(i)
        """,
        code_spoken=("For each i in range of 5. Inside the loop, if i mod 2 is equal to 1, continue. Then, still "
                     "inside the loop, print i."),
        prompt_spoken="What does this print?",
        expected="0\n2\n4",
        accept=["zero two four", "the even numbers 0 2 4"],
        hints_spoken=["continue skips the print for odd numbers."],
        model_answer_spoken="It prints 0, 2 and 4. Odd numbers hit continue and skip the print.",
    ),
    dict(
        id="py-p3-explain-001", type="explain", difficulty=1, topics=["counting", "if"],
        code="""
            count = 0
            for q in [120, 340, 90, 200]:
                if q >= 150:
                    count += 1
        """,
        code_spoken=("count equals 0. For each q in the list 120, 340, 90, 200, inside the loop, if q is at least 150, "
                     "add 1 to count."),
        prompt_spoken="What does this code do?",
        rubric=["loops over the quantities", "counts the ones that are at least 150", "count ends at 2"],
        model_answer_spoken="It counts how many quantities are at least 150. Here that's 2.",
    ),
    dict(
        id="py-p3-explain-002", type="explain", difficulty=2, topics=["elif", "classification"],
        code="""
            def grade(score):
                if score >= 90:
                    return "A"
                elif score >= 80:
                    return "B"
                return "C"
        """,
        drive_ok=False,
        code_spoken=("Define grade of score. If score is at least 90, return the string A. Else if score is at least "
                     "80, return the string B. Otherwise return the string C."),
        prompt_spoken="What does this function do?",
        rubric=["turns a score into a letter", "90 and up is A, 80 to 89 is B", "anything lower is C"],
        model_answer_spoken="It turns a score into a letter grade. 90 or more is A, 80 or more is B, and anything lower is C.",
    ),
    dict(
        id="py-p3-bug-001", type="spot_bug", difficulty=1, topics=["range", "off by one"],
        code="""
            nums = [3, 8, 5]
            for i in range(len(nums) + 1):
                print(nums[i])
        """,
        code_spoken=("Line 1, nums equals the list 3, 8, 5. Line 2, for each i in range of len of nums plus 1. Line 3, "
                     "inside the loop, print nums at index i."),
        prompt_spoken="This should print each number once. Which line has the bug, and what's the fix?",
        expected="3\n8\n5",
        bug=dict(line=2, fix_spoken="On line 2, use range of len of nums with no plus 1, or loop over nums directly.",
                 fixed_code="""
                    nums = [3, 8, 5]
                    for i in range(len(nums)):
                        print(nums[i])
                 """),
        rubric=["names line 2", "plus 1 makes i reach 3, which is out of range", "use range of len of nums"],
        hints_spoken=["What is the last value of i?"],
        model_answer_spoken="Line 2. Plus 1 makes i reach 3, which raises an index error. Use range of len of nums.",
    ),
    dict(
        id="py-p3-bug-002", type="spot_bug", difficulty=1, topics=["accumulator"],
        code="""
            total = 0
            for n in [1, 2, 3]:
                total = n
            print(total)
        """,
        code_spoken=("Line 1, total equals 0. Line 2, for each n in the list 1, 2, 3. Line 3, inside the loop, total "
                     "equals n. Line 4, after the loop, print total."),
        prompt_spoken="This should print the sum, 6. Which line has the bug, and what's the fix?",
        expected="6",
        bug=dict(line=3, fix_spoken="On line 3, add n to total with plus equals instead of replacing it.",
                 fixed_code="""
                    total = 0
                    for n in [1, 2, 3]:
                        total += n
                    print(total)
                 """),
        rubric=["names line 3", "it overwrites total instead of adding", "use plus equals"],
        hints_spoken=["What is total after each pass?"],
        model_answer_spoken="Line 3. It replaces total each time, so it ends at 3. Add n to total with plus equals.",
    ),
    dict(
        id="py-p3-concept-001", type="concept", difficulty=1, topics=["break", "continue"],
        prompt_spoken="What's the difference between break and continue in a loop?",
        rubric=["break exits the loop completely", "continue skips the rest of this pass and goes to the next item"],
        model_answer_spoken=("Break ends the loop completely. Continue skips the rest of the current pass and moves on "
                             "to the next item."),
    ),
    dict(
        id="py-p3-plan-001", type="plan", difficulty=2, topics=["loops", "counting"],
        prompt_spoken=("Plan this out loud. Given a list of defect counts, print the word alert for every count above "
                       "10, and at the end print how many alerts there were."),
        rubric=["a counter starting at zero", "a loop with an if for counts above 10", "print alert and add one inside the if",
                "print the counter after the loop"],
        model_answer_spoken=("Start a counter at zero. Loop over the counts. When a count is above 10, print alert and "
                             "add 1 to the counter. After the loop, print the counter."),
    ),
]

# ---------- ladders ----------
from _ladder import ladder  # noqa: E402

DRILLS += ladder(
    "python", UNIT, 5, topics=["loops", "counting"], difficulty=1, sketch_drive_ok=True,
    task=("Write a function, count above, that takes a list of numbers and a limit, and returns how many numbers "
          "are greater than the limit."),
    plan_rubric=["a counter starting at zero", "loop over the numbers", "add one when a number is greater than the limit",
                 "return the counter"],
    plan_model="Start a count at zero. Loop over the numbers, add one whenever a number is greater than the limit, then return the count.",
    signature="def count_above(nums, limit):",
    function_name="count_above",
    reference="""
        def count_above(nums, limit):
            count = 0
            for n in nums:
                if n > limit:
                    count += 1
            return count
    """,
    tests=[dict(args=[[1, 5, 8, 10], 5], expected=2), dict(args=[[], 3], expected=0),
           dict(args=[[3, 3, 4], 3], expected=1)],
    vocab=["count_above", "nums", "limit", "count"],
    hints=["Start a counter at zero.", "Greater than, not greater than or equal."],
    model_answer=("Define count above of nums and limit. count equals 0. For each n in nums, if n is greater than "
                  "limit, add 1 to count. Return count."),
)
DRILLS += ladder(
    "python", UNIT, 6, topics=["if", "elif"], difficulty=1, sketch_drive_ok=True,
    task=("Write a function, size label, that takes a quantity and returns small if it's under 100, medium if "
          "it's under 300, and large otherwise."),
    plan_rubric=["check under 100 first, return small", "then under 300, return medium", "otherwise return large"],
    plan_model="If the quantity is under 100 return small. Else if it's under 300 return medium. Otherwise return large.",
    signature="def size_label(qty):",
    function_name="size_label",
    reference="""
        def size_label(qty):
            if qty < 100:
                return "small"
            elif qty < 300:
                return "medium"
            return "large"
    """,
    tests=[dict(args=[50], expected="small"), dict(args=[100], expected="medium"), dict(args=[299], expected="medium"),
           dict(args=[300], expected="large")],
    vocab=["size_label", "qty"],
    hints=["Check the smallest range first.", "Use if, elif, and a final return."],
    model_answer=("Define size label of qty. If qty is less than 100, return small. Else if qty is less than 300, "
                  "return medium. Otherwise return large."),
)
# Section 9 worked example 1, as a ladder, so it can be dictated and run in Parked.
DRILLS += ladder(
    "python", UNIT, 13, topics=["loops", "if", "modulo"], difficulty=1, sketch_drive_ok=True,
    task="Write a function, sum evens, that takes a list of numbers and returns the sum of the even numbers.",
    plan_rubric=["a total starting at zero", "loop over the numbers", "add a number when n mod 2 is equal to 0",
                 "return the total"],
    plan_model="Start a total at zero. Loop over the numbers, add each one where n mod 2 is equal to 0, then return the total.",
    signature="def sum_evens(nums):",
    function_name="sum_evens",
    reference="""
        def sum_evens(nums):
            total = 0
            for n in nums:
                if n % 2 == 0:
                    total += n
            return total
    """,
    tests=[dict(args=[[1, 2, 3, 4]], expected=6), dict(args=[[]], expected=0), dict(args=[[1, 3, 5]], expected=0),
           dict(args=[[-2, 3, 10]], expected=8)],
    vocab=["sum_evens", "nums", "total"],
    hints=["A number is even when n mod 2 is equal to 0.", "Start a total at zero and add to it inside the if."],
    model_answer=("Define sum evens of nums. total equals 0. For each n in nums, if n mod 2 is equal to 0, add n to "
                  "total. Return total."),
)
