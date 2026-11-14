// Copies browser runtimes (sql.js wasm, Pyodide core) from node_modules into public/runtimes
// so GitHub Pages serves them from the app's own origin and the service worker can cache them.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'public', 'runtimes')
mkdirSync(out, { recursive: true })

const copies = [
  // [from (relative to node_modules), to (relative to public/runtimes)]
  ['sql.js/dist/sql-wasm.wasm', 'sql-wasm.wasm'],
  ['pyodide/pyodide.mjs', 'pyodide/pyodide.mjs'],
  ['pyodide/pyodide.asm.js', 'pyodide/pyodide.asm.js'],
  ['pyodide/pyodide.asm.wasm', 'pyodide/pyodide.asm.wasm'],
  ['pyodide/python_stdlib.zip', 'pyodide/python_stdlib.zip'],
  ['pyodide/pyodide-lock.json', 'pyodide/pyodide-lock.json'],
]
let copied = 0
for (const [from, to] of copies) {
  const src = join(root, 'node_modules', from)
  if (!existsSync(src)) continue // runtime not installed yet (added in a later milestone)
  const dest = join(out, to)
  mkdirSync(join(dest, '..'), { recursive: true })
  cpSync(src, dest)
  copied++
}
console.log(`copy_runtimes: ${copied} file(s) copied to public/runtimes`)
