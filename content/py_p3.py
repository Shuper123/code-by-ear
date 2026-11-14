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
