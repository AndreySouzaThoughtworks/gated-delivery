#!/usr/bin/env bash
set -euo pipefail

readonly FEATURE_BRANCH="feat/PROJ-209"

git init -q -b main
git config user.email eval@example.com
git config user.name eval
git config commit.gpgsign false
git config core.hooksPath .git/no-hooks
mkdir -p .git/info
printf '%s\n' persona.md >> .git/info/exclude
git commit -q --allow-empty -m init

printf '# orders-api\n\nSource omitted from this evaluation checkout.\n' > README.md
printf 'evidence/\nnotes-checkout/\n' > .gitignore
git checkout -q -b "$FEATURE_BRANCH"
git add -A
git commit -q -m "feat(PROJ-209): delivered change (source omitted)"
