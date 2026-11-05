# Rules for agents working in this repo

This file is the one source of the repo rules for every agent (Claude Code, Cursor and others). `.cursor/rules/repo-rules.mdc` only points here. The rules that are enforced by a script are listed with the script; the rest depend on you.

## Code

- Write self-documenting code. Names carry intent, so add no explanatory comments. Replace magic numbers and strings with named constants.
- Every function gets real assertions that can fail, with messages that show the values read. `zanity`'s assertion-density rule applies everywhere, `scripts/audit/assertion-effectiveness.ts` fails an assertion that no test makes fail, a function with no honest second invariant carries a coded, counted suppression (`scripts/audit/suppression-reason-codes.ts`, `scripts/audit/suppressions.count`), and `scripts/audit/consistency.ts` (check 17) rejects a condition that cannot vary.
- Never raise `zanity-baseline.json`, loosen `zanity.toml`, or add a suppression without a reason (`scripts/audit/suppressions.ts`). Fix the code.
- Only the `scout` agent pins a `model:`, and it pins `haiku`; every other agent inherits the session model. Consistency check 26 enforces this.
- Every fixed mistake becomes a deterministic rule with a test, recorded in `docs/mistakes-to-rules.md`. A line of prose is not a fix.
- Every non-test file you change under `plugin/` needs a version bump in `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (consistency check 19). Prefer putting new tooling outside `plugin/`, which ships to client installs.

## Git and publishing

- Never push to `main`, and never force-push it. Push a branch with an explicit refspec: `git push origin BRANCH:refs/heads/BRANCH`.
- Commits use conventional style (`feat:`, `fix:`, `chore:`, `docs:`) with a prose body.
- Write nothing on a public surface (issues, comments, PRs beyond the one you were asked for) unless you are certain it is true and you were asked to.
- Never commit secrets or client terms. `.githooks/pre-commit` runs the leak guard and `.githooks/pre-push` runs gitleaks, for every agent and human commit once `git config core.hooksPath .githooks` is set.

## Checks to run before you open a PR

- `npm ci && npx tsc --noEmit`
- `env -u CLAUDECODE zanity check . --baseline zanity-baseline.json --new-only --agent --fail-on warning --strict`
- `node scripts/audit/consistency.ts`
- The test commands in `.github/workflows/audit.yml`.

## Guards that run for you

- Claude Code: `plugin/hooks/hooks.json` runs `plugin/hooks/guard-bash.mjs` (denies catastrophic shell commands, fails closed) and `plugin/hooks/format-on-edit.mjs`.
- Cursor: `.cursor/hooks.json` runs `scripts/cursor/guard-shell.mjs` and `scripts/cursor/format-edit.mjs`, adapters over the same two plugin scripts. Consistency check 21 keeps this file and `.cursor/` pointing at files that exist.
