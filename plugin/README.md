# gated-delivery plugin

This folder is the Claude Code plugin. It holds an issue-driven, test-first delivery flow. The orchestration skills work with any stack. The stack recipes and reviewers they call come from the `CLAUDE.md` of the client (see [client-context](references/client-context.md)). To install it, follow [onboarding](../docs/onboarding.md).

## What it ships

[`docs/skill-graph.md`](../docs/skill-graph.md) is the one inventory. It lists what ships, what each piece does and how the pieces call each other. `scripts/audit/consistency.ts` keeps it true in CI.

| Folder | Holds |
|---|---|
| `skills/` | One folder per skill: `SKILL.md`, `evals.md` and optional templates and scripts |
| `agents/` | The `slice-executor`, `code-reviewer` and `scout` agents |
| `commands/` | The commands `bootstrap`, `commit` and `commit-push-pr` |
| `hooks/` | `guard-bash.mjs` and `format-on-edit.mjs`, wired in `hooks.json` |
| `scripts/` | Node scripts that skills call to make checks deterministic |
| `bootstrap/` | The plans, guards and templates that `/gated-delivery:bootstrap` writes into a client repo |
| `references/` | Domain knowledge that skills read through an index |

## Dev flow at a glance

1. `/slice` starts or resumes a ticket. It runs `/spec` when no spec exists.
2. Each Rollout slice gets one branch and one PR.
3. A `slice-executor` agent builds each functional batch.
4. Batch tests and a targeted review follow each batch.
5. At the end of a slice, validators, full verification, the structural lens and the fresh-context correctness review run.
6. You merge the PR. Then the next slice starts.

The format hook and the guard hook run underneath the whole loop.

## Scripts that skills call

Every script is plain `node file.mjs`. Each one has a colocated test. Skills call them so that a rule becomes an exit code, not a promise.

| Script | Job |
|---|---|
| `slice-state.mjs` | Routes a ticket from the spec, Git and the handoff |
| `slice-claim.mjs` | Claims a slice with a create-only push |
| `slice-cleanup.mjs` | Removes the trees and branches of merged slices |
| `notes-repo.mjs` | Prepares and publishes a separate notes repository |
| `handoff.mjs` | Writes the resume block and closes the handoff |
| `batch-audit.mjs` | Audits the commits of one executor batch |
| `executor-preflight.mjs` | Checks the spec and the tree before an executor starts |
| `ticket-lint.mjs` | Lints a ticket draft against its kind |
| `pr-gate.mjs` | Checks a PR body, its title and its open review threads |
| `primer-lint.mjs` | Lints a primer page against the template |
| `commit-plan.mjs` | Plans a commit from the client's convention |
| `verify-citations.mjs` | Checks that every citation of the `scout` agent is true |

## Dependencies and knobs

- **A verify command.** `/slice` and `code-reviewer` run `GATED_DELIVERY_VERIFY_CMD`. Without it they read the Verify command in `## Verification`. Without that they use the checks of the repository. See [knobs](../docs/onboarding.md#knobs-environment-variables).
- **`senior-review-lens`.** It ships in this plugin. It is the one canonical copy of the 8 lenses, so every repository runs the same version.
- **Stack recipes and validator agents.** They are not bundled. Each client names its own under `## Stack recipes` and `## Review routing`.
