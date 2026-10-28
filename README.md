# gated-delivery

Claude Code plugin for issue-driven, test-first delivery, with no client baked in. Specs define independently merging PR slices; implementation runs focused batches and applies verification, structural review and fresh-context correctness gates at every merge boundary. Everything client-specific — tracker, commit convention, notes homes, stack recipes, reviewers — comes from the client's CLAUDE.md: [plugin/references/client-context.md](plugin/references/client-context.md).

## Install

```text
claude plugin marketplace add AndreySouzaThoughtworks/gated-delivery
/plugin install gated-delivery@gated-delivery
/reload-plugins
```

From a local clone, use its path in the first command instead (`~/Develop/gated-delivery`). Per-profile installs (one `CLAUDE_CONFIG_DIR` per client or account), notes-folder permission and verify knobs: **[docs/onboarding.md](docs/onboarding.md)**.

## What's here

This repo is **both** marketplace and plugin: the marketplace manifest lives at the root and the plugin lives in [`plugin/`](plugin/).

| Path | What |
|------|------|
| `plugin/` | The plugin — 12 skills, 2 agents, 3 hooks, 2 commands. Inventory and call graph: [docs/skill-graph.md](docs/skill-graph.md). |
| `.claude-plugin/marketplace.json` | Marketplace manifest; points at `./plugin`. |
| `docs/` | [onboarding](docs/onboarding.md) · [skill-graph](docs/skill-graph.md) · [evals](docs/evals.md) · [client-context](plugin/references/client-context.md) |
| `scripts/` | `leak-guard.sh`, the consistency guard (`audit/`) and the eval tools (`eval/`). |
| `evals/` | `fixtures/`: run directories for eval scenarios that need more than a persona, kept outside `plugin/` so installs do not carry them. `results/`: one stamp or waiver per skill whose evals were run or waived. |
| `tools/claude-code/` | The pinned `claude` CLI that the dormant CI evals job installs. |
| `tests/` | Shell tests for the leak guard, the pre-push hook, the slice scripts, profile isolation and the behaviour of the commit commands, `code-reviewer` and `issue-writing`. |
| `.githooks/` | `pre-commit` runs the leak guard; `pre-push` runs gitleaks on the commits being pushed. |
| `.github/` | CI workflows and `CODEOWNERS` for the files that hold the rules. |
| `zanity.toml`, `lychee.toml`, `.shellcheckrc` | Settings of the strict checks below. |

## Checks every change passes

`main` requires these seven status checks, for admins too, and allows no force push:

| Check | Runs |
|-------|------|
| `zanity` | `zanity check . --fail-on warning --strict`, pinned to one release |
| `consistency` | The consistency guard, the hook, guard and eval-tool unit tests, `run-checks --lint`, the leak guard's self-test and the slice script tests |
| `workflows` | `actionlint` and `zizmor --pedantic` on `.github/` |
| `shell` | `shellcheck` at its strictest on every shell file |
| `links` | `lychee` on the README, `docs/` and `plugin/` markdown |
| `spelling` | `typos` on defaults |
| `gitleaks` | Secret scan |

The rules guard themselves. The consistency guard fails if `zanity.toml` drops `select = ["all"]`, disables anything beyond `assertion-density` (and the process and filesystem rules for test files), or excludes more than the fixtures. It also fails on an `assert`, `if` or `while` whose condition cannot vary, since a check that cannot fail proves nothing, and on a skill that changed without a passing eval stamp or a recorded waiver. The guard's own sections are listed in `scripts/audit/consistency.mjs`.

## Keeping client data out

The core must never name a client. `scripts/leak-guard.sh` greps the staged, tracked content for every pattern in a denylist and fails the commit on a match; it fails closed when the denylist is missing, empty or invalid, or when the scan itself errors. The one exception is a well-formed base64 value of an `"integrity": "sha512-…"` line in a `package-lock.json` under `evals/fixtures/`, where a short term can match by chance; `npm ci` verifies those hashes against the registry, each skip is printed, and the rest of the lockfile is scanned as usual.

- The denylist lives at `~/.config/gated-delivery/denylist` (override with `GATED_DELIVERY_DENYLIST`), one extended regex per line, and is **never committed** here: the list of client names is itself client data.
- Enable the hooks once per clone: `git config core.hooksPath .githooks`. The pre-push hook needs `gitleaks` on `PATH`.
- CI cannot run the leak guard, because the denylist exists only on your machine. CI runs the guard's own self-test and gitleaks; the client-term check happens at commit time locally.

## Skill evals

Each skill's `evals.md` holds scenarios and a `## Deterministic Checks` fence. Checks read the final answer, the pages a run delivered and the run's tool calls; a judge grades only the clauses no check can decide, and is skipped for a scenario with none. Details and cost levers: [docs/evals.md](docs/evals.md).

- Before a PR that changes a skill, run `node scripts/eval/changed-skills.mjs`. It finds the changed skills, runs a smoke tier (the fewest scenarios that exercise every check) once, reruns only failures, caps spend per run and in total, and writes `evals/results/<skill>.json` when everything passes. Exit codes: 0 passed, 1 failed, 2 usage, 3 not run.
- CI checks the stamp for each skill the PR changed. Without working credentials, `--waive <skill> --reason "<text>"` records an exception for the current skill hash; the guard shows it as a warning, and a later change to the skill needs a new waiver or a real run.
- Runs ignore the login stored in your user settings, so they need a working `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. The `evals.yml` workflow does the same on PRs and stays dormant until that secret exists.

## Tests

| Command | Needs a login | Proves |
|---------|---------------|--------|
| `bash tests/leak-guard.test.sh` | No | The guard rejects client terms, skips only well-formed integrity hashes in fixture lockfiles and logs each skip, and fails closed without a denylist |
| `bash tests/slice-scripts.test.sh` | No | Parallel slice and batch worktrees stay isolated, claims are create-only, batches are picked back in order, and the verify lock serializes runs |
| `bash tests/pre-push.test.sh` | No | The pre-push hook rejects a push carrying a leak in any pushed commit and lets clean pushes and branch deletions through |
| `node --test plugin/hooks/*.test.mjs scripts/audit/*.test.mjs scripts/eval/*.test.mjs` | No | Hook behaviour, the consistency guard and the eval tools on broken and valid fixtures |
| `node scripts/audit/consistency.mjs` | No | Inventory, references, docs, settings and eval stamps agree with the files |
| `node scripts/eval/run-checks.mjs --lint` | No | Every skill's `## Deterministic Checks` command runs and every `# expect:` line names a scenario |
| `node scripts/eval/run-scenarios.mjs <skill> [--scenario <id>…]` | Yes | Runs eval scenarios as real `claude -p` sessions and writes each run's grades to `summary.tsv` |
| `bash tests/profile-isolation.test.sh [project-dir]` | No | A fresh profile installs the core, loads no client plugin or MCP server and has its own login |
| `bash tests/commit-convention.test.sh`, `tests/code-reviewer-scope.test.sh`, `tests/issue-writing.test.sh` | Yes | The commit command follows the convention, `code-reviewer` reports scope creep, `issue-writing` keeps secrets out of the tracker |

Login-bound tests skip with exit 3 when the profile is not logged in. Point them at another profile with `GATED_DELIVERY_TEST_PROFILE=~/.claude-<name>`.

The verification gate (`verify-on-stop` hook) runs the repo's own lint at turn-end. Knobs: [docs/onboarding.md](docs/onboarding.md#knobs-environment-variables).
