---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git config:*), Bash(node:*)
description: Create one commit that follows the client's commit convention, with explicit staging
---

## Context

- Status: !`git status --short`
- Diff (staged and unstaged): !`git diff HEAD`
- Branch: !`git branch --show-current`
- Recent subjects: !`git log --format='%s' -10`
- Origin: !`git config --get remote.origin.url`

## Your task

Create a single commit that passes this repo's hooks on the first try.

**Plan.** Run, with this change's files by explicit path after `--`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/commit-plan.mjs" --type <type> --description "<text>" -- <path>...
```

It reads the nearest CLAUDE.md `## Commit convention` and prints `{source, subject, branchTemplate, prBodyFile}`. Commit with `subject` verbatim. Use the convention only when the origin matches **Applies to**: `client` is a match on a backticked origin, `plain` is plain Conventional Commits. `plain-unproven` means **Applies to** is prose: read it, and when it covers the origin, build the subject from the convention's **Subject** template.

Exit 1: STOP and ask which ticket this belongs to, then rerun with `--ticket <KEY-N>`. Never guess a key and never fall back to a keyless subject.

Exit 3: STOP. Never `git add -A`, `git add .`, or a bare wildcard. Exit 2: fix the flags stderr names.

**Staging.** Stage the files belonging to this change by explicit path. Stage untracked files only when they are clearly part of the change; never stage agent scratch directories (`.claude/`, `*/.claude/`, agent notes). If untracked files look ambiguous, list them and ask.

**Message body.** Explain why, not what, and only when the subject isn't self-evident. End the message with the attribution lines the harness supplies for commits, unless the user's own instructions say otherwise.

**Scope.** Commit only. Do not push, do not open a PR, do not amend existing commits unless asked.
