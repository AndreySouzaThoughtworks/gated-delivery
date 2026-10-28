# gated-delivery — install & onboarding

Issue-driven, test-first delivery flow for Claude Code, with no client baked in. Client specifics come from the client's CLAUDE.md — see [client-context.md](../plugin/references/client-context.md).

## Install

Install steps are in the [README](../README.md#install). Install at **user** scope and run `/reload-plugins` afterwards, or the agents stay unregistered in the running session (`agent type not found`). Check with `claude plugin list` for `Scope: user`, then confirm the skills, commands and agents listed in [skill-graph.md](./skill-graph.md) resolve.

## One profile per client or account

Each `CLAUDE_CONFIG_DIR` is a separate Claude Code profile with its own login, plugins, MCP servers, memory and history. Install the core into each profile you use:

```bash
export CLAUDE_CONFIG_DIR=~/.claude-personal
claude                      # run /login once in this profile
claude plugin marketplace add ~/Develop/gated-delivery
claude plugin install gated-delivery@gated-delivery
```

Allow the machine-local notes folder once per profile. Claude Code treats `~/.claude/` and `.git/` as sensitive, so `/slice` keeps its notes and review worktrees in `~/.local/state/gated-delivery/`, which a session may only write once it is listed in the profile's `settings.json`:

```json
{ "permissions": { "additionalDirectories": ["~/.local/state/gated-delivery"] } }
```

Client plugins, MCP servers and the client's CLAUDE.md belong only in that client's profile and folder.

## Per-client setup

Add the sections the client needs to its CLAUDE.md (a folder-level CLAUDE.md above the client's repos works for all of them). Every key has a default, so a client with none still runs; see [client-context.md](../plugin/references/client-context.md) for the table.

## Per-repo setup

`/spec` and `/slice` start from the target repository's instructions, such as root `CLAUDE.md` or `AGENTS.md`, and follow the context and canonical-document references declared there. They require neither fixed documentation paths nor creation of repository context files.

`/spec` gets the required spec structure, including Rollout, from its own `templates/change.md`. A target-repository template contributes only repository-specific additions.

The verify gate (`verify-on-stop`) runs `GATED_DELIVERY_VERIFY_CMD` if set, else the `## Verification` Verify command from the nearest folder-level CLAUDE.md above the repo (a repo's own CLAUDE.md is ignored, since a cloned repo controls it), else the repo's `pnpm lint`; no wiring, no extra package.

## Knobs (environment variables)

| Variable | Default | Effect |
|----------|---------|--------|
| `GATED_DELIVERY_VERIFY_CMD` | `pnpm lint` | Command the Stop verify-hook runs when the working tree is dirty. Point it at a different gate (e.g. `pnpm check`) to override. |
| `GATED_DELIVERY_VERIFY_MAX_BLOCKS` | `3` | How many turns in a row the Stop hook may block before it gives up — stops a stuck loop when the gate can't go green. |
| `GATED_DELIVERY_VERIFY_TIMEOUT_MS` | `600000` | How long the Stop hook lets the verify command run before it kills the command's whole process group and blocks with a timeout message. Zero, negative and non-numeric values fall back to the default. |
| `GATED_DELIVERY_RUN_TIMEOUT_SECONDS` | `1200` | Wall-clock budget for one eval run in `scripts/eval/run-scenarios.mjs`; a run past it is stopped and flagged as a harness failure. |
| `GATED_DELIVERY_RUN_MODEL` | unset | Model passed as `--model` to each eval run in `scripts/eval/run-scenarios.mjs`. The `--model` flag wins. |
| `GATED_DELIVERY_BASE_REF` | `origin/main` for `changed-skills.mjs`; unset for the guard | Git ref a skill change is measured against. The consistency guard checks eval stamps only when it is set; CI sets it on pull requests. |

## What runs automatically (hooks — zero setup)

Three hooks fire on their own: a Bash guard, a formatter after every edit, and a verify gate at turn-end. What each does: [`skill-graph.md`](./skill-graph.md) — one inventory, so hook behaviour can't get described two different ways.

## Running alongside overwatch

The `overwatch` plugin is a watcher: after edits it runs zanity and the tests and feeds failures back to the agent. `verify-on-stop` gates turn-end on the client's Verify command and overwatch gates on its own watchers, so they run different commands and either can be installed alone. Both can block the same turn when both fail.

## Daily use

Which skill to run when, and how they call each other: [skill-graph.md](./skill-graph.md).
