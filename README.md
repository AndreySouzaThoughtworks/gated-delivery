# gated-delivery

Claude Code plugin for issue-driven, test-first delivery, with no client baked in. Specs define independently merging PR slices; implementation runs focused batches and applies verification, structural review and fresh-context correctness gates at every merge boundary. Everything client-specific — tracker, commit convention, notes homes, stack recipes, reviewers — comes from the client's CLAUDE.md: [docs/client-context.md](docs/client-context.md).

## Install

```text
claude plugin marketplace add ~/Develop/gated-delivery
/plugin install gated-delivery@gated-delivery
/reload-plugins
```

Per-profile installs (one `CLAUDE_CONFIG_DIR` per client or account), notes-folder permission and verify knobs: **[docs/onboarding.md](docs/onboarding.md)**.

## What's here

This repo is **both** marketplace and plugin: the marketplace manifest lives at the root and the plugin lives in [`plugin/`](plugin/).

| Path | What |
|------|------|
| `plugin/` | The plugin — 12 skills, 2 agents, 3 hooks, 2 commands. Inventory and call graph: [docs/skill-graph.md](docs/skill-graph.md). |
| `.claude-plugin/marketplace.json` | Marketplace manifest; points at `./plugin`. |
| `docs/` | [onboarding](docs/onboarding.md) · [skill-graph](docs/skill-graph.md) · [client-context](docs/client-context.md) |
| `scripts/` | `leak-guard.sh`, the consistency guard (`audit/`) and the eval runner (`eval/`). |
| `tests/` | Shell tests for the leak guard, the pre-push hook, profile isolation and the behaviour of the commit commands, `code-reviewer` and `issue-writing`. |
| `.githooks/` | `pre-commit` runs the leak guard; `pre-push` runs gitleaks on the commits being pushed. |

## Keeping client data out

The core must never name a client. `scripts/leak-guard.sh` greps the staged, tracked content for every pattern in a denylist and fails the commit on a match; it fails closed when the denylist is missing, empty or invalid, or when the scan itself errors.

- The denylist lives at `~/.config/gated-delivery/denylist` (override with `GATED_DELIVERY_DENYLIST`), one extended regex per line, and is **never committed** here: the list of client names is itself client data.
- Enable the hooks once per clone: `git config core.hooksPath .githooks`. The pre-push hook needs `gitleaks` on `PATH`.
- CI cannot run the leak guard, because the denylist exists only on your machine. CI runs the guard's own self-test and gitleaks; the client-term check happens at commit time locally.

## Tests

| Command | Needs a login | Proves |
|---------|---------------|--------|
| `bash tests/leak-guard.test.sh` | No | The guard rejects client terms and fails closed without a denylist |
| `bash tests/slice-scripts.test.sh` | No | Parallel slice and batch worktrees are created on their own branches outside the repository, a parallel batch is picked back onto the slice in order or exits 3 on a conflict with the slice untouched, review trees still detach at the tip, and the verify lock never lets two runs overlap, returns the command's status, reclaims a dead holder's lock and times out on a live one |
| `node --test plugin/hooks/*.test.mjs` | No | Hook behaviour |
| `node scripts/audit/consistency.mjs` | No | Inventory, references and docs agree with the files |
| `node --test scripts/audit/*.test.mjs scripts/eval/*.test.mjs` | No | The consistency guard and the eval runner report each defect on a broken fixture and stay quiet on a valid one |
| `node scripts/eval/run-checks.mjs --lint` | No | Every skill's `## Deterministic Checks` command runs |
| `bash tests/pre-push.test.sh` | No | The pre-push hook rejects a push carrying a leak in any pushed commit, leaves the remote unchanged, and lets clean pushes and branch deletions through; skips with exit 3 without `gitleaks` |
| `bash tests/profile-isolation.test.sh [project-dir]` | No | A fresh profile installs the core, loads no client plugin or MCP server, has its own login, and no CLAUDE.md above `project-dir` carries client terms |
| `bash tests/commit-convention.test.sh` | Yes | `/gated-delivery:commit` falls back to Conventional Commits, applies a matching convention, and refuses a missing ticket key |
| `bash tests/code-reviewer-scope.test.sh` | Yes | `code-reviewer` reports an unrequested function under Scope without failing a change whose criteria are met |
| `bash tests/issue-writing.test.sh` | Yes | `issue-writing` refines and creates Stories in the full template, keeps implementation detail out of the behavioural sections and secrets out of the tracker |
| `bash tests/issue-writing.test.sh --control` | Yes | Same scenarios with every skill disabled; expected to fail the checks the skill is responsible for |

Login-bound tests skip with exit 3 when the profile is not logged in. Point them at another profile with `GATED_DELIVERY_TEST_PROFILE=~/.claude-<name>`. Each run starts real `claude -p` sessions on that account.

The verification gate (`verify-on-stop` hook) runs the repo's own lint at turn-end. Knobs: [docs/onboarding.md](docs/onboarding.md#knobs-environment-variables).
