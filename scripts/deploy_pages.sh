#!/usr/bin/env bash
# Build Code by Ear and publish it to GitHub Pages from the gh-pages branch.
#   1. refuses to run with uncommitted changes (so STATUS.md and sources always ship together)
#   2. runs drill validation and unit tests (SKIP_CHECKS=1 to skip; don't, except in emergencies)
#   3. builds dist/
#   4. pushes the current branch (normal push)
#   5. commits dist/ plus .nojekyll to gh-pages as a normal commit and pushes it (never --force)
# Optional: DEPLOY_COMMIT_TRAILER="..." is appended to the gh-pages commit message.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: uncommitted changes. Commit them (including STATUS.md) before deploying." >&2
  git status --short >&2
  exit 1
fi

if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  if [ -f scripts/validate_drills.py ]; then
    echo "== drill validation"
    npm run --silent validate
    if [ -n "$(git status --porcelain)" ]; then
      echo "error: validation changed tracked files (report or drill hashes). Commit them, then deploy again." >&2
      git status --short >&2
      exit 1
    fi
  fi
  echo "== unit tests"
  npm test --silent
fi

echo "== build"
npm run --silent build

SHA="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "== push $BRANCH"
git -c push.negotiate=true push origin "$BRANCH"

WT="$(mktemp -d)"
cleanup() {
  cd "$ROOT"
  git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git worktree prune
}
trap cleanup EXIT

if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git fetch --depth=1 origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages
  git worktree add -B gh-pages "$WT" origin/gh-pages
else
  git worktree add --orphan -b gh-pages "$WT"
fi

# Replace the branch contents with the fresh build.
find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a dist/. "$WT/"
touch "$WT/.nojekyll"

cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "gh-pages already matches this build; nothing to commit."
else
  MSG="Deploy $SHA from $BRANCH"
  if [ -n "${DEPLOY_COMMIT_TRAILER:-}" ]; then
    git commit -q -m "$MSG" -m "$DEPLOY_COMMIT_TRAILER"
  else
    git commit -q -m "$MSG"
  fi
fi
git -c push.negotiate=true push origin gh-pages
echo "Deployed $SHA. Live at https://shuper123.github.io/code-by-ear/ (Pages takes about a minute)."
