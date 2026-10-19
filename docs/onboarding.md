# gated-delivery — install & onboarding

Issue-driven, test-first delivery flow for Claude Code, with no client baked in. Client specifics come from the client's CLAUDE.md — see [client-context.md](./client-context.md).

## Install

From a local checkout (directory marketplace):

```text
claude plugin marketplace add ~/Develop/gated-delivery
/plugin install gated-delivery@gated-delivery
/reload-plugins
```

Skipping `/reload-plugins` leaves the agents unregistered in the running session (`agent type not found`). Install at **user** scope, or the skills exist only in the repo you installed from; check with `claude plugin list` for `Scope: user`.

Verify: `/slice`, `/spec`, `/repo-forensics`, `/senior-review-lens`, `/prod-support`, `/renovate-shepherd`, `/learn-flow`, `/audit-flow`, `/primer`, `/issue-writing`, `/prose-writing`, `/story-drift` resolve, and `Agent(code-reviewer)` / `Agent(slice-executor)` are available.

### One profile per client or account

Each `CLAUDE_CONFIG_DIR` is a separate Claude Code profile with its own login, plugins, MCP servers, memory and history. Install the core into each profile you use:

```bash
export CLAUDE_CONFIG_DIR=~/.claude-personal
claude                      # run /login once in this profile
claude plugin marketplace add ~/Develop/gated-delivery
claude plugin install gated-delivery@gated-delivery
```

Allow the machine-local notes folder once per profile. Claude Code treats `~/.claude/` and `.git/` as sensitive, so `/slice` keeps its notes and review worktrees in `~/.local/state/aifsd/`, which a session may only write once it is listed in the profile's `settings.json`:

```json
{ "permissions": { "additionalDirectories": ["~/.local/state/aifsd"] } }
```

Client plugins, MCP servers and the client's CLAUDE.md belong only in that client's profile and folder.

## Per-client setup

Add the sections the client needs to its CLAUDE.md (a folder-level CLAUDE.md above the client's repos works for all of them). Every key has a default, so a client with none still runs; see [client-context.md](./client-context.md) for the table.

## Per-repo setup

`/spec` and `/slice` start from the target repository's instructions, such as root `CLAUDE.md` or `AGENTS.md`, and follow the context and canonical-document references declared there. They require neither fixed documentation paths nor creation of repository context files.

`/spec` gets the required spec structure, including Rollout, from its own `templates/change.md`. A target-repository template contributes only repository-specific additions.

The verify gate (`verify-on-stop`) runs `AIFSD_VERIFY_CMD` if set, else the `## Verification` Verify command from the nearest folder-level CLAUDE.md above the repo (a repo's own CLAUDE.md is ignored, since a cloned repo controls it), else the repo's `pnpm lint`; no wiring, no extra package.

## Knobs (environment variables)

| Variable | Default | Effect |
|----------|---------|--------|
| `AIFSD_VERIFY_CMD` | `pnpm lint` | Command the Stop verify-hook runs when the working tree is dirty. Point it at a different gate (e.g. `pnpm check`) to override. |
| `AIFSD_VERIFY_MAX_BLOCKS` | `3` | How many turns in a row the Stop hook may block before it gives up — stops a stuck loop when the gate can't go green. |

## What runs automatically (hooks — zero setup)

Three hooks fire on their own: a Bash guard, a formatter after every edit, and a verify gate at turn-end. What each does: [`skill-graph.md`](./skill-graph.md) — one inventory, so hook behaviour can't get described two different ways.

## Daily use

- Start a ticket: `/slice PROJ-123`. It routes by state (no spec → `/spec` first; resume; etc.).
- Trivial one-line change? `/slice` has a step-0 escape hatch — straight to change + PR, no spec or slicing. It runs a `/repo-forensics` quick look first, so "trivial" is checked, not assumed.
- About to touch existing code outside a ticket? `/repo-forensics` — what's verified vs inferred, what could break, the smallest safe next step. Stops before writing code.
- Production incident: `/prod-support <ticket>`.
- Renovate cleanup: `/renovate-shepherd`.
- At a session break: `/learn-flow` to capture lessons back into the flow. Before a release (or when it feels bloated): `/audit-flow` to trim and keep it coherent.
