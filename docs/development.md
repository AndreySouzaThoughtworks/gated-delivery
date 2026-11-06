# Developing gated-delivery

This page shows how the repository is laid out, which checks every change passes and how to run the tests. For what the plugin does and how to install it, see the [README](../README.md). For a tour with examples, open the [guide](guide.html).

## Repository layout

This repo is **both** the marketplace and the plugin. The marketplace manifest lives at the root. The plugin lives in [`plugin/`](../plugin/).

| Path | What |
|------|------|
| `plugin/` | The plugin: 12 skills, 3 agents, 2 hooks, 3 commands. Inventory and call graph: [docs/skill-graph.md](skill-graph.md). |
| `plugin/scripts/` | The Node scripts that skills call, each with a colocated test. |
| `.claude-plugin/marketplace.json` | Marketplace manifest. It points at `./plugin`. |
| `docs/` | [guide](guide.html) · [onboarding](onboarding.md) · [skill-graph](skill-graph.md) · [evals](evals.md) · [exponential-engineering](exponential-engineering.md) · [mistakes-to-rules](mistakes-to-rules.md) · [client-context](../plugin/references/client-context.md) |
| `scripts/` | `leak-guard.sh`, the consistency guard and its helpers (`audit/`), the eval tools (`eval/`), the Cursor adapters (`cursor/`) and CI helpers (`ci/`). |
| `evals/` | `fixtures/` holds run directories for eval scenarios. `results/` holds one stamp or waiver per skill. `rules/` holds one rule inventory per instruction file. `token-budget.json` holds the token budgets. |
| `tools/claude-code/` | The pinned `claude` CLI that the dormant CI evals job installs. |
| `tests/` | Shell tests for the leak guard, the pre-push hook, the slice scripts, profile isolation and the live-test opt-in. Login-bound tests cover the commit commands, `code-reviewer` and `issue-writing`. |
| `.githooks/` | `pre-commit` runs the leak guard. `pre-push` runs gitleaks on the commits being pushed. |
| `.cursor/`, `AGENTS.md` | The Cursor config and the one source of the repo rules. |
| `.github/` | CI workflows and `CODEOWNERS` for the files that hold the rules. |
| `zanity.toml`, `lychee.toml`, `.typos.toml`, `.shellcheckrc` | Settings of the strict checks below. |

Fixtures stay outside `plugin/`. Installs do not carry them.

## Checks every change passes

`main` requires these nine status checks, for admins too. It allows no force push.

| Check | Runs |
|-------|------|
| `zanity` | `zanity check . --fail-on warning --strict`, pinned to one release |
| `consistency` | One matrix job on Node 22. It runs the steps in `.github/workflows/audit.yml`: `tsc`, the consistency guard, the lint scripts, the unit tests of hooks, scripts, bootstrap and evals, `run-checks --lint`, the leak guard self-test, the slice script tests, the live-test opt-in test and the pre-push hook test |
| `workflows` | `actionlint` and `zizmor --pedantic` on `.github/` |
| `shell` | `shellcheck` at its strictest on every shell file |
| `Links (lychee)` | `lychee` on the README, `docs/` and `plugin/` markdown, and on the guide |
| `Spelling (typos)` | `typos` with `.typos.toml`. It excludes the generated assertion baseline and allows the ordinal suffix `nd`. |
| `gitleaks` | Secret scan |
| `node 26` | The same matrix job on Node 26 |
| `assertion effectiveness` | `scripts/audit/assertion-effectiveness.ts`: every assertion in non-test code must make some test fail. Its baseline is empty. |

`consistency` and `node 26` are two entries of one job in `.github/workflows/audit.yml`. So the two cannot drift. Check 29 fails when a second job runs the consistency guard or an entry loses its name.

The `evals` workflow is dormant. It is not a required check.

## Node policy

The plugin hooks and scripts run as `node file.mjs` on the client machine. So the plugin floor is the oldest Node release that still gets security fixes. Today that is Node 22. It reaches end of life on 2027-04-30. Node 18 and 20 are end of life, and no job tests them.

`package.json` `engines` states the floor for dev tooling: Node 22.18 or later. That release strips TypeScript types, so `scripts/` runs with no build step. CI tests Node 22 and Node 26.

Check 31 (`scripts/audit/node-floor.ts`) enforces the policy. It fails when the floor reaches its end-of-life date in `NODE_END_OF_LIFE`. It fails when a document names another floor. It fails when the README states no floor.

## The rules guard themselves

The consistency guard is `node scripts/audit/consistency.ts`. It prints one `ERROR` line per problem, and each line names the file and ends with a `Hint:`. The numbered sections in that file are the true list of checks. This table groups them.

| Topic | Checks | What fails |
|-------|--------|------------|
| Inventory | 1 to 6, 9, 12 to 14 | A skill, agent, command or hook that lacks its files, its name match, its description, its test or its row in `docs/skill-graph.md`. A count in the docs that differs from the files. |
| References | 6a to 6c, 11, 12 | A doc that names a skill, agent or script that does not exist. A broken path from a skill. |
| Prose rules | 6e | A banned phrase from `plugin/skills/prose-writing/writing.md` in a skill or agent. |
| Eval files | 6d, 7, 10, 10a | An `evals.md` with no runnable fence, no scenario row or a repeated scenario id. An eval check that cannot fail. |
| Manifests | 4, 15, 19, 24 | A pinned `version` in either manifest. A missing license. |
| Rules about rules | 8, 17, 22, 23, 26 | A loosened `zanity.toml`. A condition that cannot vary. A gap or repeat in the check numbers. A missing `tsc` flag. A model pinned on an agent that is not the scout. |
| Eval status | 18, 25, 27 | A changed skill with no matching stamp. A README stamp line that is not true. A rule deleted from an inventoried instruction file. |
| Cost | 28 | An instruction file over its token budget. |
| CI and config | 16, 20, 21, 29, 30 | An undocumented `GATED_DELIVERY_` variable. Plugin code that imports TypeScript. A Cursor config that points at a missing script. A second job that repeats the guard. A live test with no opt-in guard. |
| Node | 31 | A floor at end of life, or a document that names another floor. |
| Messages | 32 | A new failure message that is not actionable. |
| Docs | 33, 34 | A document with too many long sentences. A guide that drifted from the plugin. |

Skill-eval checks need a base ref. Set `GATED_DELIVERY_BASE_REF=origin/main` to run check 18 locally.

### Lint scripts

Each script prints `file:line`, the rule and a fix.

- `scripts/audit/suppressions.ts` fails a lint, type or coverage suppression that lacks `<marker> -- <reason of four or more meaningful words>`. A zanity ignore must name exactly one rule. An `assertion-density` ignore starts with a reason code from `scripts/audit/suppression-reason-codes.ts`, then a colon and a specific reason. The count must equal `scripts/audit/suppressions.count`. A reviewer must accept a rise in that count.
- `scripts/audit/jsdoc-types-only.ts` fails a JSDoc block in a shipped `plugin/**/*.mjs` file that holds prose. Only type tags are allowed.
- `scripts/audit/comments.ts` fails a comment in a tracked `.ts`, `.mjs`, `.js` or `.cjs` file under `plugin/`, `scripts/` or `tests/` that tells history. Fixtures are excluded.
- `scripts/audit/assertion-effectiveness.ts` copies the tracked files to a temp directory and instruments every `assert(...)` in non-test code. It runs the tests and lists each assertion that no test made fail. It fails on any such assertion that is missing from `assertion-effectiveness-baseline.json`. That baseline only shrinks.
- `scripts/audit/message-actionability.ts` reads every failure message in the scripts, hooks and audit tools. See [Message actionability](#message-actionability).
- `scripts/audit/asd-style.ts` grades the prose. See [Docs style](#docs-style).

The comment check knows five rules: `temporal-contrast`, `change-narration`, `bug-history`, `tracker-reference` and `dated-note`. Each one matches phrases, so it cannot catch every retelling of history. A reviewer still applies the rule in `AGENTS.md`. There is no allowlist. Rewrite the comment in the present tense instead.

### zanity and its baseline

zanity runs against `zanity-baseline.json` with `--new-only --agent`. Versions 0.1.30 and 0.1.39 panic in their plain output when a baseline is used outside an agent. The baseline is empty today. Any new finding fails the build.

`plugin/bootstrap/guards/ratchet.mjs` fails a pull request whose baseline holds more findings than its base. It also fails a pull request that holds more findings of one kind. A kind is the rule, the message and the file name without directory or extension. The baseline only shrinks, by fixing the code it lists.

### Message actionability

A failure message is actionable when it does four things. It names a file, a line or the offending value. It states the violated rule. It ends with a fix as an imperative after `;`, `.` or `Hint:`. It has 40 words or fewer.

The judge is `actionabilityProblems` in `plugin/scripts/run-cli.test.support.mjs`. It is a regex proxy. The tests of each guard also apply it to their real output through `assertActionable`.

The messages that still fail are frozen in `message-actionability-baseline.json`. Check 32 fails a new non-actionable message. It also fails a baseline entry that is now actionable and a baseline that is larger than its base ref. After you rewrite a message, run `node scripts/audit/message-actionability.ts --update-baseline`.

### Docs style

Every document must keep 80% or more of its sentences within 20 words. `scripts/audit/asd-style.ts` grades `README.md`, `AGENTS.md`, `plugin/README.md`, `docs/*.md` and the visible text of `docs/guide.html`.

The check ignores code blocks, inline code, tables, headings and link targets. It treats each list item as one sentence. The constants `MAX_SENTENCE_WORDS` and `MIN_SHORT_SENTENCE_PERCENT` set the limits.

When a file fails, the message lists the five longest sentences with line numbers. Split each one. `node scripts/audit/asd-style-report.ts` prints the share for every file.

### The guide

Check 34 (`scripts/audit/guide-freshness.ts`) keeps [`docs/guide.html`](guide.html) true. It fails when the guide is missing. It fails when the guide does not name every skill, agent and command under `plugin/`. It fails when the guide states a count of skills, agents, commands or hooks that differs from the real count. It fails when the README does not link the guide. It ignores counts inside `<pre>` blocks, because those blocks quote script output.

## Token budget

Instruction text is the main runtime cost of the plugin. Every skill, agent and command body loads into a session when it runs. The `name: description` line of each one is in context every session.

`node scripts/audit/token-budget.ts` prints the size of each skill body (`SKILL.md`), agent, command, `plugin/references/*.md` file and skill resource. A skill resource is markdown that a skill loads on demand from its `templates/`, `workflows/` and `trackers/` folders. The largest come first. The output ends with one `always-in-context listing` total.

Every number is an estimate. `estimateTokens` in `scripts/audit/token-budget/budget.ts` divides the characters by four and rounds up. It uses no tokenizer and calls no API. It differs from a real count but moves the same way as the text, and a ratchet needs only that.

`evals/token-budget.json` holds a budget per file. Check 28 fails when a file is over its budget. It fails when a file has no budget. It fails when a budget names a missing file. It fails when a file is more than 2 percent under its budget. After a trim, or when a PR has a reason to grow a file, run `node scripts/audit/token-budget.ts --update-baseline` and commit the new file. A PR that raises a budget must say why.

## Rule inventories

Live evals are off, so nothing else notices when a prose trim deletes a rule. A rule inventory under `evals/rules/` lists the load-bearing rules of one skill, agent or command. Each rule has a literal anchor. Check 27 fails when an anchor is gone from its file.

Check 27 also scans the other markdown files under `plugin/skills/`. It skips `SKILL.md`, which has its own inventory, and `evals.md`, which holds scenarios. A marker line (`never`, `STOP`, `CHECKPOINT` and the like) that no rule covers is an error. [docs/evals.md](evals.md#rule-inventory) shows how to write an inventory.

An inventory proves that the text is present. It does not prove that the model follows the rule.

## Cursor

Cursor follows the same rules and guards as Claude Code here. `AGENTS.md` at the repo root is the one source of the rules. Cursor reads it natively, per [cursor.com/docs/rules](https://cursor.com/docs/rules). `.cursor/rules/repo-rules.mdc` is an always-on rule that only points to it.

`.cursor/hooks.json` runs two adapters in `scripts/cursor/` over the plugin hook scripts. See [cursor.com/docs/hooks](https://cursor.com/docs/hooks).

- `guard-shell.mjs` turns the `beforeShellExecution` payload of Cursor into the input of `plugin/hooks/guard-bash.mjs`. It answers with the `permission` JSON of Cursor. It fails closed: a malformed payload or a missing command gives exit 2 and a deny. The hook also sets `failClosed`, so a crash blocks too.
- `format-edit.mjs` runs `format-on-edit.mjs` after each `afterFileEdit`.

`GATED_DELIVERY_GUARD=off` turns the guard off in both tools. Check 21 fails on a hook that points at a missing script. It fails on a shell guard without `failClosed`. It fails on a `.cursor/rules` file that is not `.mdc` or does not point at `AGENTS.md`. It fails on a file path in `AGENTS.md` that does not exist.

The `.githooks/` leak guard and the CI checks apply to Cursor commits as they do to any other.

## Bootstrapping a client repo

`/gated-delivery:bootstrap` fills the guardrail gaps of a Python or TypeScript/JavaScript repo on GitHub. It shows a diff. It writes nothing until you confirm each group (`config`, `guards`, `ci`). It never overwrites an existing file. It calls zanity for `zanity init` and the baseline. It prints the overwatch install line and does not install overwatch.

The workflow it writes pins every action to a full SHA. It also keeps the baseline from growing. The scripts and their tests are in `plugin/bootstrap/`.

## Keeping client data out

The core must never name a client. `scripts/leak-guard.sh` greps the staged, tracked content for every pattern in a denylist. It fails the commit on a match. It fails closed when the denylist is missing, empty or invalid, or when the scan itself errors.

There is one exception. A well-formed base64 value of an `"integrity": "sha512-…"` line in a `package-lock.json` under `evals/fixtures/` can match a short term by chance. `npm ci` verifies those hashes against the registry. The guard prints each skip and scans the rest of the lockfile as usual.

- The denylist lives at `~/.config/gated-delivery/denylist`. Override it with `GATED_DELIVERY_DENYLIST`. It holds one extended regex per line. It is **never committed**, because the list of client names is itself client data.
- Enable the hooks once per clone: `git config core.hooksPath .githooks`. The pre-push hook needs `gitleaks` on `PATH`.
- CI cannot run the leak guard, because the denylist exists only on your machine. CI runs the guard's own self-test and gitleaks. The client-term check happens at commit time, locally.

## Skill evals

Each skill's `evals.md` holds scenarios and a `## Deterministic Checks` fence. Checks read the final answer, the pages a run delivered and the tool calls of the run. A judge grades only the clauses that no check can decide. It is skipped for a scenario with none. [docs/evals.md](evals.md) has the details and the cost levers.

- Before a PR that changes a skill, re-stamp it. The default is `node scripts/eval/changed-skills.ts --static <skill>`.
- A static stamp runs no model. It records that the `evals.md` checks lint, that the skill's script tests pass and that its rule anchors are present. Exit codes: 0 passed, 1 a check failed and no stamp was written, 2 usage, 4 harness error.
- The checks are the exported `STATIC_CHECKS` array in `scripts/eval/changed-skills.ts`. A static stamp that lacks a registered check is stale.
- `--waive <skill> --reason "<text>"` records an exception. The guard shows a waiver as a warning. A later change to the skill needs a new stamp or waiver.
- A live run uses your logged-in Claude subscription, so it needs no API key. It counts against your usage. The maintainer keeps live evals off, so do not run them unasked.
- CI checks the stamp of each skill that a PR changed.

The [README](../README.md#how-it-checks-itself) states how many stamps are live, static and waived. Check 25 keeps that line true.

## Tests

| Command | Needs a login | Proves |
|---------|---------------|--------|
| `bash tests/leak-guard.test.sh` | No | The guard rejects client terms, skips only well-formed integrity hashes in fixture lockfiles and logs each skip, and fails closed without a denylist |
| `bash tests/slice-scripts.test.sh` | No | Parallel slice and batch worktrees stay isolated, claims are create-only, batches are picked back in order, and the verify lock serializes runs |
| `bash tests/pre-push.test.sh` | No | The pre-push hook rejects a push that carries a leak in any pushed commit. It lets clean pushes and branch deletions through. It skips with exit 3 when gitleaks is missing. |
| `bash tests/install-gitleaks.test.sh` | No | The installer refuses an archive whose checksum differs from the pinned one, a failed download and a missing install directory |
| `bash tests/live-opt-in.test.sh` | No | Each login-bound test refuses to start without `GATED_DELIVERY_ALLOW_LIVE_CLAUDE=1`. A stub `claude` stands in, so no session starts. |
| `node --test plugin/hooks/*.test.mjs` | No | Hook behaviour |
| `node --test scripts/audit/*.test.ts scripts/audit/message-actionability/*.test.ts scripts/eval/*.test.ts scripts/cursor/*.test.ts` | No | The consistency guard, the lint scripts and the eval tools, on broken and valid fixtures |
| `node --test plugin/bootstrap/*.test.mjs plugin/bootstrap/guards/*.test.mjs` | No | The bootstrap plans and the client guards |
| `node --test plugin/scripts/*.test.mjs` | No | The plugin scripts that skills call |
| `npm ci && npx tsc --noEmit` | No | The dev scripts type-check |
| `GATED_DELIVERY_BASE_REF=origin/main node scripts/audit/consistency.ts` | No | Inventory, references, docs, settings and eval stamps agree with the files |
| `node scripts/eval/run-checks.ts --lint` | No | Every `## Deterministic Checks` command runs, and every `# expect:` line names a scenario |
| `node scripts/eval/run-scenarios.ts <skill> [--scenario <id>…]` | Yes | Runs eval scenarios as real `claude -p` sessions and writes the grades to `summary.tsv` |
| `bash tests/profile-isolation.test.sh [project-dir]` | No | A fresh profile installs the core, loads no client plugin or MCP server and has its own login |
| `bash tests/commit-convention.test.sh`, `tests/code-reviewer-scope.test.sh`, `tests/issue-writing.test.sh` | Yes | The commit command follows the convention, `code-reviewer` reports scope creep, and `issue-writing` keeps secrets out of the tracker |

The three login-bound tests exit 64 unless `GATED_DELIVERY_ALLOW_LIVE_CLAUDE=1` is set. Each one starts real `claude -p` sessions on your subscription. Check 30 fails a new test that launches `claude -p` without that guard. `tests/profile-isolation.test.sh` is exempt, because it uses an empty profile that is never logged in.

With the opt-in set, the tests skip with exit 3 when the profile is not logged in. Point them at another profile with `GATED_DELIVERY_TEST_PROFILE=~/.claude-<name>`.

Turn-end verification is the job of the `overwatch` plugin: [docs/onboarding.md](onboarding.md#install-overwatch-for-turn-end-verification). The knobs are in [docs/onboarding.md](onboarding.md#knobs-environment-variables).
