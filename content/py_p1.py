# P1: values, variables, strings, f-strings
LANG = "python"
UNIT = "P1"

DRILLS = [
    dict(
        id="py-p1-predict-001", type="predict", difficulty=1, topics=["variables", "assignment"],
        code="""
            x = 7
            x = x + 3
            print(x)
        """,
        code_spoken="x equals 7. Then x equals x plus 3. Then print x.",
        prompt_spoken="What does this print?",
        expected="10",
        hints_spoken=["The second line reads the old x, then stores the new value back in x."],
        model_answer_spoken="It prints 10. The second line replaces x with 7 plus 3.",
    ),
    dict(
        id="py-p1-predict-002", type="predict", difficulty=1, topics=["strings", "len"],
        code="""
            word = "gasket"
            print(len(word))
        """,
        code_spoken="word equals the string gasket. Then print len of word.",
        prompt_spoken="What does this print?",
        expected="6",
        hints_spoken=["len counts characters.", "Spell gasket and count the letters."],
        model_answer_spoken="It prints 6, the number of characters in gasket.",
    ),
    dict(
        id="py-p1-predict-003", type="predict", difficulty=1, topics=["strings", "operators"],
        code="""
            a = "clip"
            print(a * 2)
        """,
        code_spoken="a equals the string clip. Then print a times 2.",
        prompt_spoken="What does this print?",
        expected="clipclip",
        accept=["clip clip", "clip twice"],
        hints_spoken=["Multiplying a string by a number repeats it."],
        model_answer_spoken="It prints clipclip. Multiplying a string by 2 repeats it twice with no space.",
    ),
    dict(
        id="py-p1-predict-004", type="predict", difficulty=2, topics=["operators", "floor division", "modulo"],
        code="""
            print(7 // 2, 7 % 2)
        """,
        code_spoken="Print 7 floor divide 2, and 7 mod 2.",
        prompt_spoken="What does this print?",
        expected="3 1",
        accept=["three and one", "3 then 1"],
        hints_spoken=["Floor divide drops the remainder.", "Mod gives only the remainder."],
        model_answer_spoken="It prints 3 and 1. Floor division gives 3, and the remainder is 1.",
    ),
    dict(
        id="py-p1-predict-005", type="predict", difficulty=1, topics=["f-strings"],
        code="""
            qty = 40
            print(f"Lot has {qty} parts")
        """,
        code_spoken="qty equals 40. Then print the f string, Lot has, value of qty, parts.",
        prompt_spoken="What does this print?",
        expected="Lot has 40 parts",
        hints_spoken=["The f string puts the value of qty where the braces are."],
        model_answer_spoken="It prints Lot has 40 parts. The f string fills in the value of qty.",
    ),
    dict(
        id="py-p1-predict-006", type="predict", difficulty=1, topics=["strings", "methods"],
        code="""
            name = "Bracket"
            print(name.upper())
        """,
        code_spoken="name equals the string Bracket, with a capital B. Then print name dot upper.",
        prompt_spoken="What does this print?",
        expected="BRACKET",
        accept=["bracket in capitals", "bracket all caps", "bracket in all caps", "bracket uppercase", "all caps bracket"],
        hints_spoken=["upper changes every letter to a capital."],
        model_answer_spoken="It prints BRACKET, in all capital letters.",
    ),
    dict(
        id="py-p1-predict-007", type="predict", difficulty=2, topics=["division", "floats"], strict_numbers=True,
        code="""
            print(8 / 2)
        """,
        code_spoken="Print 8 divided by 2.",
        prompt_spoken="What does this print, exactly?",
        expected="4.0",
        accept=["four point oh", "four point zero"],
        hints_spoken=["A single slash always gives a float in Python 3."],
        model_answer_spoken="It prints 4.0, a float, because a single slash always returns a float.",
    ),
    dict(
        id="py-p1-explain-001", type="explain", difficulty=1, topics=["strings", "concatenation"],
        code="""
            first = "Ana"
            last = "Park"
            full = first + " " + last
            print(full)
        """,
        code_spoken=("first equals the string Ana. last equals the string Park. full equals first, plus a string "
                     "with one space, plus last. Then print full."),
        prompt_spoken="What does this code do, in one or two sentences?",
        rubric=["joins or concatenates the two strings", "puts a space between them", "prints the full name, Ana Park"],
        model_answer_spoken="It joins a first and last name with a space between them and prints the full name, Ana Park.",
    ),
    dict(
        id="py-p1-explain-002", type="explain", difficulty=1, topics=["f-strings", "arithmetic"],
        code="""
            price = 2.5
            qty = 4
            print(f"Total {price * qty}")
        """,
        code_spoken="price equals 2.5. qty equals 4. Then print the f string, Total, value of price times qty.",
        prompt_spoken="What does this code do?",
        rubric=["multiplies price by quantity", "prints the result inside an f string", "the total is 10.0"],
        model_answer_spoken="It multiplies a price by a quantity and prints the total, Total 10.0, using an f string.",
    ),
    dict(
        id="py-p1-bug-001", type="spot_bug", difficulty=1, topics=["types", "conversion"],
        code="""
            count = "5"
            total = count + 3
            print(total)
        """,
        code_spoken="Line 1, count equals the string 5. Line 2, total equals count plus 3. Line 3, print total.",
        prompt_spoken="This should print 8. Which line has the bug, and what's the fix?",
        expected="8",
        bug=dict(line=2, fix_spoken="On line 2, convert count with int of count before adding 3.",
                 fixed_code="""
                    count = "5"
                    total = int(count) + 3
                    print(total)
                 """),
        rubric=["names line 2", "count is a string, not a number", "convert it with int before adding"],
        hints_spoken=["Look at the type of count."],
        model_answer_spoken="Line 2. count is a string, so adding 3 raises a type error. Use int of count plus 3.",
    ),
    dict(
        id="py-p1-bug-002", type="spot_bug", difficulty=1, topics=["names", "case sensitivity"],
        code="""
            name = "Ana"
            print("Hello, " + Name)
        """,
        code_spoken=("Line 1, name equals the string Ana, all lowercase name. Line 2, print the string Hello comma "
                     "space, plus Name with a capital N."),
        prompt_spoken="This should print Hello, Ana. Which line has the bug, and what's the fix?",
        expected="Hello, Ana",
        bug=dict(line=2, fix_spoken="On line 2, use lowercase name. Python names are case sensitive.",
                 fixed_code="""
                    name = "Ana"
                    print("Hello, " + name)
                 """),
        rubric=["names line 2", "Name with a capital N is a different, undefined name", "use lowercase name"],
        hints_spoken=["Compare how the variable is spelled on each line."],
        model_answer_spoken="Line 2. Name with a capital N was never defined, so it raises a name error. Use lowercase name.",
    ),
    dict(
        id="py-p1-concept-001", type="concept", difficulty=1, topics=["assignment", "comparison"],
        prompt_spoken="What's the difference between a single equals sign and a double equals sign in Python?",
        rubric=["single equals assigns a value to a name", "double equals compares two values", "a comparison gives True or False"],
        model_answer_spoken=("A single equals assigns a value to a name. A double equals compares two values and gives "
                             "True or False."),
    ),
    dict(
        id="py-p1-plan-001", type="plan", difficulty=1, topics=["strings", "f-strings"],
        prompt_spoken=("Plan this out loud. A part name is stored in a variable, and the line letter in another. "
                       "Build a label with the part name in capitals, then a dash, then the line letter."),
        rubric=["uppercase the part name with upper", "combine name, dash and line letter, for example with an f string",
                "print or return the label"],
        model_answer_spoken=("First uppercase the part name with upper. Then build the label with an f string that puts "
                             "the uppercased name, a dash, and the line letter together. Then print or return it."),
    ),
]
