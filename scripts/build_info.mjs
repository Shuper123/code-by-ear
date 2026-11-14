// Build metadata shown in the app so a tester can tell which build is installed.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function buildInfo() {
  let sha = 'dev'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    /* not a git checkout */
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return { version: pkg.version, sha, time: new Date().toISOString() }
}
