// Lays a one-line reference query out the way people write SQL, for the "Show answer" card in typed mode.

/** A reference query on several lines: a new line before each clause of the outer query and of each step. */
export function formatSql(sql: string): string {
  const src = sql.trim().replace(/;\s*$/, '')
  let out = ''
  let depth = 0
  let i = 0
  const clause = /^(SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|LEFT JOIN|INNER JOIN|JOIN)\b/i
  // inside a WITH step, clauses sit one level in
  const stepDepths: number[] = []
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'") {
      const end = src.indexOf("'", i + 1)
      const stop = end < 0 ? src.length : end + 1
      out += src.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '(') {
      depth++
      out += ch
      if (/\bAS\s*$/i.test(src.slice(0, i)) && /^\(\s*SELECT\b/i.test(src.slice(i))) {
        stepDepths.push(depth)
        out += '\n  '
        i++
        while (src[i] === ' ') i++
        continue
      }
      i++
      continue
    }
    if (ch === ')') {
      if (stepDepths[stepDepths.length - 1] === depth) {
        stepDepths.pop()
        out = `${out.trimEnd()}\n)`
        depth--
        i++
        // the query after the last step starts on its own line
        const rest = src.slice(i)
        const gap = rest.match(/^\s*/)![0].length
        if (clause.test(rest.slice(gap))) {
          out += '\n'
          i += gap
        }
        continue
      }
      depth--
      out += ch
      i++
      continue
    }
    const inStep = stepDepths[stepDepths.length - 1] === depth
    if ((depth === 0 || inStep) && /\s/.test(ch)) {
      const rest = src.slice(i).trimStart()
      if (clause.test(rest) && out.trim() && !/\(\s*$/.test(out)) {
        out = `${out.trimEnd()}\n${inStep ? '  ' : ''}`
        i += src.slice(i).length - rest.length
        continue
      }
    }
    out += ch
    i++
  }
  return out
}
