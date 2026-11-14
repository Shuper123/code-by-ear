# P2: lists, indexing, slicing
LANG = "python"
UNIT = "P2"

DRILLS = [
    dict(
        id="py-p2-predict-007", type="predict", difficulty=1, topics=["lists", "sort", "indexing"],
        code="""
            nums = [3, 1, 2]
            nums.sort()
            print(nums[0])
        """,
        code_spoken="nums equals the list 3, 1, 2. Then nums dot sort. Then print nums at index 0.",
        prompt_spoken="What does this print?",
        expected="1",
        accept=["one"],
        hints_spoken=["sort changes the list in place, smallest first."],
        model_answer_spoken="It prints 1. Sorting puts the smallest value first.",
    ),
    dict(
        id="py-p2-predict-001", type="predict", difficulty=1, topics=["lists", "negative index"],
        code="""
            parts = ["clip", "pin", "cap"]
            print(parts[-1])
        """,
        code_spoken="parts equals the list of strings clip, pin, cap. Then print parts at index negative 1.",
        prompt_spoken="What does this print?",
        expected="cap",
        hints_spoken=["Negative indexes count from the end."],
        model_answer_spoken="It prints cap. Index negative 1 is the last item.",
    ),
    dict(
        id="py-p2-predict-002", type="predict", difficulty=2, topics=["slicing"],
        code="""
            nums = [10, 20, 30, 40]
            print(nums[1:3])
        """,
        code_spoken="nums equals the list 10, 20, 30, 40. Then print nums from index 1 up to 3.",
        prompt_spoken="What does this print?",
        expected="[20, 30]",
        hints_spoken=["Index 1 is 20.", "The slice stops before index 3."],
        model_answer_spoken="It prints the list 20, 30. The slice starts at index 1 and stops before index 3.",
    ),
    dict(
        id="py-p2-predict-003", type="predict", difficulty=1, topics=["append", "len"],
        code="""
            nums = [5, 8]
            nums.append(2)
            print(len(nums))
        """,
        code_spoken="nums equals the list 5, 8. Then nums dot append of 2. Then print len of nums.",
        prompt_spoken="What does this print?",
        expected="3",
        hints_spoken=["append adds one item to the end."],
        model_answer_spoken="It prints 3. Appending adds a third item.",
    ),
    dict(
        id="py-p2-predict-004", type="predict", difficulty=1, topics=["indexing", "errors"],
        code="""
            nums = [4, 5, 6]
            print(nums[3])
        """,
        code_spoken="nums equals the list 4, 5, 6. Then print nums at index 3.",
        prompt_spoken="What happens when this runs?",
        expected="IndexError",
        accept=["index error", "an index error", "index out of range", "list index out of range", "error index out of range"],
        hints_spoken=["Indexes start at 0. What's the last valid index?"],
        model_answer_spoken="It raises an index error. The valid indexes are 0, 1 and 2.",
    ),
    dict(
        id="py-p2-predict-005", type="predict", difficulty=2, topics=["aliasing", "mutability"],
        code="""
            a = [1, 2]
            b = a
            b.append(3)
            print(a)
        """,
        code_spoken="a equals the list 1, 2. b equals a. Then b dot append of 3. Then print a.",
        prompt_spoken="What does this print?",
        expected="[1, 2, 3]",
        hints_spoken=["b equals a does not copy the list."],
        model_answer_spoken="It prints the list 1, 2, 3. a and b are the same list, so appending through b changes a.",
    ),
    dict(
        id="py-p2-explain-001", type="explain", difficulty=1, topics=["sum", "len", "average"],
        code="""
            qtys = [120, 340, 90]
            total = sum(qtys)
            print(total / len(qtys))
        """,
        code_spoken="qtys equals the list 120, 340, 90. total equals sum of qtys. Then print total divided by len of qtys.",
        prompt_spoken="What does this code do?",
        rubric=["adds up the quantities", "divides by the number of items", "prints the average, about 183"],
        model_answer_spoken="It prints the average quantity, the sum of the list divided by how many items it has, about 183.",
    ),
    dict(
        id="py-p2-explain-002", type="explain", difficulty=2, topics=["slicing", "reverse"],
        code="""
            lots = [101, 102, 103, 104, 105]
            print(lots[-2:])
            print(lots[::-1])
        """,
        code_spoken=("lots equals the list 101 through 105. Print lots from index negative 2 to the end. Then print "
                     "lots with a step of negative 1."),
        prompt_spoken="What do the two print lines show?",
        rubric=["the first prints the last two items, 104 and 105", "the second prints the list reversed"],
        model_answer_spoken="The first prints the last two lots, 104 and 105. The second prints the whole list reversed.",
    ),
    dict(
        id="py-p2-bug-001", type="spot_bug", difficulty=2, topics=["sort", "None"],
        code="""
            nums = [4, 9, 2]
            biggest = nums.sort()[-1]
            print(biggest)
        """,
        code_spoken=("Line 1, nums equals the list 4, 9, 2. Line 2, biggest equals nums dot sort, then at index "
                     "negative 1. Line 3, print biggest."),
        prompt_spoken="This should print 9. Which line has the bug, and what's the fix?",
        expected="9",
        bug=dict(line=2, fix_spoken="On line 2, use sorted of nums, or max of nums. nums dot sort returns None.",
                 fixed_code="""
                    nums = [4, 9, 2]
                    biggest = sorted(nums)[-1]
                    print(biggest)
                 """),
        rubric=["names line 2", "sort works in place and returns None", "use sorted of nums or max of nums"],
        hints_spoken=["What does nums dot sort return?"],
        model_answer_spoken="Line 2. nums dot sort sorts in place and returns None, so indexing fails. Use sorted of nums.",
    ),
    dict(
        id="py-p2-bug-002", type="spot_bug", difficulty=1, topics=["slicing"],
        code="""
            items = ["a", "b", "c"]
            print(items[1:2])
        """,
        code_spoken="Line 1, items equals the list of strings a, b, c. Line 2, print items from index 1 up to 2.",
        prompt_spoken="This should print the last two items. Which line has the bug, and what's the fix?",
        expected="['b', 'c']",
        bug=dict(line=2, fix_spoken="On line 2, slice from index 1 to the end by leaving out the stop.",
                 fixed_code="""
                    items = ["a", "b", "c"]
                    print(items[1:])
                 """),
        rubric=["names line 2", "the stop index 2 leaves out c", "slice from 1 to the end"],
        hints_spoken=["The stop index is not included."],
        model_answer_spoken="Line 2. The slice stops before index 2, so it only gives b. Slice from 1 to the end.",
    ),
    dict(
        id="py-p2-concept-001", type="concept", difficulty=1, topics=["tuples", "lists"],
        prompt_spoken="When would you use a tuple instead of a list?",
        rubric=["tuples can't be changed after they're made", "lists can grow and change", "a fixed record or pair fits a tuple"],
        model_answer_spoken=("Use a tuple for a fixed group of values that shouldn't change, like a pair of coordinates. "
                             "Use a list for a collection you add to or change."),
    ),
    dict(
        id="py-p2-plan-001", type="plan", difficulty=2, topics=["sorting", "slicing"],
        prompt_spoken="Plan this out loud. Given a list of lot quantities, get the three largest quantities.",
        rubric=["sort from largest to smallest", "take the first three with a slice", "works when the list has fewer than three"],
        model_answer_spoken=("Sort the list from largest to smallest, for example sorted with reverse set to true, then "
                             "take the first three items with a slice. A slice also works if there are fewer than three."),
    ),
]
