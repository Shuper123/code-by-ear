# P6: comprehensions, common built-ins, try and except
LANG = "python"
UNIT = "P6"

DRILLS = [
    dict(
        id="py-p6-predict-001", type="predict", difficulty=2, topics=["list comprehension", "filter"],
        code="""
            nums = [1, 2, 3, 4]
            print([n * n for n in nums if n % 2 == 0])
        """,
        code_spoken=("nums equals the list 1, 2, 3, 4. Then print a list comprehension of n times n, for each n in nums, "
                     "if n mod 2 is equal to 0."),
        prompt_spoken="What does this print?",
        expected="[4, 16]",
        hints_spoken=["Only the even numbers get squared."],
        model_answer_spoken="It prints the list 4, 16, the squares of the even numbers.",
    ),
    dict(
        id="py-p6-predict-002", type="predict", difficulty=2, topics=["max", "key functions"],
        code="""
            words = ["cap", "bushing", "pin"]
            print(max(words, key=len))
        """,
        code_spoken="words equals the list of strings cap, bushing, pin. Then print max of words, with key equals len.",
        prompt_spoken="What does this print?",
        expected="bushing",
        hints_spoken=["key equals len compares the words by length."],
        model_answer_spoken="It prints bushing, the longest word.",
    ),
    dict(
        id="py-p6-predict-003", type="predict", difficulty=2, topics=["zip"],
        code="""
            print(list(zip([1, 2], ["a", "b"])))
        """,
        code_spoken="Print list of zip of the list 1, 2 and the list of strings a, b.",
        prompt_spoken="What does this print?",
        expected="[(1, 'a'), (2, 'b')]",
        accept=["1 a 2 b", "pairs 1 a and 2 b"],
        hints_spoken=["zip pairs items by position."],
        model_answer_spoken="It prints a list of pairs, 1 with a, and 2 with b.",
    ),
    dict(
        id="py-p6-predict-004", type="predict", difficulty=1, topics=["try", "ValueError"],
        code="""
            try:
                print(int("7a"))
            except ValueError:
                print("bad number")
        """,
        code_spoken="Try, print int of the string 7a. Except value error, print the string bad number.",
        prompt_spoken="What does this print?",
        expected="bad number",
        hints_spoken=["Can int read the string 7a?"],
        model_answer_spoken="It prints bad number. int can't parse 7a, so it raises a value error, which the except catches.",
    ),
    dict(
        id="py-p6-predict-005", type="predict", difficulty=2, topics=["generator expression", "sum"],
        code="""
            print(sum(len(w) for w in ["ab", "cde"]))
        """,
        code_spoken="Print the sum of len of w, for each w in the list of strings ab, cde.",
        prompt_spoken="What does this print?",
        expected="5",
        hints_spoken=["Add the lengths of the two strings."],
        model_answer_spoken="It prints 5, two letters plus three letters.",
    ),
    dict(
        id="py-p6-predict-006", type="predict", difficulty=3, topics=["dict comprehension"],
        code="""
            pairs = [("a", 1), ("b", 2)]
            d = {k: v for k, v in pairs if v > 1}
            print(d)
        """,
        code_spoken=("pairs equals a list of two pairs, a with 1 and b with 2. d equals a dictionary comprehension, "
                     "k maps to v, for each k and v in pairs, if v is greater than 1. Then print d."),
        prompt_spoken="What does this print?",
        expected="{'b': 2}",
        accept=["b maps to 2", "b colon 2", "a dictionary with b 2"],
        hints_spoken=["Which pairs have v greater than 1?"],
        model_answer_spoken="It prints a dictionary with just b mapped to 2.",
    ),
    dict(
        id="py-p6-explain-001", type="explain", difficulty=2, topics=["comprehension", "conditional expression"],
        code="""
            qtys = [120, 0, 90]
            rates = [5 / q if q else None for q in qtys]
        """,
        code_spoken=("qtys equals the list 120, 0, 90. rates equals a list comprehension of 5 divided by q if q is not "
                     "zero, else None, for each q in qtys."),
        prompt_spoken="What does this code do?",
        rubric=["divides 5 by each quantity", "uses None when a quantity is zero", "avoids dividing by zero"],
        model_answer_spoken="It divides 5 by each quantity, but puts None where the quantity is zero, so it never divides by zero.",
    ),
    dict(
        id="py-p6-explain-002", type="explain", difficulty=1, topics=["try", "conversion"], drive_ok=False,
        code="""
            def safe_int(s):
                try:
                    return int(s)
                except ValueError:
                    return None
        """,
        code_spoken=("Define safe int of s. Try to return int of s. Except value error, return None."),
        prompt_spoken="What does this function do?",
        rubric=["tries to convert the string to an integer", "catches a value error", "returns None instead of crashing"],
        model_answer_spoken="It converts a string to an integer, and returns None instead of crashing when the string isn't a valid number.",
    ),
    dict(
        id="py-p6-bug-001", type="spot_bug", difficulty=1, topics=["sorted", "methods"],
        code="""
            nums = [3, 1, 2]
            print(nums.sorted())
        """,
        code_spoken="Line 1, nums equals the list 3, 1, 2. Line 2, print nums dot sorted.",
        prompt_spoken="This should print the numbers in order. Which line has the bug, and what's the fix?",
        expected="[1, 2, 3]",
        bug=dict(line=2, fix_spoken="On line 2, use the built in sorted of nums. Lists have no sorted method.",
                 fixed_code="""
                    nums = [3, 1, 2]
                    print(sorted(nums))
                 """),
        rubric=["names line 2", "lists have no sorted method", "use sorted of nums"],
        hints_spoken=["sorted is a built in function, not a list method."],
        model_answer_spoken="Line 2. Lists have no sorted method, so it raises an attribute error. Use sorted of nums.",
    ),
    dict(
        id="py-p6-bug-002", type="spot_bug", difficulty=2, topics=["except", "ZeroDivisionError"], drive_ok=False,
        code="""
            try:
                x = 10 / 0
            except ValueError:
                x = 0
            print(x)
        """,
        code_spoken=("Line 1, try. Line 2, inside, x equals 10 divided by 0. Line 3, except value error. Line 4, "
                     "inside, x equals 0. Line 5, print x."),
        prompt_spoken="This should print 0 instead of crashing. Which line has the bug, and what's the fix?",
        expected="0",
        bug=dict(line=3, fix_spoken="On line 3, catch zero division error instead of value error.",
                 fixed_code="""
                    try:
                        x = 10 / 0
                    except ZeroDivisionError:
                        x = 0
                    print(x)
                 """),
        rubric=["names line 3", "dividing by zero raises zero division error, not value error",
                "catch zero division error"],
        hints_spoken=["Which error does dividing by zero raise?"],
        model_answer_spoken="Line 3. Dividing by zero raises a zero division error, which value error doesn't catch.",
    ),
    dict(
        id="py-p6-concept-001", type="concept", difficulty=1, topics=["comprehensions", "loops"],
        prompt_spoken="When should you use a list comprehension instead of a for loop?",
        rubric=["a comprehension builds a new list from another one", "good for a simple transform or filter",
                "use a loop for several steps or side effects like printing"],
        model_answer_spoken=("Use a comprehension when you're building a new list with a simple transform or filter. Use "
                             "a loop when the logic has several steps or side effects like printing."),
    ),
    dict(
        id="py-p6-plan-001", type="plan", difficulty=2, topics=["try", "loops"],
        prompt_spoken=("Plan this out loud. You have a list of strings that should be numbers, but some are bad. Build "
                       "a list of the valid ones as integers and skip the bad ones."),
        rubric=["an empty result list", "loop over the strings", "try int and append inside the try",
                "except value error skips the bad string"],
        model_answer_spoken=("Make an empty result list. Loop over the strings. Inside a try, convert each one with int and "
                             "append it. In the except value error branch, skip it. Return the result."),
    ),
]
