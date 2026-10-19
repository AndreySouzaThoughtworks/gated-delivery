---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git switch:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git fetch:*), Bash(git push:*), Bash(git reset --hard:*), Bash(git reset -q --hard:*), Bash(git cherry-pick:*), Bash(git rev-list:*), Bash(git merge-base:*), Bash(git config:*), Bash(gh pr create:*), Bash(gh pr view:*), Write
description: Commit, fast-forward push to an explicit refspec, and open a PR — following the client's commit convention
---

## Context

- Status: !`git status --short`
- Diff (staged and unstaged): !`git diff HEAD`
- Branch: !`git branch --show-current`
- Recent subjects: !`git log --format='%s' -10`
- Origin: !`git config --get remote.origin.url`
- Push default: !`git config --get push.default`

## Your task

Work through these steps in order. Stop at the checkpoint.

**1. Branch.** If on the default branch, create a feature branch. Use the **Branch** template from the `## Commit convention` section of the nearest CLAUDE.md when the origin matches its **Applies to**; otherwise `<type>/<short-desc>`. If already on a feature branch, use it. When the convention requires a ticket key and none can be derived, ask which ticket this belongs to.

**2. Commit.** Apply the rules of `/gated-delivery:commit` here, without the Skill tool — this command does not allow it, and that command's commit-only scope would end the run before the push:
- Subject: the convention's **Subject** template when the origin matches its **Applies to**; otherwise plain Conventional Commits. Never guess a ticket key and never fall back to a keyless subject.
- Stage by explicit path. Never `git add -A`, `git add .` or a bare wildcard, and never stage `.claude/` or agent notes.
- Body only when the subject is not self-evident, explaining why. End with the attribution lines the harness supplies for commits, unless the user's own instructions say otherwise.

**3. Sync before pushing.** The remote branch may be ahead of your local copy — a teammate's push, or a bot that merges the default branch in. Do not push blind:

```
git fetch origin <branch>
git rev-list --count HEAD..origin/<branch>
```

If the remote is ahead, rebuild your commit on the fetched tip so the push is a plain fast-forward. Run each command as its own Bash call, exactly as written — no `-q`, no `-C`, no `&&` chain — because the allowed rules match the command's leading words:

```
git reset --hard origin/<branch>
git cherry-pick <your-commit-sha>
```

Never `git rebase` + `git push --force` on a shared PR branch. Apply any extra sync rule the convention's **Remote** key names.

**4. CHECKPOINT — stop and show the user, before any network write:**
- the commit subject and body
- the files staged
- the push destination (`origin HEAD:refs/heads/<branch>`)
- the proposed PR title and body

Wait for explicit approval. Opening a PR is outward-facing and is not covered by approval given for the commit.

**5. Push with an explicit refspec.** Never `git push` or `git push -u` bare:

```
git push origin HEAD:refs/heads/<branch>
```

With `push.default = upstream`, a branch whose upstream is `origin/<default-branch>` — what `git switch -c <new> origin/main` and `git worktree add -b <new> <path> origin/main` configure — sends a bare `git push` **to the default branch**. The push output shows the real destination after the `->`; read it. The explicit refspec is immune whatever `push.default` says.

Commit as the repo's configured identity — never pass `-c user.email`. GitHub rejects pushes authored with a private address (`GH007`).

**6. Open the PR.** Write the body with the Write tool to `<local-notes>/pr-body-<branch-with-slashes-as-dashes>.md`, where `<local-notes>` is the Local notes home from `## Delivery notes` in the client's CLAUDE.md, default `~/.local/state/gated-delivery/`. Then pass the file:

```
gh pr create --title "<title>" --body-file <path>
```

Never pass the body inline with `--body`, through a heredoc, or on stdin: a `##` heading after a newline trips Claude Code's quoting check, and a redirect cannot be checked. The body leads with What changes and How verified, each bullet carrying its own reason. Link the ticket and spec rather than restating them. End with the attribution lines the harness supplies for pull requests, unless the user's own instructions say otherwise.

If a hook rejects the push, report its output verbatim and fix the cause — never reach for `--no-verify`.
