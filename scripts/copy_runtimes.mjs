// Copies browser runtimes (sql.js wasm, Pyodide core, ONNX Runtime Web) from node_modules into public/runtimes
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
  // ONNX Runtime Web, for the on-phone Kokoro voice (versions must match @huggingface/transformers)
  ['@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', 'ort/ort-wasm-simd-threaded.jsep.mjs'],
  ['@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', 'ort/ort-wasm-simd-threaded.jsep.wasm'],
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
