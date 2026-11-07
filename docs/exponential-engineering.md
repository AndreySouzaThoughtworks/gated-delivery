# How this repo applies exponential engineering

[Exponential engineering](https://exponentialengineering.dev/) comes from Ben O'Mahony and Fabian Nonnenmacher. The ideas are theirs. Their [source repository](https://github.com/benomahony/exponential-engineering) holds the site.

The site makes two claims. Every mistake becomes a deterministic rule for the whole category of mistake. The repository, not the agent, holds the guardrails.

This page shows how gated-delivery follows those claims. It shows how the repo checks its own claims. It also shows where the repo falls short. Read the checks, not just this page.

The [documentation site](https://andrey1souza.github.io/gated-delivery/) has a page for each idea, with generated numbers and real output.

## What each idea looks like here

| Idea | Mechanism | Where |
|---|---|---|
| A mistake becomes a rule | Every fixed mistake gets a row. The row names the rule that now catches it and a test that exercises it. A second section lists the mistakes that no rule catches yet. | [mistakes-to-rules.md](mistakes-to-rules.md), kept honest by `scripts/audit/mistakes-table.test.ts` |
| The repo holds the guardrails | Nine required status checks on `main`: zanity, consistency, workflows, shell, Links (lychee), Spelling (typos), gitleaks, node 26 and assertion effectiveness. An opt-in live test compares this list with the settings that GitHub holds. | branch protection, `.github/workflows/`, `tests/live-gh.test.sh` |
| The rules guard themselves | The consistency guard fails if `zanity.toml` is loosened (check 8). It fails if a condition can never vary (17). It fails if the numbered checks lose their order (22). It fails if `tsc` drops its strict flags (23). It fails if the audit workflow splits the consistency steps across jobs (29). It fails a suppression with no coded reason (37). | `scripts/audit/consistency.ts` |
| Guards fail closed | The Bash guard denies destructive commands. It exits 2 when it cannot read or check its input. | `plugin/hooks/guard-bash.mjs`, `plugin/hooks/lib/guard-core.mjs`, `plugin/hooks/guard-bash.test.mjs` |
| Frozen debt only shrinks | The zanity baseline and the assertion baseline are both empty. The message-actionability baseline holds the old messages. On a pull request, a ratchet fails any baseline that grows. | `zanity-baseline.json`, `assertion-effectiveness-baseline.json`, `message-actionability-baseline.json`, `plugin/bootstrap/guards/ratchet.mjs` |
| Prose is checked too | A rule inventory pins each load-bearing rule of an instruction file to a literal anchor (check 27). A token budget stops instruction text from growing unseen (check 28). A script grades the docs for short sentences (check 33). | `evals/rules/`, `evals/token-budget.json`, `scripts/audit/asd-style.ts` |
| Use the tools, do not copy them | zanity runs pinned to one release in CI. typos, lychee, gitleaks, shellcheck, actionlint and zizmor run in CI as well. The overwatch plugin handles turn-end verification. The bootstrap command plans the missing guardrails for a client repo. It writes nothing until you confirm each group. | `.github/workflows/`, `plugin/bootstrap/` |

## Assertions: what zanity cannot see

The `assertion-density` rule of zanity asks for two assertions per function that a bug could break. In JavaScript and TypeScript it counts calls named `assert`. A run with zanity v0.1.30 and every rule on shows three things. It accepts `assert(true)` as a real check. It counts neither `if (!ok) throw` guards nor `assert.ok`. The `zanity.toml` template that `zanity init` writes has no setting for the floor of two.

So this repo adds a check that zanity does not have. `scripts/audit/assertion-effectiveness.ts` instruments every assertion in non-test code. It runs the tests. It fails on any assertion that no test ever made fail. It is a required check, and its baseline is empty. A test proves every remaining assertion.

Some functions have no honest second invariant. The only way to meet the floor there is a check that cannot fail. Those functions carry a reasoned suppression instead, one per function. The suppression guard accepts only a reason code from a fixed list, plus a specific reason. `node scripts/audit/suppressions.ts` prints how many suppressions exist today. `scripts/audit/suppression-reason-codes.ts` lists the codes and what each one means.

One cleanup commit deleted about 230 assertions that the tool showed could not fail (4b8aa45). That cost is real, and it is the price of refusing tautologies.

## Messages: a failure must tell you what to do

A guard that fails with "error" teaches nothing. `scripts/audit/message-actionability.ts` reads every failure message in the scripts, hooks and audit tools. A message must name the offending value, state the rule and end with a fix. Check 32 fails any new message that does not. The old ones sit in a baseline that only shrinks. The tests of each guard judge its real output with `assertActionable`.

## Where this falls short

- **No skill eval stamp is live.** Every skill carries a static stamp, because live evals are off. They spend the maintainer's subscription usage. A static stamp records that the scripts and deterministic checks of the skill pass. No model ran. It does not prove that the model follows the skill. So the behaviour of the skills under a model is not verified. A skill that cannot be stamped statically ships on a waiver. A waiver shows as a warning. Review of `evals/results/` is the control.
- **A rule inventory proves text, not behaviour.** Check 27 proves that each anchor is present. It does not prove that a reworded rule keeps its meaning. It does not prove that the model obeys the rule.
- **The suppression budget is large and not a ratchet.** The count is a number to bring down, not one to defend. `scripts/audit/suppressions.count` must equal the suppressions found. A reviewer must accept each rise. A ratchet would stop a new function with no honest second invariant from merging. That pushes people toward assertions that cannot fail. We chose a visible, coded, reviewed count over that.
- **The live `gh` test is opt-in.** The scripts are tested with fixtures and stubs in CI. `tests/live-gh.test.sh` runs them against a real `gh` in a sandbox repository. CI never runs it, so the maintainer runs it by hand. It does not cover more than one page of review threads or a real merge.
- **Ratchets run on pull requests only.** They compare a baseline with the one at the base ref. A lone checkout has no base ref.
- **The Bash guard is an accident guard.** Indirection defeats it. The variable `GATED_DELIVERY_GUARD=off` turns it off.
- **Static analysis does not run on a schedule.** CI runs on each pull request and each push to `main`.
- **No property tests and no simulation.** The tests are examples. A bug that no example covers reaches review.
- **No language server or watcher is configured here.** The checks run in CI. Two git hooks run the leak guard and gitleaks.
- **The sentence check is a proxy.** Check 33 measures sentence length. It does not prove that the prose is clear or true. A reviewer still reads the text.
- **Some mistakes still depend on review.** The second section of the mistakes table names them. One example is a stray `npx` of an uninstalled tool. Another is a stopped agent that leaves child processes running.
- **zanity needs a workaround for baselines.** Versions 0.1.30 and 0.1.39 panic in plain output when a baseline is used outside an agent. So CI runs with `--agent`.
