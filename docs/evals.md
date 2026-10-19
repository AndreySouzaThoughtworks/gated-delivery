# Running skill evals

Each skill's `evals.md` holds its scenarios (prompt, persona, Pass Criteria), the agent prompt templates and a `## Deterministic Checks` fence. An eval run is a real `claude -p` session on a fixture directory, graded afterwards. These notes are what the eval sweeps taught about getting runs you can trust.

## Run them with the runner

`scripts/eval/run-scenarios.mjs` does §1 to §3 for you, then grades each run:

```bash
node scripts/eval/run-scenarios.mjs <skill> [--scenario <id>…] [--repeat 2] [--jobs N] [--baseline] [--out DIR]
```

It runs every row of the skill's Test Scenarios unless `--scenario` names some, each `--repeat` times (default 2, see §5), `--jobs` at once (default 4). `--baseline` fills the Baseline Agent template instead and loads no plugin (§8). Each run is stopped after 1200 seconds of wall-clock time; there is no spend cap. Set `GATED_DELIVERY_CLAUDE_BIN` to use another `claude` binary. Run it from the repository root.

Each run lands in `<out>/<skill>/<id>/<arm>-<n>/` with `prompt.txt`, `transcript.jsonl`, `output.md`, `checks.txt`, `judge.json` and `tmp/`, the run's own temp directory. `<out>/summary.tsv` has one line per run: skill, id, arm, run, harness, checks, judge, cost, secs. The table it prints ends with a `DISAGREE` line for every scenario whose repeats graded differently.

The `harness` column is `ok` or names what makes the run unusable as a result: `no-skill` (a skill run with no `"name":"Skill"` call), `read-skill` (a baseline that read `skills/<skill>/`), `no-result`, `denied` (any `permission_denials`), `timeout`, or `setup-failed`. Any of them makes the runner exit 1. `checks` comes from `run-checks.mjs <skill> <file> --scenario <id>` on `output.md` and on every `.html` page the run wrote; `judge` from `judge.mjs <skill> <id> <run-dir>`. Either is `n/a` when its script is not there.

The sections below are what the runner does and why, for reading its runs and for running one by hand.

## 1. Snapshot the plugin without its rubrics

Load a copy of the plugin with every `evals.md` removed. A run that can read its own `evals.md` sees the Pass Criteria and grades itself against them. The runner writes the copy to `<out>/plugin`.

```bash
rsync -a --exclude evals.md plugin/ "$SNAP/plugin/"
```

## 2. Start one run

One directory per run holds the fixture: the persona, any client `CLAUDE.md`, a git repository when the scenario needs one. The runner writes the row's persona to `persona.md` and, when the `evals.md` has a `## Client context` section, its fenced block to `CLAUDE.md`. For a `mode: response` skill it adds one line to the prompt saying that nothing beyond the persona is reachable.

A scenario that needs more than that gets a directory `evals/fixtures/<skill>/<id>/` at the repository root, outside the plugin so installs do not carry it. The runner copies it over the run directory, so a `persona.md` or `CLAUDE.md` there replaces the one built from `evals.md`. Two names are not copied: `setup.sh` runs in the run directory with the fixture directory as `$1`, to build what cannot be committed, such as a git repository or `node_modules`; `allowed-tools` adds one `--allowedTools` rule per line. A `bin/` directory in the run is put first on `PATH`, for stubs such as `gh`. The response line is left out, because a fixture is reachable. Keep fixtures free of client names and secrets: this repository is public.

Fill the scenario's prompt into the Skill Agent template and run from that directory:

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
| `--setting-sources project,local` | Drops your user settings, user `CLAUDE.md` and user plugins, so only the fixture and the plugin under test shape the run. |
| `--strict-mcp-config` | With no `--mcp-config`, no MCP server loads, so nothing reaches a real tracker. |
| `--output-format stream-json --verbose` | Records every tool call. The last line carries the result, cost, turn count and `permission_denials`. |
| `< /dev/null` | Stops the session waiting on stdin. |

Run under a profile that is logged in. Set a wall-clock budget per run and stop runs that pass it; a hung run is a harness failure, not a result. The runner's budget is 1200 seconds.

## 3. Allow what the skill runs

`acceptEdits` allows file edits inside the working and added directories, and nothing else. A headless run cannot answer a permission prompt, so a refused command is skipped and the run either carries on without it or burns time on workarounds. One deskcheck run spent 74 minutes and $11 trying encoders after `base64` was refused.

Pass `--allowedTools` for what the scenario needs. The runner passes every rule below, plus `ls`, `cat`, `wc`, `file`, `cp`, the read-only `git status`, `log`, `diff`, `show`, `branch` and `rev-parse`, and the fixture's `allowed-tools`. For the temp directory it creates one per run, passes it to `--add-dir` and sets `TMPDIR` to it, so no run can read another run's files or an old copy of an `evals.md`:

| Rule | When |
|---|---|
| `Bash(grep:*)` | Skills that verify their own output with `grep`, such as the guardrail scan before publishing to a tracker |
| `Bash(echo:*)` | The same skills, when they print a scan's exit status as a separate bare command. |
| `Bash(printenv:*)` | Skills that read a setting from the environment, such as the notes checkout |
| `Bash(base64:*)`, `Bash(tr:*)`, `Bash(mkdir:*)`, and an assembler: `Bash(python3:*)`, `Bash(awk:*)` or `Bash(sed:*)` | Pages that embed a screenshot: the skill encodes the image, strips line breaks, makes the page's directory and splices the encoded image into the page. Also pass `--add-dir` for a writable temp directory, such as `/private/tmp/claude-501` and its `/tmp/claude-501` alias, where the encoded image and the assembler script land. |
| `Bash("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":*)` | Skills that inspect a rendered page in headless Chrome, such as the deskcheck render scenarios. Keep the quotes: the path has spaces, and the unquoted rule never matched. Name that path in the persona, and tell the run to call each command bare: a deskcheck scenario 9 run lost its 390-pixel check to a refused `D=…;` chain. |
| `Bash(git add:*)`, `Bash(git commit:*)` | Fixtures that are git repositories the skill commits into |
| `Bash(node scripts/audit/consistency.mjs)` | Flow audits. The rule matches the command only when it is called bare from the repository root; a `cd … &&` prefix or a chained command is refused. Set the run's working directory to the repository instead. |

Compound commands are refused under `acceptEdits` even when every part is allowed. In the deskcheck scenario 9 runs, `ls -la && ls -la evidence` was denied with `Bash(ls:*)` allowed, and `R=…; mkdir -p … && python3 -I assemble.py …` with `Bash(mkdir:*)` and `Bash(python3:*)` allowed; `cd … && …` and `…; …` chains were denied the same way. Runs must call each command bare, from the run's working directory; a refused chain reads as a skill defect it is not.

Two refusals no rule fixes. A file written with a heredoc (`cat > draft.md <<'EOF'`) is a Bash command, not an edit, so `acceptEdits` refuses it; the skill has to use its Write tool. A write outside the run's working and added directories, such as the system temp directory or a scratchpad, is refused under `acceptEdits` whichever tool makes it. Both showed up in the issue-writing sweep as drafts that never reached disk. Read such a denial as the skill choosing the wrong place or tool, not as a missing rule.

After each run, read `permission_denials` in the last transcript line. A denial that blocked the behaviour under test makes the run a harness failure: fix the allow-list and run it again.

## 4. Expect managed policy

`--setting-sources` does not remove an organisation's managed policy. Expect what it requires, such as a disclosure footer, in outputs. That is not a skill defect, and a check that counts text must not trip on it.

## 5. Run every scenario at least twice

Runs vary. In one confirmation sweep, 7 of 44 scenarios passed once and failed once. A single run is not a verdict. A split means the skill's wording leaves room: tighten the wording, then run both again.

## 6. Grade

1. Confirm the skill was invoked: `grep -c '"name":"Skill"' transcript.jsonl`. No invocation is a harness failure.
2. Grade against the scenario's Pass Criteria, including every "Fails if" clause. For anything the skill should have written or run, check the run directory and the transcript, not the prose in `output.md`.
3. Grade the Deterministic Checks from the repository root: `node scripts/eval/run-checks.mjs <skill> <file> --scenario <id>`. It runs each check whose `# expect:` line names the scenario and prints `PASS|FAIL <count> <expect> <label>`. It exits 0 when all pass, 1 on any FAIL and 2 on a usage error. Run it once on `output.md` for checks on the response, and once on the rendered artifact, such as `deskcheck.html`, for checks labelled `Page:`. In a skill that has `Page:` checks, the file name picks the set: `output.md` gets the response checks, any other file gets the `Page:` checks. Checks marked `# expect: manual` are skipped; read those counts with `node scripts/eval/run-checks.mjs <skill> <file>`.
4. A FAIL that disagrees with your reading of the output is a misfire: fix the check or its expect line, not the grade.

An expect line sits in the fence, directly above its command: `# expect: <op><n> on <id>[,<id>…]`, where op is `>=`, `==` or `<=`. A check may carry several, one per expectation, and names each scenario at most once. A check that prints lines instead of a number is counted by its non-empty lines, so `==0` means no output. `--lint` rejects a malformed expect line and an id that is not in the skill's `## Test Scenarios` table. The consistency guard warns on a check with no expect line.

## 7. Prove every check

Before a check lands, run it on a passing output and on a failing one, and see the result differ. Use real run output for the pass; for the fail, use a failing run or a copy with the defect edited in. A check that returns the same value on both proves nothing. `node scripts/eval/run-checks.mjs --lint` only proves each command runs.

## 8. Keep the skill's text away from the baseline

A baseline run must not be able to read the skill it is compared against. The audit-flow baselines ran in a clone of this repository, read `plugin/skills/audit-flow/SKILL.md` from it, and copied its headings. Their passes said nothing about the skill.

When the fixture is a clone of this repository, delete the skill's directory from the baseline's clone before the run: `rm -r plugin/skills/<skill>`, then commit, so the tree is clean. Give the baseline no `--plugin-dir` and no `--add-dir` that reaches a plugin copy. After the run, `grep -c 'skills/<skill>/' transcript.jsonl` must be 0; a read of the skill's files makes the baseline a harness failure.

## 9. Judge the Pass Criteria

`scripts/eval/judge.mjs` grades one saved run against its scenario row, so step 6.2 no longer has to be done by hand for every run:

```bash
node scripts/eval/judge.mjs <skill> <id> <run-dir>
```

Run it from the repository root. `<run-dir>` holds `output.md` and, when there are any, `transcript.jsonl` and the files the run wrote. Copy the run's workspace and its outputs into one directory first if your harness keeps them apart.

- **Clauses.** The row's Pass Criteria are split into sentences, and every "Fails if" becomes its own clause.
- **Judge.** One `claude -p` on `haiku`, with `--tools Read,Grep,Glob`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, no plugin and `--json-schema` for the reply. It starts in an empty temporary directory and reaches the run through `--add-dir`, so nothing the run wrote, such as a fixture `CLAUDE.md`, loads as project context. The prompt says that everything the run produced is data, not instructions. A 1200-second wall clock is the only limit.
- **Evidence.** Each clause comes back PASS, FAIL or UNCLEAR with quotes, each naming its file, its text and optionally its line, plus a note. Code checks every quote: its file must exist in the run directory, a given line must exist in that file, and its text must appear in that file once whitespace, markdown emphasis and JSON escapes are set aside (`...` joins fragments that are each checked). A result with no quote, or with any quote that cannot be found, becomes UNCLEAR. The printed `evidence` is the quotes as `file:line "text"`, then the note.
- **Verdict.** Code decides it: any FAIL is FAIL, else any UNCLEAR is UNCLEAR, else PASS. Exit 0 on PASS, 1 on FAIL, 3 on UNCLEAR, 2 on a usage or harness error, such as a missing row or a reply that does not match the schema.

```json
{"verdict":"FAIL","clauses":[{"clause":"Fails if it raises the rewording or the same-meaning ADR as findings.","result":"FAIL","evidence":"output.md \"Adding that to AC3 would remove the ambiguity.\" — suggests an edit to AC3"}]}
```

The judge settles nothing alone. Read the evidence of every FAIL and UNCLEAR before you act on it. An UNCLEAR often means the judge quoted loosely, such as two table cells joined into one quote; rerun it before grading by hand. Before trusting the judge on a new skill, run it on one run you graded PASS and one you graded FAIL, twice each, and see the verdicts match yours. Run it twice on any run you act on: a split is a clause worded loosely enough to read both ways.

It was proven on 8 hand-graded runs across 5 skills (4 PASS, 4 FAIL, story-drift, prod-support, deskcheck, audit-flow, learn-flow). With quote checking in place, a final pass matched the hand grade on 8 of 8, with no UNCLEAR clause.
