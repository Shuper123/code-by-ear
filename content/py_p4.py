# P4: functions and return values
LANG = "python"
UNIT = "P4"

DRILLS = [
    dict(
        id="py-p4-predict-001", type="predict", difficulty=1, topics=["functions", "return"],
        code="""
            def double(x):
                return x * 2
            print(double(6))
        """,
        code_spoken="Define double of x, which returns x times 2. Then print double of 6.",
        prompt_spoken="What does this print?",
        expected="12",
        hints_spoken=["double returns its input times 2."],
        model_answer_spoken="It prints 12.",
    ),
    dict(
        id="py-p4-predict-002", type="predict", difficulty=2, topics=["None", "print vs return"],
        code="""
            def greet(name):
                print("Hi " + name)
            result = greet("Ana")
            print(result)
        """,
        code_spoken=("Define greet of name, which prints the string Hi plus name. Then result equals greet of the "
                     "string Ana. Then print result."),
        prompt_spoken="What does this print?",
        expected="Hi Ana\nNone",
        accept=["hi ana and then none", "hi ana then none"],
        hints_spoken=["greet prints, but what does it return?"],
        model_answer_spoken="It prints Hi Ana, then None. greet prints but returns nothing, so result is None.",
    ),
    dict(
        id="py-p4-predict-003", type="predict", difficulty=1, topics=["default arguments"],
        code="""
            def area(w, h=2):
                return w * h
            print(area(5))
        """,
        code_spoken=("Define area of w, and h with a default of 2, which returns w times h. Then print area of 5."),
        prompt_spoken="What does this print?",
        expected="10",
        hints_spoken=["Only w is passed, so h uses its default."],
        model_answer_spoken="It prints 10. h uses its default of 2.",
    ),
    dict(
        id="py-p4-predict-004", type="predict", difficulty=1, topics=["conditional expression"],
        code="""
            def check(n):
                return "high" if n > 3 else "low"
            print(check(3))
        """,
        code_spoken=("Define check of n, which returns the string high if n is greater than 3, else the string low. "
                     "Then print check of 3."),
        prompt_spoken="What does this print?",
        expected="low",
        hints_spoken=["Is 3 greater than 3?"],
        model_answer_spoken="It prints low, because 3 is not greater than 3.",
    ),
    dict(
        id="py-p4-predict-005", type="predict", difficulty=2, topics=["scope", "local variables"], drive_ok=False,
        code="""
            x = 5
            def change():
                x = 9
            change()
            print(x)
        """,
        code_spoken=("x equals 5. Define change, with no parameters, which sets x equals 9 inside the function. Then "
                     "call change. Then print x."),
        prompt_spoken="What does this print?",
        expected="5",
        hints_spoken=["The x inside the function is a new local variable."],
        model_answer_spoken="It prints 5. The x inside change is a separate local variable, so the outer x is untouched.",
    ),
    dict(
        id="py-p4-predict-006", type="predict", difficulty=2, topics=["return", "early exit"],
        code="""
            def first_even(nums):
                for n in nums:
                    if n % 2 == 0:
                        return n
            print(first_even([3, 5, 8, 10]))
        """,
        drive_ok=False,
        code_spoken=("Define first even of nums. For each n in nums, if n mod 2 is equal to 0, return n. Then print "
                     "first even of the list 3, 5, 8, 10."),
        prompt_spoken="What does this print?",
        expected="8",
        hints_spoken=["return leaves the function at the first match."],
        model_answer_spoken="It prints 8, the first even number. The return stops the loop right there.",
    ),
    dict(
        id="py-p4-explain-001", type="explain", difficulty=1, topics=["functions", "guard clause"],
        code="""
            def scrap_rate(defects, produced):
                if produced == 0:
                    return 0
                return defects / produced
        """,
        code_spoken=("Define scrap rate of defects and produced. Inside, if produced is equal to 0, return 0. "
                     "Otherwise return defects divided by produced."),
        prompt_spoken="What does this function do?",
        rubric=["returns defects divided by produced, the scrap rate", "returns 0 when nothing was produced",
                "the guard avoids dividing by zero"],
        model_answer_spoken=("It returns the scrap rate, defects divided by units produced, and returns 0 when nothing was "
                             "produced so it never divides by zero."),
    ),
    dict(
        id="py-p4-explain-002", type="explain", difficulty=1, topics=["split", "strings"],
        code="""
            def first_word(s):
                return s.split()[0]
            print(first_word("bracket lot seven"))
        """,
        code_spoken=("Define first word of s, which returns s dot split, at index 0. Then print first word of the "
                     "string bracket lot seven."),
        prompt_spoken="What does this code do?",
        rubric=["splits the string into words on spaces", "returns the first word", "prints bracket"],
        model_answer_spoken="It splits a string into words and returns the first one, so it prints bracket.",
    ),
    dict(
        id="py-p4-bug-001", type="spot_bug", difficulty=1, topics=["return", "None"],
        code="""
            def total_cost(qty, unit):
                cost = qty * unit
            print(total_cost(4, 3))
        """,
        code_spoken=("Line 1, define total cost of qty and unit. Line 2, inside, cost equals qty times unit. Line 3, "
                     "print total cost of 4 and 3."),
        prompt_spoken="This should print 12. Which line has the bug, and what's the fix?",
        expected="12",
        bug=dict(line=2, fix_spoken="After line 2, add return cost. Without a return the function gives back None.",
                 fixed_code="""
                    def total_cost(qty, unit):
                        cost = qty * unit
                        return cost
                    print(total_cost(4, 3))
                 """),
        rubric=["the function never returns cost", "it prints None", "add return cost after line 2"],
        hints_spoken=["What does a function return when it has no return statement?"],
        model_answer_spoken="Line 2. The function computes cost but never returns it, so it prints None. Add return cost.",
    ),
    dict(
        id="py-p4-bug-002", type="spot_bug", difficulty=2, topics=["empty input", "ZeroDivisionError"],
        code="""
            def average(nums):
                return sum(nums) / len(nums)
            print(average([]))
        """,
        code_spoken=("Line 1, define average of nums. Line 2, inside, return sum of nums divided by len of nums. "
                     "Line 3, print average of an empty list."),
        prompt_spoken="This should print 0 for an empty list. Which line has the bug, and what's the fix?",
        expected="0",
        bug=dict(line=2, fix_spoken="Before the return on line 2, check if nums is empty and return 0.",
                 fixed_code="""
                    def average(nums):
                        if not nums:
                            return 0
                        return sum(nums) / len(nums)
                    print(average([]))
                 """),
        rubric=["dividing by len of an empty list raises a zero division error", "guard for an empty list",
                "return 0 when nums is empty"],
        hints_spoken=["What is len of an empty list?"],
        model_answer_spoken=("Line 2. With an empty list it divides by zero. Check if nums is empty first and return 0."),
    ),
    dict(
        id="py-p4-concept-001", type="concept", difficulty=1, topics=["print vs return"],
        prompt_spoken="What's the difference between printing a value inside a function and returning it?",
        rubric=["print only shows the value", "return hands the value back to the caller", "with no return the caller gets None"],
        model_answer_spoken=("Printing shows the value on screen, but the caller gets None. Returning hands the value back "
                             "so the caller can store or use it."),
    ),
    dict(
        id="py-p4-plan-001", type="plan", difficulty=2, topics=["functions", "loops"],
        prompt_spoken=("Plan this out loud. Write a function that takes a list of quantities and a threshold, and "
                       "returns how many quantities are above the threshold."),
        rubric=["a function with two parameters, the list and the threshold", "a counter starting at zero",
                "a loop that adds one when a quantity is above the threshold", "return the count"],
        model_answer_spoken=("Define a function with the list and the threshold as parameters. Start a count at zero. "
                             "Loop over the quantities and add one when a quantity is above the threshold. Return the count."),
    ),
]
