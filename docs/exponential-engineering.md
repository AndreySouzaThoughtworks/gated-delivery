# How this repo applies exponential engineering

[Exponential engineering](https://github.com/benomahony/exponential-engineering) says two things: every mistake becomes a deterministic rule for the whole category of mistake, and the repository, not the agent, holds the guardrails. This page says how gated-delivery follows that, how it checks its own claims, and where it falls short. It is written for someone who will read the checks rather than take the page on trust.

## What each idea looks like here

| Idea | Mechanism | Where |
|---|---|---|
| A mistake becomes a rule | Every fixed mistake gets a row naming the rule that now catches it and a test that exercises it. A second section lists the mistakes no rule catches yet. | [mistakes-to-rules.md](mistakes-to-rules.md), kept honest by `scripts/audit/mistakes-table.test.ts` |
| The repo holds the guardrails | Nine required status checks on `main`: zanity, consistency, workflows, shell, Links (lychee), Spelling (typos), gitleaks, node 26 and assertion effectiveness. | branch protection, `.github/workflows/` |
| The rules guard themselves | The consistency guard has 23 numbered checks. It fails if `zanity.toml` is loosened (check 8), if a condition can never vary (17), if the numbered checks lose their order (22), or if `tsc` drops its strict flags (23). | `scripts/audit/consistency.ts` |
| Guards fail closed | The Bash guard denies destructive commands and exits 2 when it cannot read or check its input. | `plugin/hooks/guard-bash.mjs`, `plugin/hooks/guard-bash.test.mjs` |
| Frozen debt only shrinks | The zanity baseline and the assertion baseline are both empty, and a ratchet fails any PR whose baseline grows. | `zanity-baseline.json`, `assertion-effectiveness-baseline.json`, `plugin/bootstrap/guards/ratchet.mjs` |
| Use the tools, do not copy them | zanity runs pinned to v0.1.39 in CI. Turn-end verification is left to the overwatch plugin. The bootstrap command plans the missing guardrails for a client repo and writes nothing until each group is confirmed. | `.github/workflows/audit.yml`, `plugin/bootstrap/` |

## Assertions: what zanity cannot see

zanity's `assertion-density` rule asks for two assertions per function that a bug could break. In JavaScript and TypeScript it counts calls named `assert` and treats `assert(true)` the same as a real check (tested on v0.1.30 and v0.1.39). It also counts neither `if (!ok) throw` guards nor `assert.ok`, and the floor of two is not configurable.

So this repo adds its own check, which zanity does not have. `scripts/audit/assertion-effectiveness.ts` instruments every assertion in non-test code, runs the tests, and fails on any assertion that no test ever made fail. It is a required check, and its baseline is empty: all 166 remaining assertions are proven by a test.

That left functions with no honest second invariant, where the only way to meet the floor was a check that cannot fail. Those carry a reasoned suppression instead, one per function, and the suppression guard accepts only a reason code from a fixed list plus a specific reason. The 68 suppressions today are 17 `single-invariant`, 16 `no-invariant`, 10 `limit-bound`, 6 `multi-caller-helper`, 6 `entry-point`, 5 `exported-and-tested`, 4 `io-wrapper`, 2 `thin-wrapper` and 2 `recursive-walker`. We deleted about 300 assertions to get here, each shown by the tool to be unable to fail, and we do not treat that as free: it is the cost of refusing tautologies.

## Where this falls short

- **Every skill eval stamp is a waiver.** All 12 skills ship on a recorded waiver because the live evals have not been run. The 432 deterministic checks in the evals are linted offline for being runnable and able to fail, but the skills' behaviour under a model is not verified. A waiver shows as a warning, and code review of `evals/results/` is the control.
- **The suppression budget is large and not a ratchet.** 68 is a count to bring down, not a number to defend. `scripts/audit/suppressions.count` must equal the suppressions found, but raising it is an edit a reviewer has to accept, and it went from 4 to 68 in one cleanup. A ratchet would stop a legitimately new function with no honest second invariant from merging, which pushes people toward assertions that cannot fail. We chose a visible, coded, reviewed count over that.
- **Some mistakes still depend on review.** The second section of the mistakes table names them, including a stray `npx` of an uninstalled tool and a stopped agent leaving child processes running.
- **zanity needs a workaround for baselines.** Versions 0.1.30 and 0.1.39 panic in plain output when a baseline is used outside an agent, so CI runs with `--agent`.
