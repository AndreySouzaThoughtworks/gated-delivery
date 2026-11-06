# Rules for agents working in this repo

This file is the one source of the repo rules for every agent (Claude Code, Cursor and others). `.cursor/rules/repo-rules.mdc` only points here. A script enforces each rule that names a script. The other rules depend on you.

## Code

- Write self-documenting code. Names carry intent, so add no explanatory comments. Replace magic numbers and strings with named constants.
- A remaining comment states a constraint that the code cannot show. Write it in the present tense. Never tell the history of a change. `scripts/audit/comments.ts` rejects "until now", "used to", "no longer", "was moved", "regression:", PR and commit references and dates ([docs/development.md](docs/development.md)). History belongs in the commit message.
- Give every function real assertions that can fail. The messages show the values read. The `zanity` assertion-density rule applies everywhere.
- `scripts/audit/assertion-effectiveness.ts` fails an assertion that no test makes fail.
- A function with no honest second invariant carries a coded, counted suppression (`scripts/audit/suppression-reason-codes.ts`, `scripts/audit/suppressions.count`).
- `scripts/audit/consistency.ts` (check 17) rejects a condition that cannot vary.
- Never raise `zanity-baseline.json`. Never loosen `zanity.toml`. Never add a suppression without a reason (`scripts/audit/suppressions.ts`). Fix the code instead.
- Write every failure message so a reader can act on it. Name the file, line or value. State the rule. End with a fix as an imperative. `scripts/audit/message-actionability.ts` and check 32 fail a new message that does not.
- Only the `scout` agent pins a `model:`, and it pins `haiku`. Every other agent inherits the session model. Check 26 enforces this.
- Every fixed mistake becomes a deterministic rule with a test. Record it in `docs/mistakes-to-rules.md`. A line of prose is not a fix.
- Never add a `version` field to `plugin/.claude-plugin/plugin.json` or `.claude-plugin/marketplace.json` (checks 15 and 19). Without a version, Claude Code uses the commit SHA, so every commit is a new version and nobody bumps anything.
- Put new tooling outside `plugin/` when you can. `plugin/` ships to client installs.
- Plugin code runs as `node file.mjs` on the client machine. Keep it plain JavaScript. It must not import TypeScript (check 20).
- The plugin Node floor is the oldest release in security support. `package.json` `engines` states the dev floor. Check 31 fails when a document names another floor.

## Docs

- Write docs in ASD-STE100 style. Use sentences of 20 words or fewer, the active voice and one term per thing. Use the imperative for instructions.
- `scripts/audit/asd-style.ts` grades `README.md`, `AGENTS.md`, `plugin/README.md`, and `docs/*.md`. It fails a file when fewer than 80% of its sentences have 20 words or fewer (check 33). Run `node scripts/audit/asd-style-report.ts` to see the share per file and the longest sentences.
- The site comes from `scripts/site/build.ts` and `docs-site-src/`. Run `node scripts/site/build.ts --check` after a change to the plugin. Check 34 fails when the build script or the sources are missing, or the README does not link the site.
- Do not hard-code a number that can drift, unless a check guards it.

## Git and publishing

- Never push to `main`. Never force-push it. Push a branch with an explicit refspec: `git push origin BRANCH:refs/heads/BRANCH`.
- Write commits in conventional style (`feat:`, `fix:`, `chore:`, `docs:`) with a prose body.
- Write nothing on a public surface unless you are certain it is true and you were asked to. That covers issues, comments and PRs beyond the one you were asked for.
- Never commit secrets or client terms. `.githooks/pre-commit` runs the leak guard. `.githooks/pre-push` runs gitleaks. Both run for every agent and human commit once you set `git config core.hooksPath .githooks`.

## Checks to run before you open a PR

- `npm ci && npx tsc --noEmit`
- `env -u CLAUDECODE zanity check . --baseline zanity-baseline.json --new-only --agent --fail-on warning --strict`
- `GATED_DELIVERY_BASE_REF=origin/main node scripts/audit/consistency.ts`
- `node scripts/audit/comments.ts`, `node scripts/audit/suppressions.ts` and `node scripts/audit/token-budget.ts`
- `node scripts/eval/run-checks.ts --lint`
- The test commands in `.github/workflows/audit.yml`.

Never run a live eval or a `claude -p` session unless the maintainer asks. Those runs spend a subscription. `GATED_DELIVERY_ALLOW_LIVE_CLAUDE=1` is the opt-in (check 30). Never run `tests/live-gh.test.sh` unless the maintainer asks. It writes to a real repository, and `GATED_DELIVERY_ALLOW_LIVE_GH=1` is its opt-in (check 30).

## Guards that run for you

- Claude Code: `plugin/hooks/hooks.json` runs `plugin/hooks/guard-bash.mjs` and `plugin/hooks/format-on-edit.mjs`. The first denies catastrophic shell commands and fails closed.
- Cursor: `.cursor/hooks.json` runs `scripts/cursor/guard-shell.mjs` and `scripts/cursor/format-edit.mjs`. They adapt the same two plugin scripts. Check 21 keeps this file and `.cursor/` pointed at files that exist.
