---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git config:*)
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

**Convention.** Read the `## Commit convention` section of the nearest CLAUDE.md. It may name:

| Key | Meaning |
|-----|---------|
| Applies to | Origins the convention covers, e.g. an org prefix |
| Subject | Subject template, e.g. `<type>(<KEY>-<N>): <description>` |
| Ticket key | Where the key comes from and which values the hooks reject |
| Branch | Branch name template, used by `/gated-delivery:commit-push-pr` |
| Remote | Extra rules for syncing and pushing PR branches, used by `/gated-delivery:commit-push-pr` |

Use the convention only when the origin matches **Applies to**. Otherwise — or when no section exists — use plain Conventional Commits: `<type>[(<scope>)][!]: <description>` with `<type>` one of `feat fix chore refactor docs test perf build ci style`.

When the convention requires a ticket key and the branch name carries none, stop and ask which ticket this belongs to. Never guess a key and never fall back to a keyless subject.

**Staging.** Stage the files belonging to this change by explicit path. Never `git add -A`, `git add .`, or a bare wildcard. Stage untracked files only when they are clearly part of the change; never stage agent scratch directories (`.claude/`, `*/.claude/`, agent notes). If untracked files look ambiguous, list them and ask.

**Message body.** Explain why, not what, and only when the subject isn't self-evident. End the message with the attribution lines the harness supplies for commits, unless the user's own instructions say otherwise.

**Scope.** Commit only. Do not push, do not open a PR, do not amend existing commits unless asked.
