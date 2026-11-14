// Drill format (spec section 8). Drills live in JSON files, one per unit, in src/data/drills/.
// They are generated from content/*.py by scripts/build_drills.py and checked by
// scripts/validate_drills.py, which runs every one of them.

export type Lang = 'sql' | 'python'
export type DrillType = 'predict' | 'explain' | 'spot_bug' | 'plan' | 'concept' | 'sketch' | 'dictate'
export type DatasetName = 'factory' | 'shop'

export interface PyTest {
  args: unknown[]
  expected: unknown
}

export interface Drill {
  id: string
  lang: Lang
  unit: string // S1..S6, P1..P6
  level: 1 | 2 | 3
  type: DrillType
  ladder?: string
  difficulty: 1 | 2 | 3
  drive_ok: boolean
  dataset?: DatasetName
  topics: string[]
  code?: string
  code_spoken?: string
  prompt_spoken: string
  expected?: string // predict: exact printed output or returned rows
  answer_kind?: 'output' | 'row_count' // SQL predict: the answer is the number of rows returned
  accept?: string[] // predict: accepted variants
  strict_numbers?: boolean // predict: 3 and 3.0 are different answers
  rubric?: string[] // key points for AI grading
  bug?: { line: number; fix_spoken: string; fixed_code: string }
  reference?: string // Sketch/Dictate: reference solution
  order_matters?: boolean
  signature?: string // Python Sketch/Dictate
  function_name?: string // Python Sketch/Dictate: function the tests call
  tests?: PyTest[]
  vocab?: string[]
  hints_spoken?: string[]
  model_answer_spoken: string
}

export const UNIT_NAMES: Record<string, string> = {
  S1: 'Select basics',
  S2: 'Filters and nulls',
  S3: 'Aggregates',
  S4: 'Joins',
  S5: 'Subqueries and case',
  S6: 'Window functions',
  P1: 'Values and strings',
  P2: 'Lists',
  P3: 'Conditionals and loops',
  P4: 'Functions',
  P5: 'Dictionaries and sets',
  P6: 'Comprehensions and errors',
}

export const UNITS: Record<Lang, string[]> = {
  sql: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  python: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
}

export const LEVEL_NAMES: Record<number, string> = { 1: 'Explain', 2: 'Sketch', 3: 'Dictate' }
