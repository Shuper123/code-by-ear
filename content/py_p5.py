# P5: dictionaries and sets
LANG = "python"
UNIT = "P5"

DRILLS = [
    dict(
        id="py-p5-predict-001", type="predict", difficulty=1, topics=["dictionaries", "update"],
        code="""
            stock = {"clip": 40, "pin": 15}
            stock["pin"] += 5
            print(stock["pin"])
        """,
        code_spoken=("stock equals a dictionary where clip maps to 40 and pin maps to 15. Then add 5 to stock at key "
                     "pin. Then print stock at key pin."),
        prompt_spoken="What does this print?",
        expected="20",
        hints_spoken=["pin starts at 15."],
        model_answer_spoken="It prints 20. pin goes from 15 to 20.",
    ),
    dict(
        id="py-p5-predict-002", type="predict", difficulty=1, topics=["get", "defaults"],
        code="""
            d = {"a": 1}
            print(d.get("b", 0))
        """,
        code_spoken="d equals a dictionary where a maps to 1. Then print d dot get of the key b, with a default of 0.",
        prompt_spoken="What does this print?",
        expected="0",
        hints_spoken=["Is b a key in d?"],
        model_answer_spoken="It prints 0. The key b is missing, so get returns the default.",
    ),
    dict(
        id="py-p5-predict-003", type="predict", difficulty=1, topics=["KeyError"],
        code="""
            d = {"a": 1}
            print(d["b"])
        """,
        code_spoken="d equals a dictionary where a maps to 1. Then print d at key b.",
        prompt_spoken="What happens when this runs?",
        expected="KeyError",
        accept=["key error", "a key error"],
        hints_spoken=["Square brackets don't have a default."],
        model_answer_spoken="It raises a key error, because b is not a key. Use get if a key might be missing.",
    ),
    dict(
        id="py-p5-predict-004", type="predict", difficulty=1, topics=["sets", "uniqueness"],
        code="""
            s = {3, 1, 3, 2, 1}
            print(len(s))
        """,
        code_spoken="s equals a set of 3, 1, 3, 2, 1. Then print len of s.",
        prompt_spoken="What does this print?",
        expected="3",
        hints_spoken=["A set drops duplicates."],
        model_answer_spoken="It prints 3. A set keeps only the unique values 1, 2 and 3.",
    ),
    dict(
        id="py-p5-predict-005", type="predict", difficulty=2, topics=["sets", "intersection"],
        code="""
            a = {1, 2, 3}
            b = {2, 3, 4}
            print(sorted(a & b))
        """,
        code_spoken="a equals the set 1, 2, 3. b equals the set 2, 3, 4. Then print sorted of a intersect b.",
        prompt_spoken="What does this print?",
        expected="[2, 3]",
        hints_spoken=["Intersect keeps values that are in both sets."],
        model_answer_spoken="It prints the list 2, 3, the values in both sets, sorted.",
    ),
    dict(
        id="py-p5-predict-006", type="predict", difficulty=2, topics=["counting", "get"],
        code="""
            counts = {}
            for w in ["pin", "cap", "pin"]:
                counts[w] = counts.get(w, 0) + 1
            print(counts["pin"])
        """,
        code_spoken=("counts equals an empty dictionary. For each w in the list of strings pin, cap, pin, inside the "
                     "loop, counts at w equals counts dot get of w with default 0, plus 1. After the loop, print counts "
                     "at key pin."),
        prompt_spoken="What does this print?",
        expected="2",
        hints_spoken=["How many times does pin appear?"],
        model_answer_spoken="It prints 2. The loop counts each word, and pin appears twice.",
    ),
    dict(
        id="py-p5-explain-001", type="explain", difficulty=2, topics=["sets", "membership"],
        code="""
            seen = set()
            for lot in [4, 7, 4, 9]:
                print(lot in seen)
                seen.add(lot)
        """,
        code_spoken=("seen equals an empty set. For each lot in the list 4, 7, 4, 9, inside the loop, print whether "
                     "lot is in seen, then add lot to seen."),
        prompt_spoken="What does this code do?",
        rubric=["keeps a set of lots already seen", "prints True when a lot repeats", "only the second 4 prints True"],
        model_answer_spoken=("It goes through the lot numbers and prints whether each one was already seen, using a set. "
                             "Only the second 4 prints True."),
    ),
    dict(
        id="py-p5-explain-002", type="explain", difficulty=1, topics=["items", "loops"],
        code="""
            cost = {"clip": 0.25, "pin": 0.15}
            for part, price in cost.items():
                print(part, price * 100)
        """,
        code_spoken=("cost equals a dictionary where clip maps to 0.25 and pin maps to 0.15. For each part and price in "
                     "cost dot items, print part and price times 100."),
        prompt_spoken="What does this code do?",
        rubric=["loops over key and value pairs with items", "prints each part with its price times 100",
                "shows the prices in cents"],
        model_answer_spoken="It loops over each part and its price, and prints the part name with the price in cents.",
    ),
    dict(
        id="py-p5-bug-001", type="spot_bug", difficulty=1, topics=["dictionaries", "assignment"],
        code="""
            stock = {"clip": 40}
            stock.append({"pin": 15})
            print(stock)
        """,
        code_spoken=("Line 1, stock equals a dictionary where clip maps to 40. Line 2, stock dot append of a dictionary "
                     "where pin maps to 15. Line 3, print stock."),
        prompt_spoken="This should add pin with 15 to stock. Which line has the bug, and what's the fix?",
        expected="{'clip': 40, 'pin': 15}",
        bug=dict(line=2, fix_spoken="On line 2, assign the key directly, stock at key pin equals 15.",
                 fixed_code="""
                    stock = {"clip": 40}
                    stock["pin"] = 15
                    print(stock)
                 """),
        rubric=["names line 2", "dictionaries have no append method", "assign the new key directly"],
        hints_spoken=["append is a list method."],
        model_answer_spoken="Line 2. Dictionaries have no append. Assign the key directly, stock at key pin equals 15.",
    ),
    dict(
        id="py-p5-bug-002", type="spot_bug", difficulty=2, topics=["counting", "KeyError"],
        code="""
            counts = {}
            for w in ["pin", "cap", "pin"]:
                counts[w] += 1
            print(counts)
        """,
        code_spoken=("Line 1, counts equals an empty dictionary. Line 2, for each w in the list of strings pin, cap, "
                     "pin. Line 3, inside the loop, add 1 to counts at w. Line 4, print counts."),
        prompt_spoken="This should count each word. Which line has the bug, and what's the fix?",
        expected="{'pin': 2, 'cap': 1}",
        bug=dict(line=3, fix_spoken=("On line 3, start missing keys at zero, for example counts at w equals counts dot "
                                     "get of w with default 0, plus 1."),
                 fixed_code="""
                    counts = {}
                    for w in ["pin", "cap", "pin"]:
                        counts[w] = counts.get(w, 0) + 1
                    print(counts)
                 """),
        rubric=["names line 3", "the first time a word appears the key doesn't exist, so it raises a key error",
                "use get with a default of 0, or a Counter"],
        hints_spoken=["What is counts at pin the very first time?"],
        model_answer_spoken=("Line 3. The first time a word shows up the key doesn't exist, so it raises a key error. "
                             "Use get with a default of 0."),
    ),
    dict(
        id="py-p5-concept-001", type="concept", difficulty=2, topics=["sets", "performance"],
        prompt_spoken="Why is checking whether an item is in a set usually faster than checking a list?",
        rubric=["a set uses hashing to jump to where the item would be", "a list checks items one by one",
                "set lookups take about the same time however big the set is"],
        model_answer_spoken=("A set uses hashing, so it can jump straight to where the item would be. A list has to check "
                             "items one by one."),
    ),
    dict(
        id="py-p5-plan-001", type="plan", difficulty=2, topics=["counting", "max"],
        prompt_spoken=("Plan this out loud. You have a list of defect codes with repeats. Find the code that appears "
                       "most often."),
        rubric=["count each code with a dictionary or Counter", "find the code with the largest count",
                "return or print that code"],
        model_answer_spoken=("Count each code with a dictionary, adding one each time, or use Counter. Then pick the key "
                             "with the largest count, for example max with the counts as the key."),
    ),
]
