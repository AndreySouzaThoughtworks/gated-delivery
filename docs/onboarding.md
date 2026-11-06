# gated-delivery — install and onboarding

gated-delivery is an issue-driven, test-first delivery flow for Claude Code. It has no client baked in. Client facts come from the `CLAUDE.md` of the client. See [client-context.md](../plugin/references/client-context.md). For a tour with examples, open the [guide](guide.html).

## Install

The install steps are in the [README](../README.md#get-started). Install at **user** scope. Then run `/reload-plugins`. Without it, the agents stay unregistered in the running session, and Claude Code reports `agent type not found`.

To update later, run `claude plugin update gated-delivery@gated-delivery` or `/plugin update`. Then run `/reload-plugins`.

To check the install, run `claude plugin list` and look for `Scope: user`. Then confirm that the skills, commands and agents in [skill-graph.md](./skill-graph.md) resolve.

The plugin has no `version` field. Every commit on `main` is a new version. Run the update command to get it.

## Node

The plugin hooks and scripts run as `node file.mjs` on your machine. They need Node 22 or later. That is the oldest Node release that still gets security fixes. Node 18 and 20 are end of life.

You need Node 22.18 or later only to work on this repository. That version strips TypeScript types, so the dev scripts run with no build step.

## One profile per client or account

Each `CLAUDE_CONFIG_DIR` is a separate Claude Code profile. It has its own login, plugins, MCP servers, memory and history. Install the core into each profile you use:

```bash
export CLAUDE_CONFIG_DIR=~/.claude-personal
claude                      # run /login once in this profile
claude plugin marketplace add ~/Develop/gated-delivery
claude plugin install gated-delivery@gated-delivery
```

Allow the machine-local notes folder once per profile. Claude Code treats `~/.claude/` and `.git/` as sensitive. So `/slice` keeps its notes and review worktrees in `~/.local/state/gated-delivery/`. A session may write there only after the profile's `settings.json` lists it:

```json
{ "permissions": { "additionalDirectories": ["~/.local/state/gated-delivery"] } }
```

Keep client plugins, MCP servers and the client `CLAUDE.md` in that client's profile and folder only.

## Per-client setup

Add the sections that the client needs to its `CLAUDE.md`. A folder-level `CLAUDE.md` above the client's repositories works for all of them. Every key has a default, so a client with no sections still runs. [client-context.md](../plugin/references/client-context.md) has the table.

## Per-repo setup

`/spec` and `/slice` start from the instructions of the target repository, such as the root `CLAUDE.md` or `AGENTS.md`. They follow the context and canonical-document references declared there. They need no fixed documentation paths. They never create context files.

`/spec` takes the required spec structure, including Rollout, from its own `templates/change.md`. A template in the target repository adds repository-specific parts only.

## Knobs (environment variables)

| Variable | Default | Effect |
|----------|---------|--------|
| `GATED_DELIVERY_VERIFY_CMD` | unset | Verify command that `/slice` and `code-reviewer` run. Without it they read the `## Verification` Verify command from the nearest folder-level CLAUDE.md above the repo (a repo's own CLAUDE.md is ignored, since a cloned repo controls it), else the repo's own checks. |
| `GATED_DELIVERY_NOTES_REPO` | unset | Local checkout of the separate notes repository. `notes-repo.mjs prepare` uses it before it clones one. Its `origin` must be the repository of `--repo-name`. Otherwise `prepare` exits 5. |
| `GATED_DELIVERY_VERIFY_LOCK` | `~/.local/state/gated-delivery/verify.lock` | Lock file that serializes verify runs in parallel slice trees. |
| `GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S` | `1800` | Seconds a verify run waits for the lock. |
| `GATED_DELIVERY_RUN_TIMEOUT_SECONDS` | `1200` | Wall-clock budget for one eval run in `scripts/eval/run-scenarios.ts`. A run past it is stopped and flagged as a harness failure. |
| `GATED_DELIVERY_RUN_MODEL` | unset | Model passed as `--model` to each eval run in `scripts/eval/run-scenarios.ts`. The `--model` flag wins. |
| `GATED_DELIVERY_GUARD` | unset | Set to `off` only when the Bash guard itself is broken and blocks every command. It then allows everything, so unset it once the guard works. Set it in the environment that starts Claude Code. Writing it inside a command does nothing. |
| `GATED_DELIVERY_BASE_REF` | `origin/main` for `changed-skills.ts`; unset for the guard | Git ref that a skill change is measured against. The consistency guard checks eval stamps only when it is set. CI sets it on pull requests. |
| `GATED_DELIVERY_ALLOW_LIVE_CLAUDE` | unset | Set to `1` to let `tests/commit-convention.test.sh`, `tests/code-reviewer-scope.test.sh` and `tests/issue-writing.test.sh` start. Each launches real `claude -p` sessions that spend your logged-in subscription, so each exits 64 without it. |
| `GATED_DELIVERY_ALLOW_LIVE_GH` | unset | Set to `1` to let `tests/live-gh.test.sh` start: `GATED_DELIVERY_ALLOW_LIVE_GH=1 bash tests/live-gh.test.sh`. It creates one branch and one draft pull request in a private sandbox repository, then closes and deletes them. It exits 64 without the variable. |
| `GATED_DELIVERY_GH_SANDBOX` | `AndreySouzaThoughtworks/aifsd-e2e-sandbox` | The `<owner>/<name>` repository that `tests/live-gh.test.sh` writes to. It must be private, not a fork, and have `sandbox` in its name. Otherwise the test exits 65 before any write. |

## What runs automatically (hooks, zero setup)

Two hooks fire on their own: a Bash guard and a formatter after every edit. [`skill-graph.md`](./skill-graph.md) describes each one. It is the only place that does, so the behaviour cannot be described two ways.

## Cursor

Cursor follows the same rules and guards as Claude Code in this repository. `AGENTS.md` holds the rules. `.cursor/hooks.json` runs adapters over the same two plugin hooks. [development.md](development.md#cursor) has the details.

## Install overwatch for turn-end verification

gated-delivery has no Stop gate. The `overwatch` plugin replaces it:

```
/plugin install overwatch --marketplace benomahony/overwatch
```

overwatch runs the tests of the repository in watch mode and hands failures back to the agent. It keeps completion guarded while the build is red. It ignores findings that the repository already had (the baseline). It can gate protected actions, such as a push, through `.overwatch.json`. When `zanity` is on `PATH`, overwatch runs it beside the tests and treats any zanity error or warning as a failure.

### When an agent is stuck on a failure it cannot fix

A red build can be one that the agent cannot fix, such as a broken environment or a failure outside the repo. Then overwatch keeps completion guarded, and the agent cannot finish. Put this in `.overwatch.json` at the project root:

```json
{ "enabled": false }
```

It turns overwatch off for the project, and that includes the zanity watcher. Treat it as a change that needs review. `plugin/bootstrap/guards/rules-about-rules.mjs` ships to client repos. It fails a repo whose `.overwatch.json` sets `"enabled": false`. Remove the file once the build works.

## Daily use

[skill-graph.md](./skill-graph.md) shows which skill to run when and how the skills call each other. The [guide](guide.html) walks through worked examples.
