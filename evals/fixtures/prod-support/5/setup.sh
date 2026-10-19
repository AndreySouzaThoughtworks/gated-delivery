#!/usr/bin/env bash
set -euo pipefail

readonly NPM_REGISTRY="https://registry.npmjs.org/"
readonly FIX_BRANCH="fix/SUP-1680-transcript-autoscroll"
readonly NO_HOOKS=".git/no-hooks"

git init -q -b main
git config user.email dev@example.com
git config user.name dev
git config commit.gpgsign false
git config core.hooksPath "$NO_HOOKS"
mkdir -p .git/info
printf '%s\n' persona.md bin/ gh-calls.log origin.git/ drafted/ .corpus/ >> .git/info/exclude

git add -A
git commit -q -m "feat: transcript panel"
git init -q --bare origin.git
git remote add origin "$PWD/origin.git"
git push -q origin main

git checkout -q -b "$FIX_BRANCH"
mv drafted/TranscriptPanel.tsx drafted/TranscriptPanel.test.tsx src/console/
rmdir drafted
git add -A
git commit -q -m "fix(SUP-1680): auto-scroll the transcript panel to the newest message"

npm ci --registry "$NPM_REGISTRY" --no-audit --no-fund --loglevel=error
