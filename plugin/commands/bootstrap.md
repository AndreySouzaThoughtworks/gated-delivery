---
allowed-tools: Bash(node:*), Bash(git status:*), Bash(git branch:*), Bash(git switch:*), Bash(git remote:*)
description: Add the missing guardrails to a client repo that has none: plan-only by default, writes only after a per-group yes, on a branch, delivered through the commit commands
---

## Context

- Status: !`git status --short`
- Branch: !`git branch --show-current`
- Origin: !`git remote get-url origin`
- Detected: !`node "${CLAUDE_PLUGIN_ROOT}/bootstrap/detect.mjs"`

## Your task

Orchestrate the scripts in `${CLAUDE_PLUGIN_ROOT}/bootstrap/`. They decide and write; this command only sequences them. Python and TypeScript/JavaScript repos on GitHub only. If `detect.mjs` reports another CI and no GitHub workflows, stop and say so.

**1. Plan.** Run `node "${CLAUDE_PLUGIN_ROOT}/bootstrap/plan.mjs"`. It writes nothing. Stdout is the diff, stderr the notes: conflicts, zanity commands it would run, the overwatch install line. Show both. An empty diff means nothing to do; stop.

**2. Zanity.** If the plan says zanity is missing, run `node "${CLAUDE_PLUGIN_ROOT}/bootstrap/install-zanity.mjs"` to show the pinned, checksum-verified install, and run it with `--run` only after a yes. Never `curl | sh` and never from `main`.

**3. Branch.** On `main` or `master`, create `bootstrap/guardrails` with `git switch -c`. Never commit to the default branch.

**4. Apply.** Ask one yes or no per group, naming the files: `config` (`zanity init`, baseline capture), `guards`, `ci`. Rerun `plan.mjs --apply` with one `--group <name>` for each yes. A conflict is reported and never overwritten: show it, and offer `--workflow-name` for a different file name.

**5. Deliver.** Print the overwatch install line from the plan. Do not run it. Commit with `/gated-delivery:commit` and open the PR with `/gated-delivery:commit-push-pr`. Never push to `main`, never `--force`.
