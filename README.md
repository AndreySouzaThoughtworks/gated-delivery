<div align="center">

# gated-delivery

**Ship every change in small, verified slices.**

Issue-driven, test-first delivery for Claude Code.<br>
Specs split the work into PR-sized slices. Guards and gates check each one.

[![CI](https://github.com/AndreySouzaThoughtworks/gated-delivery/actions/workflows/audit.yml/badge.svg?branch=main)](https://github.com/AndreySouzaThoughtworks/gated-delivery/actions/workflows/audit.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

<br>

gated-delivery is a Claude Code plugin with no client baked in. A spec turns a tracker ticket into an ordered list of slices that each merge on their own. Implementation runs in focused batches and checks every slice with verification, a structural review and a fresh-context correctness gate before it counts as done. Everything specific to your team, such as the tracker, the commit convention and the reviewers, comes from your repository's `CLAUDE.md`.

It ships 12 skills, 3 agents and 2 hooks, plus three commands.

## Get started

```text
claude plugin marketplace add AndreySouzaThoughtworks/gated-delivery
/plugin install gated-delivery@gated-delivery
/reload-plugins
```

Install at user scope and run `/reload-plugins` afterwards, or the agents stay unregistered in the running session. The hooks run on Node 18 or later. [Onboarding](docs/onboarding.md) covers one profile per client, the notes folder and the environment variables you can set.

## How it works

1. **Spec.** `/gated-delivery:spec` turns a ticket into one spec with an ordered rollout of PR-sized slices. It holds drafts in the conversation and writes nothing until you sign off each section.
2. **Slice.** `/gated-delivery:slice` implements the ticket slice by slice. Independent slices run in parallel worktrees, and each gets its own branch and pull request.
3. **Gate.** Before a slice counts as done, the `code-reviewer` agent runs. It sees only the diff and the acceptance criteria, runs the checks and reports only the gaps that affect correctness.
4. **Commit.** `/gated-delivery:commit` and `/gated-delivery:commit-push-pr` follow your commit convention, stage files explicitly and push to an explicit refspec.

The rest of the skills cover writing tickets, deskchecks, production support and auditing the flow itself. [Skills, agents and hooks](docs/skill-graph.md) lists every one and how they call each other.

## An example

Take a ticket, `PROJ-202`, that asks to cache tenant config in Redis. Run the spec first and give it the ticket key:

```text
/gated-delivery:spec PROJ-202
```

It fetches the ticket through your tracker, reads your `CLAUDE.md` and the docs it points at, and shows you the ticket's intent and acceptance criteria. It asks whether those are the right starting point before it looks at any code. Then it explores the code, drafts the spec section by section and holds the draft in the conversation. Only after you sign off every section does it write one file, `docs/specs/PROJ-202-<slug>.md`, or the notes home your `CLAUDE.md` names when the repository does not keep planning files. The file opens like this and has these sections:

```text
ticket: PROJ-202
type: change
status: Draft
created: YYYY-MM-DD

# PROJ-202 — <short title>

Summary · Relevant files · Red flags · Architecture sketch · Domain model
Acceptance criteria · Interface · Security · Open decisions · Rollout
Edges · Done-when · Outcome
```

`## Rollout` is the part that matters. It lists the slices in order, each with the acceptance criteria it covers and whether it ships complete, unwired or behind a flag, so that every slice can merge on its own. Then run the slice step:

```text
/gated-delivery:slice PROJ-202
```

It checks that your working tree is clean and that you are on `main` or the ticket's own branch. It plans the slice's batches and asks you to confirm them. Each distinct behaviour gets its own failing test before its code, and your verify command runs through a lock so parallel runs do not collide. At the end of the slice it validates, has the `code-reviewer` agent review the diff and marks the pull request ready, and then stops. It never merges anything itself. When you have merged the pull request, run the command again for the next slice.

## What comes from your repository

The plugin never names a client. A skill that needs a client-specific fact reads it from a section of the nearest `CLAUDE.md`, and asks you when the section is missing.

| Section | What it holds |
|---|---|
| `## Issue tracking` | The tracker, how to call it, ticket URLs, issue types |
| `## Commit convention` | Subject, ticket key, branch, remote and PR title rules |
| `## Delivery notes` | Where specs, handoffs and machine-local notes live |
| `## Verification` | The one command that verifies a slice |
| `## Stack recipes`, `## Review routing` | What to load and who reviews, per stack and per job |

The full contract, with defaults, is in [client-context](plugin/references/client-context.md).

## Guards

- **`guard-bash`** denies destructive shell commands. It fails closed: when it cannot read or check its input, it blocks the command.
- **`format-on-edit`** formats a file with the repository's own prettier right after Claude edits it, and does nothing when the file type or prettier is unavailable.

Turn-end verification is left to the `overwatch` plugin, and [onboarding](docs/onboarding.md#install-overwatch-for-turn-end-verification) shows how to install it.

## Add guardrails to a repository that has none

`/gated-delivery:bootstrap` fills the guardrail gaps of a Python or TypeScript/JavaScript repository on GitHub. It shows a diff and writes nothing until you confirm each group (`config`, `guards`, `ci`), and it never overwrites an existing file. It calls zanity for `zanity init` and the baseline, and it prints the overwatch install line without installing it.

## How it checks itself

The repository holds its own guardrails: required status checks on `main`, a consistency guard that fails when the docs, inventory or settings drift from the files, and a table that records every fixed mistake next to the rule and test that now catches it. [How this repo applies exponential engineering](docs/exponential-engineering.md) explains each mechanism and where it falls short.

Skill evals are the weak spot today. **0 live, 12 static, 0 waived** of 12 skill stamps. A static stamp means the skill's scripts and deterministic checks pass, recorded by `node scripts/eval/changed-skills.ts --static <skill>` with no model run; it does not prove the model follows the skill. Live evals are off because they spend the maintainer's subscription usage.

## Where to go next

| To | Read |
|---|---|
| Install, set up profiles and knobs | [Onboarding](docs/onboarding.md) |
| See every skill, agent and hook | [Skills, agents and hooks](docs/skill-graph.md) |
| Tell the plugin about your client | [Client context](plugin/references/client-context.md) |
| Run or read the skill evals | [Evals](docs/evals.md) |
| See how each mistake became a rule | [Mistakes to rules](docs/mistakes-to-rules.md) |
| Understand the design and its limits | [Exponential engineering](docs/exponential-engineering.md) |
| Work on this repository | [Developing](docs/development.md) and [AGENTS.md](AGENTS.md) |

## License

[MIT](LICENSE). Reuse it, change it and ship it, keeping the copyright notice.
