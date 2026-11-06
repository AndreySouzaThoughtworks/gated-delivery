# Running skill evals

Each skill's `evals.md` holds its scenarios (prompt, persona, Pass Criteria), the agent prompt templates and a `## Deterministic Checks` fence. An eval run is a real `claude -p` session on a fixture directory. A grader scores it afterwards. These notes record what the eval sweeps taught about getting runs you can trust.

Live evals are off today. They spend the maintainer's subscription usage. Do not start one unless the maintainer asks. The static tier below needs no model.

## Eval tiers

A skill stamp in `evals/results/<skill>.json` has one of three tiers.

| Tier | What ran | What it proves |
|------|----------|----------------|
| live | Real `claude -p` sessions, graded by checks and a judge | The model followed the skill in those scenarios |
| static | The registry of deterministic checks, with no model | The scripts and checks of the skill are intact. It does not prove that the model follows the skill. |
| waived | Nothing. A person recorded a reason. | Nothing. The guard shows it as a warning. |

The [README](../README.md#how-it-checks-itself) states how many stamps sit in each tier. Check 25 keeps that line true.

## Run them with the runner

`scripts/eval/run-scenarios.ts` does §1 to §3 for you. Then it grades each run:

```bash
node scripts/eval/run-scenarios.ts <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR] [--smoke] [--rerun-failures] [--budget-usd N] [--total-budget-usd N] [--model M]
```

The runner runs every row of the Test Scenarios of the skill unless `--scenario` names some. It runs each row `--repeat` times. The default is 2, or 1 with `--rerun-failures` (see §5). It runs `--jobs` rows at once. The default is 4.

`--baseline` fills the Baseline Agent template instead. It loads no plugin (§8). The runner stops each run after 1200 seconds of wall-clock time. There is no spend cap unless you set one (see the next section). Set `GATED_DELIVERY_CLAUDE_BIN` to use another `claude` binary. Run the runner from the repository root.

Each run lands in `<out>/<skill>/<id>/<arm>-<n>/`. That folder holds `prompt.txt`, `transcript.jsonl`, `output.md`, `checks.txt`, `judge.json` and `run-tmp/`, the temp directory of the run. `<out>/summary.tsv` has one line per run: skill, id, arm, run, harness, checks, judge, cost, secs. The table the runner prints ends with a `DISAGREE` line for every scenario whose repeats graded differently.

The `harness` column is `ok`, or it names what makes the run unusable as a result. The names are:

- `no-skill`: a skill run with no `"name":"Skill"` call.
- `read-skill`: a baseline that read `skills/<skill>/`.
- `no-result`, `timeout` and `setup-failed`.

Any of them makes the runner exit 1. A run with `permission_denials` gets a note such as `ok,denied=2`. That note is not a harness failure, because a refused side lookup is common and blocks nothing. Read the denials in the last line of the transcript. Treat the run as a harness failure only when a denial blocked the behaviour under test (§3).

The `checks` column comes from `run-checks.ts <skill> <file> --scenario <id>`. The runner applies it to `output.md` and to every `.html` page the run wrote outside `run-tmp/`. The `judge` column comes from `judge.ts <skill> <id> <run-dir>`. Either column is `n/a` when its script is not there.

## Before a PR that changes a skill

```bash
node scripts/eval/changed-skills.ts
```

The script finds the skills that changed against `GATED_DELIVERY_BASE_REF`. The default is `origin/main`. It works through the merge base and includes uncommitted and untracked files. A skill counts as changed in two cases. A file under `plugin/skills/<skill>/` changed. Or a `plugin/agents/*.md` file changed whose name the `SKILL.md` of the skill mentions.

Some edits do not count: edits to `evals.md`, to test files under the `scripts/` folder of the skill and to `evals/fixtures`. `run-checks.ts --lint` checks those for free. Name skills as arguments to run them with no git lookup.

**Tiers of a live run.** The default is smoke: `--smoke --rerun-failures --budget-usd 2 --total-budget-usd 20`. Smoke runs the fewest scenarios whose `# expect:` lines cover every deterministic check at least once. Ties go to the earlier row. A skill with no covered check gets its first scenario. Smoke does not run the other scenarios, so it does not grade their judged Pass Criteria. `--full` runs every scenario, twice, with no caps. Use it before a release or after a rewrite.

**Credentials.** The runner passes `--setting-sources project,local`. The judge passes `""`. Both still authenticate with the Claude subscription login (the `claude auth login` session). A tiny `claude -p` call with each flag value returned `ok` with `is_error` false. That call used no API key and no token in the environment.

An `ANTHROPIC_API_KEY` or a `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) also works. CI uses one. A logged-in machine needs neither. Runs on a login consume subscription usage. `claude auth status` does not prove that the flags work, so the probe is the check. Before any scenario, `changed-skills.ts` runs one tiny probe. It uses `claude -p` with the same flags, a `--max-budget-usd 0.05` cap and your model. It costs about nothing. It exits 3 if the probe fails.

**Exit codes.**

- `0`: every scenario passed. A scenario that failed once and passed on rerun is `flaky`. It counts as a pass and prints as `FLAKY`.
- `1`: a scenario failed twice, hit its budget, or did not run because the total budget ran out.
- `3`: nothing ran. Either `claude` is missing or the probe failed, was not JSON or reported `is_error`. The script prints a `SKIPPED` line and a credentials hint. It never exits 0 in that case.
- `2`: a usage error.

**Live stamp.** Each skill that passes gets `evals/results/<skill>.json`. It holds `hash`, `tier`, `scenarios`, `verdicts`, `totalCostUsd` and `ranAt`. Commit it with the change. The hash is a sha256 over every file under `plugin/skills/<skill>/` and every `plugin/agents/*.md` file that the `SKILL.md` names. Each file contributes its repository-relative path and its bytes, in sorted path order. `evals.md` and test files under `scripts/` are left out.

**Static stamp.** `node scripts/eval/changed-skills.ts --static <skill>` runs a registry of deterministic checks for one skill. No model runs. It writes `evals/results/<skill>.json` as `hash` plus `static: { checks: [{ name, result }], ranAt }`. The registry is the exported `STATIC_CHECKS` array. It holds three checks:

- `lint`: the `## Deterministic Checks` of the skill are runnable, and each `# expect:` names a scenario. It is the same lint as `run-checks.ts --lint <skill>`.
- `script-tests`: the tests that `SKILL_SCRIPT_TESTS` maps to the scripts of the skill. A skill with scripts and no mapped tests fails. A skill with no scripts records `none`. That means nothing to run. It is not a pass.
- `rule-anchors`: the rule inventory of the skill under `evals/rules/`. It is the same check as consistency check 27. Every anchor must be present, and every marker line must be covered. A skill with no inventory records `none`.

The script exits 0 when every check passes or is `none`. It exits 1 when one fails. Then it writes no stamp and leaves an existing stamp untouched. It exits 2 on usage and 4 on a harness error.

The guard accepts a static stamp when four things hold. The stamp is for the exact current hash. It is non-empty. It holds only `pass` or `none` results. It has every registered check. A stamp that is both a waiver and static is an error.

**Waiver.** A skill that cannot be stamped needs a recorded exception. Run `node scripts/eval/changed-skills.ts --waive <skill> --reason "<why>"`. It writes `evals/results/<skill>.json` with the hash, the reason and `ranAt`. It runs nothing. The guard accepts a waiver only for the exact current hash. Any later edit to the skill makes it stale. It shows as a warning, not a pass. `/evals/results/` is in CODEOWNERS, so the owner reviews each waiver.

**Guard.** When `GATED_DELIVERY_BASE_REF` is set, the consistency guard (check 18) requires a stamp with a matching hash for every skill changed against that ref. CI sets it on pull requests. Locally it is unset, so the check is skipped. A skill that nobody changed needs no stamp.

`.github/workflows/evals.yml` runs the same script in CI when the repository has a `CLAUDE_CODE_OAUTH_TOKEN` secret. It is not a required check.

**Cost levers.**

| Flag | Effect |
|------|--------|
| `--smoke` | Run only the covering set of scenarios. |
| `--rerun-failures` | Run each scenario once, then rerun only the ones that did not pass. |
| `--budget-usd N` | Pass `--max-budget-usd N` to each run. A run the cap stops is a harness failure, flagged `over-budget`. The `error_max_budget_usd` subtype it keys on is unverified against a real capped session. So any result with `is_error: true` is also a harness failure, flagged `api-error`. |
| `--total-budget-usd N` | Stop launching runs once finished runs cost `N`. Scenarios never launched are `not-run` and the exit is nonzero. |
| `--model M` | Pass `--model M` to each run. `GATED_DELIVERY_RUN_MODEL` sets the default. |

Each flag works on `run-scenarios.ts` directly. `changed-skills.ts` forwards `--budget-usd`, `--total-budget-usd`, `--model` and `--jobs`. A scenario passes when its harness flags are clean and its checks and judge each say `PASS` or `n/a`. `UNCLEAR` is not a pass.

A row whose Pass Criteria cell is exactly `—` has all its criteria in the fence. The runner does not call the judge, and the grade is `n/a`. The runner also writes `verdicts.json` beside `summary.tsv`. It prints a `VERDICT` line per scenario.

The sections below describe what the runner does and why. Use them to read its runs or to run one by hand.

## 1. Snapshot the plugin without its rubrics

Load a copy of the plugin with every `evals.md` removed. A run that can read its own `evals.md` sees the Pass Criteria. Then it grades itself against them. The runner writes the copy to `<out>/plugin`.

```bash
rsync -a --exclude evals.md plugin/ "$SNAP/plugin/"
```

## 2. Start one run

One directory per run holds the fixture. It holds the persona, any client `CLAUDE.md` and a git repository when the scenario needs one. The runner writes the persona of the row to `persona.md`. When the `evals.md` has a `## Client context` section, the runner writes its fenced block to `CLAUDE.md`. For a `mode: response` skill, the runner adds one line to the prompt. That line says nothing beyond the persona is reachable.

A scenario can need more than that. Then it gets a directory `evals/fixtures/<skill>/<id>/` at the repository root. It sits outside the plugin, so installs do not carry it. The runner copies it over the run directory. A `persona.md` or `CLAUDE.md` there replaces the one built from `evals.md`.

Two names are not copied:

- `setup.sh` runs in the run directory with the fixture directory as `$1`. Use it to build what you cannot commit, such as a git repository or `node_modules`.
- `allowed-tools` adds one `--allowedTools` rule per line.

A `bin/` directory in the run goes first on `PATH`. Use it for stubs such as `gh`. The response line is left out, because a fixture is reachable. Keep fixtures free of client names and secrets. This repository is public.

A fixture can install `node_modules`. It commits a `package-lock.json` and installs with `npm ci`. That command checks every `"integrity": "sha512-…"` value against the tarball it downloads from the registry. It stops with `EINTEGRITY` on any mismatch. So a planted value cannot survive a run. That is why `scripts/leak-guard.sh` may skip those values. It skips them only in `package-lock.json` files under `evals/fixtures/`, and it logs each skip.

Fill the prompt of the scenario into the Skill Agent template. Run from that directory:

```bash
cd "$RUN_DIR"
claude -p "$(cat prompt.txt)" \
  --plugin-dir "$SNAP/plugin" --add-dir "$SNAP/plugin" \
  --setting-sources project,local --strict-mcp-config \
  --permission-mode acceptEdits --allowedTools "$ALLOWED" \
  --output-format stream-json --verbose > transcript.jsonl < /dev/null
tail -1 transcript.jsonl | jq -r '.result' > output.md
```

| Flag | Why |
|---|---|
| `--plugin-dir` | Loads the snapshot, not an installed copy. |
| `--add-dir` | Lets the skill read its own templates and references. Add any other directory the skill writes to, such as a machine-local notes home. |
| `--setting-sources project,local` | Drops your user settings, user `CLAUDE.md` and user plugins. Only the fixture and the plugin under test shape the run. |
| `--strict-mcp-config` | With no `--mcp-config`, no MCP server loads. So nothing reaches a real tracker. |
| `--output-format stream-json --verbose` | Records every tool call. The last line carries the result, cost, turn count and `permission_denials`. |
| `< /dev/null` | Stops the session from waiting on stdin. |

Run under a profile that is logged in. Set a wall-clock budget per run. Stop runs that pass it. A hung run is a harness failure, not a result. The budget of the runner is 1200 seconds. Set it with `GATED_DELIVERY_RUN_TIMEOUT_SECONDS`.

## 3. Allow what the skill runs

`acceptEdits` allows file edits inside the working and added directories, and nothing else. A headless run cannot answer a permission prompt. So a refused command is skipped. Then the run either carries on without it or burns time on workarounds. One deskcheck run spent 74 minutes and $11 on encoders after `base64` was refused.

Pass `--allowedTools` for what the scenario needs. The runner passes every rule below. It also passes `ls`, `cat`, `wc`, `file`, `cp`, the read-only `git status`, `log`, `diff`, `show`, `branch` and `rev-parse`, and the `allowed-tools` of the fixture.

The runner creates one temp directory per run. It passes that directory to `--add-dir` and sets `TMPDIR` to it. So no run can read the files of another run or an old copy of an `evals.md`.

| Rule | When |
|---|---|
| `Bash(grep:*)` | Skills that verify their own output with `grep`, such as the guardrail scan before publishing to a tracker |
| `Bash(echo:*)` | The same skills, when they print the exit status of a scan as a separate bare command. |
| `Bash(printenv:*)` | Skills that read a setting from the environment, such as the notes checkout |
| `Bash(base64:*)`, `Bash(tr:*)`, `Bash(mkdir:*)`, and an assembler: `Bash(python3:*)`, `Bash(awk:*)` or `Bash(sed:*)` | Pages that embed a screenshot: the skill encodes the image, strips line breaks, makes the page's directory and splices the encoded image into the page. Also pass `--add-dir` for a writable temp directory, such as `/private/tmp/claude-501` and its `/tmp/claude-501` alias, where the encoded image and the assembler script land. |
| `Bash("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":*)` | Skills that inspect a rendered page in headless Chrome, such as the deskcheck render scenarios. Keep the quotes: the path has spaces, and the unquoted rule never matched. Name that path in the persona, and tell the run to call each command bare: a deskcheck scenario 9 run lost its 390-pixel check to a refused `D=…;` chain. |
| `Bash(git add:*)`, `Bash(git commit:*)` | Fixtures that are git repositories the skill commits into |
| `Bash(node scripts/audit/consistency.ts)` | Flow audits. The rule matches the command only when it is called bare from the repository root. A `cd … &&` prefix or a chained command is refused. Set the working directory of the run to the repository instead. |

`acceptEdits` refuses compound commands even when every part is allowed. In the deskcheck scenario 9 runs, `ls -la && ls -la evidence` was denied with `Bash(ls:*)` allowed. So was `R=…; mkdir -p … && python3 -I assemble.py …` with `Bash(mkdir:*)` and `Bash(python3:*)` allowed. `cd … && …` and `…; …` chains were denied the same way. Runs must call each command bare, from the working directory of the run. A refused chain reads as a skill defect, but it is not one.

Two refusals have no rule that fixes them.

- A heredoc (`cat > draft.md <<'EOF'`) is a Bash command, not an edit. So `acceptEdits` refuses it. The skill has to use its Write tool.
- A write outside the working and added directories is refused, whichever tool makes it. That covers the system temp directory and a scratchpad.

Both showed up in the issue-writing sweep as drafts that never reached disk. Read such a denial as the skill choosing the wrong place or tool. It is not a missing rule.

After each run, read `permission_denials` in the last transcript line. A denial that blocked the behaviour under test makes the run a harness failure. Fix the allow-list and run it again.

## 4. Expect managed policy

`--setting-sources` does not remove the managed policy of an organisation. Expect what it requires, such as a disclosure footer, in outputs. That is not a skill defect. A check that counts text must not trip on it.

## 5. Run every scenario at least twice

Runs vary. In one confirmation sweep, 7 of 44 scenarios passed once and failed once. A single run is not a verdict. A split means the wording of the skill leaves room. Tighten the wording. Then run both again.

## 6. Grade

1. Confirm the skill ran: `grep -c '"name":"Skill"' transcript.jsonl`. No invocation is a harness failure.
2. Grade against the Pass Criteria of the scenario, including every "Fails if" clause. For anything the skill should have written or run, check the run directory and the transcript. Do not trust the prose in `output.md`.
3. Grade the Deterministic Checks from the repository root: `node scripts/eval/run-checks.ts <skill> <file> --scenario <id>`.
4. A FAIL that disagrees with your reading of the output is a misfire. Fix the check or its expect line, not the grade.

`run-checks.ts` runs each check whose `# expect:` line names the scenario. It prints `PASS|FAIL <count> <expect> <label>`. It exits 0 when all pass, 1 on any FAIL and 2 on a usage error. Run it once on `output.md` for checks on the response. Run it once on the rendered artifact, such as `deskcheck.html`, for checks labelled `Page:`. In a skill that has `Page:` checks, the file name picks the set. `output.md` gets the response checks. Any other file gets the `Page:` checks. Checks marked `# expect: manual` are skipped. Read those counts with `node scripts/eval/run-checks.ts <skill> <file>`.

An expect line sits in the fence, directly above its command: `# expect: <op><n> on <id>[,<id>…]`. The op is `>=`, `==` or `<=`. A check may carry several expect lines, one per expectation. It names each scenario at most once. A check that prints lines instead of a number is counted by its non-empty lines. So `==0` means no output. `--lint` rejects a malformed expect line. It also rejects an id that is not in the `## Test Scenarios` table of the skill. The consistency guard warns on a check with no expect line.

A fence command can also read the tool calls of the run through the `transcript.jsonl` placeholder. It works like `output.md`. It resolves to the transcript in the same directory as the graded file, and the runner quotes the path. If that file is missing, the check fails with `no transcript.jsonl beside <file>`. `--lint` supplies an empty scratch transcript, so these commands only need to run. Each line is one stream-json event. Tool calls appear as `"name":"<Tool>","input"`. For example, `grep -c '"name":"Write","input"' transcript.jsonl` counts Write calls.

## 7. Prove every check

Run a check on a passing output and on a failing one before it lands. See the result differ. Use real run output for the pass. For the fail, use a failing run or a copy with the defect edited in. A check that returns the same value on both proves nothing. `node scripts/eval/run-checks.ts --lint` proves only that each command runs.

## 8. Keep the skill's text away from the baseline

A baseline run must not be able to read the skill it is compared against. The audit-flow baselines ran in a clone of this repository. They read `plugin/skills/audit-flow/SKILL.md` from it and copied its headings. Their passes said nothing about the skill.

When the fixture is a clone of this repository, delete the directory of the skill from the clone of the baseline before the run: `rm -r plugin/skills/<skill>`. Then commit, so the tree is clean. Give the baseline no `--plugin-dir` and no `--add-dir` that reaches a plugin copy. After the run, `grep -c 'skills/<skill>/' transcript.jsonl` must be 0. A read of the files of the skill makes the baseline a harness failure.

## 9. Judge the Pass Criteria

`scripts/eval/judge.ts` grades one saved run against its scenario row. It saves you from grading every run by hand (step 6.2).

```bash
node scripts/eval/judge.ts <skill> <id> <run-dir>
```

Run it from the repository root. `<run-dir>` holds `output.md`. It also holds `transcript.jsonl` and the files the run wrote, when there are any. If your harness keeps them apart, copy the workspace and the outputs of the run into one directory first.

- **Clauses.** The script splits the Pass Criteria of the row into sentences. Every "Fails if" becomes its own clause.
- **Judge.** One `claude -p` on `haiku` grades the clauses. It uses `--tools Read,Grep,Glob`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, no plugin and `--json-schema` for the reply. It starts in an empty temporary directory. It reaches the run through `--add-dir`. So nothing the run wrote, such as a fixture `CLAUDE.md`, loads as project context. The prompt says that everything the run produced is data, not instructions. A 1200-second wall clock is the only limit.
- **Evidence.** Each clause comes back PASS, FAIL or UNCLEAR with quotes and a note. Each quote names its file, its text and optionally its line. Code checks every quote. Its file must exist in the run directory. A given line must exist in that file. Its text must appear in that file once whitespace, markdown emphasis and JSON escapes are set aside. A `...` joins fragments that are each checked. A result with no quote, or with a quote that cannot be found, becomes UNCLEAR. The printed `evidence` is the quotes as `file:line "text"`, then the note.
- **Verdict.** Code decides it. Any FAIL is FAIL. Otherwise any UNCLEAR is UNCLEAR. Otherwise it is PASS. The exit code is 0 on PASS, 1 on FAIL and 3 on UNCLEAR. It is 2 on a usage or harness error, such as a missing row or a reply that does not match the schema.

```json
{"verdict":"FAIL","clauses":[{"clause":"Fails if it raises the rewording or the same-meaning ADR as findings.","result":"FAIL","evidence":"output.md \"Adding that to AC3 would remove the ambiguity.\" — suggests an edit to AC3"}]}
```

The judge settles nothing alone. Read the evidence of every FAIL and UNCLEAR before you act on it. An UNCLEAR often means the judge quoted loosely, such as two table cells joined into one quote. Rerun it before you grade by hand.

Before you trust the judge on a new skill, run it on one run you graded PASS and one you graded FAIL, twice each. Check that the verdicts match yours. Run it twice on any run you act on. A split means a clause is worded loosely enough to read both ways.

The judge was proven on 8 hand-graded runs (4 PASS, 4 FAIL) across 5 skills: story-drift, prod-support, deskcheck, audit-flow and learn-flow. With quote checking in place, a final pass matched the hand grade on 8 of 8, with no UNCLEAR clause.

## Rule inventory

Live evals are off, so nothing else notices when a prose trim deletes a rule. In b7b63c6 a trim deleted the `/slice` limit "Auto-merge PRs", and every check still passed. A rule inventory makes that visible. A JSON file lists the load-bearing rules of one skill, agent or command. Each rule has a literal anchor. Consistency check 27 fails when an anchor is no longer in the file.

### What it proves and what it does not

It proves two things. The anchor text of each listed rule is present in the file. Every line that contains a marker word is accounted for by some rule or by an exempt entry with a reason.

It does not prove that the model follows a rule. It does not prove that a reworded rule still means the same. An anchor that survives a rewrite of the rest of its sentence passes. A reviewer still reads the diff. The inventory tells the reviewer which rules the diff touched.

### Writing one

Create `evals/rules/<kind>-<name>.json`, for example `evals/rules/skill-slice.json`. The folder sits outside `plugin/`. So the file is not shipped and does not change the skill hash.

```json
{
  "file": "plugin/skills/slice/SKILL.md",
  "files": ["plugin/skills/slice/references/parallel.md"],
  "rules": [{ "id": "slice.no-automerge", "anchor": "`/slice` never merges one", "kind": "never", "why": "the b7b63c6 rule" }],
  "exempt": [{ "anchor": "a phrase of a marker line", "reason": "restates slice.no-automerge" }]
}
```

- `anchor` is a literal substring of one line, not a regex. Copy a distinctive phrase of the rule line. It must occur in `file`. It may also occur in one of `files`, the other files of the same skill where a rule may live after a split. Or it may occur in a script under `plugin/scripts/` that now enforces the rule. `evals/rules/skill-slice.json` anchors rules to `slice-claim.mjs`, `handoff.mjs` and others this way. The marker lines of such a script need a rule too.
- `kind` is one of `stop`, `never`, `must`, `checkpoint`, `limit`, `other`. A rule is anything whose deletion changes what the orchestrator does or refuses to do. A marker word is not required.
- Marker lines are the lines of every listed file that match `MARKER_PATTERN` in `scripts/audit/rule-inventory.ts`. The pattern matches these whole words: STOP, NEVER, MUST, Do not, CHECKPOINT, never, Never, always, Always, must not, Must not. Every non-blank line under a heading that contains the word NOT is also a marker line, such as `## What /slice does NOT do`. The pattern alone cannot see a bullet like "Auto-merge PRs."
- A marker line must contain some rule anchor or some exempt anchor. An exempt entry needs a reason that says why the line is not a rule, such as a restatement, an example or vocabulary. Rule ids must be unique. A blank anchor or reason is an error.
- Check 27 also scans the other markdown files under `plugin/skills/`, except `SKILL.md` and `evals.md`. A file with marker lines and no inventory only warns (`no rule inventory for <file>: N marker lines`). `UNINVENTORIED_FILES_ARE_ERRORS` in `scripts/audit/rule-inventory.ts` is the one constant that turns the warning into an error once every file has an inventory.

### The three tools

- `node scripts/audit/consistency.ts` runs check 27 on every file in `evals/rules/`.
- `node scripts/audit/rule-inventory-mutation.ts evals/rules/skill-slice.json` deletes, in a scratch copy, each line that holds the anchor of a rule. It deletes one line at a time. It counts the mutation as killed only when the check then reports the anchor of that rule as missing. A rule whose anchor also appears on another line survives the deletion of one copy. Then the tool exits 1 and lists it as a weak anchor. The tool also prints the unprotected share, which is the percentage of non-blank lines that hold no rule anchor. That share is information, not a failure. It shows what the inventory does not guard.
- `node scripts/audit/rule-inventory-backtest.ts --file <path> [--commit <sha>]` needs git history. It is a development tool and evidence for a PR, not a CI step. It builds a provisional inventory from the parent of the commit, with every marker line as its own anchor. It lists the lines that the version of the commit lacks. Without `--commit` it runs over every commit that touched the file and prints the interruption rate. Whole-line anchors also flag a reworded line. So the rate is an upper bound on how often a trim would interrupt a real inventory.

### Token budget

The token budget guards cost the way the inventory guards rules. `evals/token-budget.json` holds a budget per instruction file. Check 28 fails when a file outgrows its budget. [development.md](development.md#token-budget) has the details.

### Dual extraction, planned

An inventory written by one reader misses what that reader misses. A later change will compare two independent extractions of the rules for each remaining skill, agent and command. A disagreement will list the rules that only one extraction found. It is not built yet. The inventories are written by hand first.
