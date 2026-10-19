# Running skill evals

Each skill's `evals.md` holds its scenarios (prompt, persona, Pass Criteria), the agent prompt templates and a `## Deterministic Checks` fence. An eval run is a real `claude -p` session on a fixture directory, graded afterwards. These notes are what the eval sweeps taught about getting runs you can trust.

## 1. Snapshot the plugin without its rubrics

Load a copy of the plugin with every `evals.md` removed. A run that can read its own `evals.md` sees the Pass Criteria and grades itself against them.

```bash
rsync -a --exclude evals.md plugin/ "$SNAP/plugin/"
```

## 2. Start one run

One directory per run holds the fixture: the persona, any client `CLAUDE.md`, a git repository when the scenario needs one. Fill the scenario's prompt into the Skill Agent template and run from that directory:

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

Run under a profile that is logged in. Set a wall-clock budget per run and stop runs that pass it; a hung run is a harness failure, not a result.

## 3. Allow what the skill runs

`acceptEdits` allows file edits inside the working and added directories, and nothing else. A headless run cannot answer a permission prompt, so a refused command is skipped and the run either carries on without it or burns time on workarounds. One deskcheck run spent 74 minutes and $11 trying encoders after `base64` was refused.

Pass `--allowedTools` for what the scenario needs:

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
3. Run the Deterministic Checks from the repository root: `node scripts/eval/run-checks.mjs <skill> <file>`. Pass the file each check reads: `output.md` for checks on the response, and the rendered artifact, such as `deskcheck.html`, for checks labelled `Page:`. A check run on the wrong file returns a 0 that reads as a result.
4. Compare each count with the expectation in its label. A count that disagrees with your reading of the output is a misfire: fix the check, not the grade.

## 7. Prove every check

Before a check lands, run it on a passing output and on a failing one, and see the result differ. Use real run output for the pass; for the fail, use a failing run or a copy with the defect edited in. A check that returns the same value on both proves nothing. `node scripts/eval/run-checks.mjs --lint` only proves each command runs.

## 8. Keep the skill's text away from the baseline

A baseline run must not be able to read the skill it is compared against. The audit-flow baselines ran in a clone of this repository, read `plugin/skills/audit-flow/SKILL.md` from it, and copied its headings. Their passes said nothing about the skill.

When the fixture is a clone of this repository, delete the skill's directory from the baseline's clone before the run: `rm -r plugin/skills/<skill>`, then commit, so the tree is clean. Give the baseline no `--plugin-dir` and no `--add-dir` that reaches a plugin copy. After the run, `grep -c 'skills/<skill>/' transcript.jsonl` must be 0; a read of the skill's files makes the baseline a harness failure.
