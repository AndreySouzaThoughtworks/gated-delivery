# gated-delivery — install & onboarding

Issue-driven, test-first delivery flow for Claude Code, with no client baked in. Client specifics come from the client's CLAUDE.md — see [client-context.md](../plugin/references/client-context.md).

## Install

Install steps are in the [README](../README.md#get-started). Install at **user** scope and run `/reload-plugins` afterwards, or the agents stay unregistered in the running session (`agent type not found`). To update later, run `claude plugin update gated-delivery@gated-delivery` or `/plugin update`, then `/reload-plugins`. Check with `claude plugin list` for `Scope: user`, then confirm the skills, commands and agents listed in [skill-graph.md](./skill-graph.md) resolve.

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

## Knobs (environment variables)

| Variable | Default | Effect |
|----------|---------|--------|
| `GATED_DELIVERY_VERIFY_CMD` | unset | Verify command `/slice` and `code-reviewer` run. Without it they read the `## Verification` Verify command from the nearest folder-level CLAUDE.md above the repo (a repo's own CLAUDE.md is ignored, since a cloned repo controls it), else the repo's own checks. |
| `GATED_DELIVERY_RUN_TIMEOUT_SECONDS` | `1200` | Wall-clock budget for one eval run in `scripts/eval/run-scenarios.ts`; a run past it is stopped and flagged as a harness failure. |
| `GATED_DELIVERY_RUN_MODEL` | unset | Model passed as `--model` to each eval run in `scripts/eval/run-scenarios.ts`. The `--model` flag wins. |
| `GATED_DELIVERY_GUARD` | unset | Set to `off` only when the Bash guard itself is broken and blocks every command: it then allows everything, so unset it once the guard is fixed. Set it in the environment that starts Claude Code; writing it inside a command does nothing. |
| `GATED_DELIVERY_BASE_REF` | `origin/main` for `changed-skills.ts`; unset for the guard | Git ref a skill change is measured against. The consistency guard checks eval stamps only when it is set; CI sets it on pull requests. |
| `GATED_DELIVERY_ALLOW_LIVE_CLAUDE` | unset | Set to `1` to let `tests/commit-convention.test.sh`, `tests/code-reviewer-scope.test.sh` and `tests/issue-writing.test.sh` start. Each launches real `claude -p` sessions that spend your logged-in subscription, so each exits 64 without it. |

## What runs automatically (hooks — zero setup)

Two hooks fire on their own: a Bash guard and a formatter after every edit. What each does: [`skill-graph.md`](./skill-graph.md) — one inventory, so hook behaviour can't get described two different ways.

## Install overwatch for turn-end verification

gated-delivery has no Stop gate. The `overwatch` plugin replaces it:

```
/plugin install overwatch --marketplace benomahony/overwatch
```

overwatch runs the repo's tests in watch mode and hands failures back to the agent. It keeps completion guarded while the build is red, ignores findings the repo already had (the baseline), and can gate protected actions such as pushing through `.overwatch.json`. When `zanity` is on `PATH` it runs zanity beside the tests and treats any zanity error or warning as a failure.

### When an agent is stuck on a failure it cannot fix

If a red build is one the agent cannot fix (a broken environment, a failure outside the repo), overwatch keeps completion guarded, so the agent cannot finish. Put this in `.overwatch.json` at the project root:

```json
{ "enabled": false }
```

It turns overwatch off for the project, and that includes the zanity watcher. Treat it as a change that needs review: `plugin/bootstrap/guards/rules-about-rules.mjs`, which ships to client repos, fails a repo whose `.overwatch.json` sets `"enabled": false`. Remove the file once the build is fixed.

## Daily use

Which skill to run when, and how they call each other: [skill-graph.md](./skill-graph.md).
