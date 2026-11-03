# Mistakes and the rules that catch them

Each mistake below happened in this repo. The fix is a check that rules out the whole category, not a line of prose, and a test shows the check can fail. `scripts/audit/mistakes-table.test.mjs` fails when a row names a file, guard check, zanity rule or test title that does not exist.

## Mistakes caught by a rule

| Mistake | Category | Rule | Test |
|---|---|---|---|
| About 230 assertions were added only to satisfy assertion-density and could not fire (removed in 4b8aa45). | A check that cannot fail | zanity rule `assertion-density` on new functions (`.github/workflows/audit.yml`, `zanity-baseline.json`); `check 17` for conditions that never vary | `scripts/audit/consistency.test.mjs` "a condition that never varies is rejected, one that can change is accepted" |
| zanity's `--update-baseline` can add findings to the frozen baseline (a13c320). | A baseline that grows | `plugin/bootstrap/guards/ratchet.mjs` | `plugin/bootstrap/guards/ratchet.test.mjs` "rejects a baseline that grew, and tells the author not to run --update-baseline" |
| assertion-density was switched off instead of fixing the code (ec1adf7). | Loosening the rule, not fixing the code | `check 8`; `plugin/bootstrap/guards/rules-about-rules.mjs` | `scripts/audit/consistency.test.mjs` "zanity is a required check and its config cannot be loosened"; `plugin/bootstrap/guards/rules-about-rules.test.mjs` "rejects a zanity.toml that drops select = [all], and accepts it restored" |
| A rule could be silenced with a bare marker and no reason. Added before a case of it, right after ec1adf7. | A silent suppression | `scripts/audit/suppressions.mjs` | `scripts/audit/suppressions.test.mjs` "rejects a bare zanity ignore that silences every rule"; `scripts/audit/suppressions.test.mjs` "fails when the count exceeds the committed ratchet and passes at it" |
| Workflow actions were pinned to tags, which can move (5f9570f). | An unpinned dependency | `plugin/bootstrap/guards/rules-about-rules.mjs` | `plugin/bootstrap/guards/rules-about-rules.test.mjs` "rejects an action pinned to a tag or a short SHA, and accepts a local action" |
| The guard printed OK with every scenario row deleted from an evals.md (8e64ce5). | A gate that passes on nothing | `check 10a` | `scripts/audit/consistency.test.mjs` "rejects an evals.md with no scenario row, whether the section is empty or missing" |
| A bad skill name reached the paid eval run or crashed after it (2a37d4f). | Bad input found after the spend | usage error (exit 2) in `scripts/eval/changed-skills.mjs` and `scripts/eval/run-checks.mjs` | `scripts/eval/changed-skills.test.mjs` "a skill name that is a path, empty or unknown is a usage error before the probe, with no stack"; `scripts/eval/run-checks.test.mjs` "a skill argument that is a path, or . or .., is a usage error before any check runs" |
| An assertion crash exited 1, the code that means the evals failed (2a37d4f). | A crash read as a verdict | distinct exit codes in `scripts/eval/changed-skills.mjs`, `scripts/eval/run-checks.mjs`, `scripts/eval/run-scenarios.mjs` | `scripts/eval/changed-skills.test.mjs` "a failure inside the harness exits 4, not 1 which means evals failed"; `scripts/eval/run-scenarios.test.mjs` "a crash is exit 3, not the evals-failed 1, and stops the sessions still running"; `scripts/eval/run-checks.test.mjs` "an unreadable evals.md exits 3 as a harness error, not 1 which means FAIL" |
| 35 of 115 eval checks passed wrong output or could not fail (3cc9524). | A check that cannot fail | `check 7` (a warning); `scripts/eval/run-checks.mjs` with its lint mode | `scripts/audit/consistency.test.mjs` "warns when a measure is keyed on one of the skill's own headings"; `scripts/eval/run-checks.test.mjs` "--lint passes over the real skills and goes red when a check is broken" |
| A skill edit could merge with no eval run behind it. Added before a case of it. | Behavior change without evidence | `check 18` | `scripts/audit/consistency.test.mjs` "a skill changed against the base ref needs an eval stamp with a matching hash" |
| Plugin behaviour changed on main without a version bump. Installs kept the cached 0.8.1, whose Stop hook ran `verify-on-stop.mjs`, a file main had deleted, so every Stop event failed with MODULE_NOT_FOUND (fixed by the 0.9.0 release, #29). | A change that never reaches installs | `check 19` | `scripts/audit/consistency.test.mjs` "a shipped plugin file changed against the base ref needs a version bump" |

## Mistakes with no deterministic rule yet

These still depend on review.

| Mistake | Why no rule catches it |
|---|---|
| A prose trim deleted the `/slice` limit "Auto-merge PRs"; it was put back as prose in 6e62a8c. | No check or `/slice` scenario reads for it (nothing about auto-merge in `plugin/skills/slice/evals.md`), so deleting it again passes everything. |
| The recorded waiver for `slice` said no behavior changed when steps had been renumbered and a paragraph removed (6e62a8c). | `check 18` fails only a blank or stale waiver. It cannot tell whether the reason is true. |
| A skill-prose edit that changes behavior can ship while its eval is waived. | A waiver shows as a warning only. Review of `evals/results/` through CODEOWNERS is the control. |
| `story-drift` SKILL.md contradicted itself about follow-up text (0928c77). | No check finds two sentences that disagree. |
| Assertions that restate the code but are not constant still pass `assertion-density` and `check 17`. | zanity counts assertions, not their value. 4b8aa45 judged each one by reading the code. |
| zanity 0.1.30 and 0.1.39 panicked in CI on any baseline run, and the crash did not show locally because Claude Code sets `CLAUDECODE`, which makes zanity pick agent output (1818021). | It reproduces locally with `env -u CLAUDECODE`. The bootstrap template is pinned to `--new-only --agent` by a test in `plugin/bootstrap/bootstrap.test.mjs`, but nothing checks this repo's own `audit.yml` for the flag. |
