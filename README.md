<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs-site-src/brand/mark.svg">
  <img src="docs-site-src/brand/mark-mono.svg" alt="gated-delivery logo: a stone gate with an emerald gem glowing inside" width="96" height="96">
</picture>

# gated-delivery

**Gate it. Slice it. Prove it.**

A Claude Code plugin that ships one ticket as small slices. Scripts and CI checks guard each slice, so people review the results and the decisions.

[![CI](https://github.com/andrey1souza/gated-delivery/actions/workflows/audit.yml/badge.svg?branch=main)](https://github.com/andrey1souza/gated-delivery/actions/workflows/audit.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<a href="https://andrey1souza.github.io/gated-delivery/"><img src="docs-site-src/brand/og-card.png" alt="The documentation site: a stone gate at dusk. The plate reads gated-delivery, Gate it. Slice it. Prove it." width="720"></a>

</div>

<br>

The [documentation site](https://andrey1souza.github.io/gated-delivery/) walks the repository with examples and real command output. Start with [Why it exists](https://andrey1souza.github.io/gated-delivery/why.html) or [Features](https://andrey1souza.github.io/gated-delivery/features.html).

It ships 12 skills, 3 agents, 2 hooks and 3 commands. No client is baked in. Your `CLAUDE.md` supplies the tracker, the commit convention and the verify command.

## Get started

```text
claude plugin marketplace add andrey1souza/gated-delivery
/plugin install gated-delivery@gated-delivery
/reload-plugins
```

Install at user scope. Then run `/reload-plugins`. Without that reload, the agents stay unregistered in the running session.

To update, run `claude plugin update gated-delivery@gated-delivery`. Then run `/reload-plugins`.

The plugin has no version field. Claude Code uses the commit SHA, so every commit is an update. The plugin hooks run on Node 22 or later. That is the oldest Node release that still gets security fixes. Dev tooling needs Node 22.18 or later, because it strips types. CI tests Node 22 and Node 26.

[Onboarding](docs/onboarding.md) covers one profile per client, the notes folder and the environment variables.

## How a ticket moves

1. **Spec.** `/gated-delivery:spec` turns a ticket into a spec. The spec lists PR-sized slices in order. It writes nothing until you sign off each section.
2. **Slice.** `/gated-delivery:slice` builds one slice at a time. Each slice gets its own branch and pull request. Independent slices run in parallel worktrees.
3. **Prove.** Scripts, a design review and a fresh-context reviewer check the slice. The `code-reviewer` agent sees only the diff and the acceptance criteria. It runs the checks itself.
4. **Merge.** A person merges the pull request. `/slice` never merges. After the merge, run the command again for the next slice.

`/gated-delivery:commit` and `/gated-delivery:commit-push-pr` follow your commit convention. They stage files explicitly and push to an explicit refspec.

The other skills cover tickets, deskchecks, production support and audits of the flow. [Skills, agents and hooks](docs/skill-graph.md) lists every one and shows how they call each other.

## An example

A ticket, `PROJ-202`, asks to cache tenant config in Redis. Run the spec first. Give it the ticket key.

```text
/gated-delivery:spec PROJ-202
```

The skill fetches the ticket through your tracker. It reads your `CLAUDE.md` and the docs that file names. It shows the intent and the acceptance criteria. It asks whether they are the right start before it reads any code.

Then it drafts the spec section by section. The draft stays in the conversation. You sign off every section. Only then does it write `docs/specs/PROJ-202-<slug>.md`. If the repository keeps no planning files, it writes to the notes home that `CLAUDE.md` names.

The file opens like this:

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

The `## Rollout` section lists the slices in order. Each slice names the acceptance criteria it covers. Each slice says whether it ships complete, unwired or behind a flag. Every slice can then merge on its own.

Now run the slice step.

```text
/gated-delivery:slice PROJ-202
```

The skill checks that the working tree is clean. It checks that you are on `main` or on the ticket branch. It plans the batches and asks you to confirm them. Each behaviour gets a failing test before its code. Your verify command runs through a lock, so parallel runs do not collide.

At the end of the slice, the skill validates the work. The `code-reviewer` agent reviews the diff. The skill marks the pull request ready and stops. It never merges. After you merge, run the command again for the next slice.

## What comes from your repository

The plugin never names a client. A skill that needs a client fact reads it from a section of the nearest `CLAUDE.md`. When the section is missing, the skill asks you.

| Section | What it holds |
|---|---|
| `## Issue tracking` | The tracker, how to call it, ticket URLs, issue types |
| `## Commit convention` | Subject, ticket key, branch, remote and PR title rules |
| `## Delivery notes` | Where specs, handoffs and machine-local notes live |
| `## Verification` | The one command that verifies a slice |
| `## Stack recipes`, `## Review routing` | What to load and who reviews, per stack and per job |

The full contract, with defaults, is in [client context](plugin/references/client-context.md).

## Guards

- **`guard-bash`** denies destructive shell commands. It fails closed. When it cannot read or check its input, it blocks the command.
- **`format-on-edit`** formats a file with the prettier of the repository right after Claude edits it. It does nothing when the file type or prettier is missing.

The `overwatch` plugin handles turn-end verification. [Onboarding](docs/onboarding.md#install-overwatch-for-turn-end-verification) shows how to install it.

## Add guardrails to a repository that has none

`/gated-delivery:bootstrap` fills the guardrail gaps of a Python or TypeScript/JavaScript repository on GitHub. It shows a diff. It writes nothing until you confirm each group (`config`, `guards`, `ci`). It never overwrites an existing file. It calls zanity for `zanity init` and the baseline. It prints the overwatch install line and does not install overwatch.

## How it checks itself

This repository holds its own guardrails. Nine status checks are required on `main`. A consistency guard fails when the docs or the settings drift from the files. A table records every fixed mistake next to the rule and the test that now catch it. [How this repo applies exponential engineering](docs/exponential-engineering.md) explains each mechanism and where it falls short. The ideas come from [exponential engineering](https://exponentialengineering.dev/) by Ben O'Mahony and Fabian Nonnenmacher. The [Exponential engineering page](https://andrey1souza.github.io/gated-delivery/exponential-engineering.html) credits them and shows the proof for each idea.

A script grades the docs. It fails a file when fewer than 80% of its sentences have 20 words or fewer. The site build fails when a page drifts from the plugin.

Skill evals are the weak spot. Status of the skill stamps: **0 live, 12 static, 0 waived** of 12 skill stamps.

- A live stamp means a model ran the evals. No skill has one today. Live evals are off because they spend the maintainer's subscription usage.
- A static stamp means the scripts of the skill and its deterministic checks pass. `node scripts/eval/changed-skills.ts --static <skill>` records it with no model run. It does not prove that the model follows the skill.
- A waived stamp records an exception with a reason.

## Where to go next

| To | Read |
|---|---|
| Walk the repository with examples | [Documentation site](https://andrey1souza.github.io/gated-delivery/) |
| Install, set up profiles and knobs | [Onboarding](docs/onboarding.md) |
| See every skill, agent and hook | [Skills, agents and hooks](docs/skill-graph.md) |
| Tell the plugin about your client | [Client context](plugin/references/client-context.md) |
| Run or read the skill evals | [Evals](docs/evals.md) |
| See how each mistake became a rule | [Mistakes to rules](docs/mistakes-to-rules.md) |
| Understand the design and its limits | [Exponential engineering](docs/exponential-engineering.md) |
| Work on this repository | [Developing](docs/development.md) and [AGENTS.md](AGENTS.md) |

## License

[MIT](LICENSE). Reuse it, change it and ship it. Keep the copyright notice.
