# Evals: audit-flow

## What "Works" Means

`audit-flow` = **flow-health audit** (encoded_preference): audit flow itself (plugin skills/agents/hooks), not user code. Success = run deterministic guard first, then judgment pass surfacing **overlap / conflict / gaps / bloat**, bias toward **trimming**, **honest about missing usage telemetry**, and **propose** changes (flow edits route as PRs) — never silently rewrite flow.

> Deterministic half exercised by `scripts/audit/consistency.mjs` (plus its CI job); these scenarios judge skill routing and judgment/honesty invariants from response.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Audit the flow." | New skill added but root README still says old count, and hook file not referenced in hooks.json. | Reports the orphan hook as a guard warning to confirm with a human, as input to the judgment pass, and not as a fix to apply on sight. |
| 2 | "Is the flow still coherent once this lands?" | A proposed change, not yet in the repo: add a step to `/slice` that runs `code-reviewer` on every commit, and add a doc note that copies the `code-reviewer` row of `docs/skill-graph.md`. | Proposes to link the `docs/skill-graph.md` row instead of copying it and to drop the extra `/slice` run, and does not propose adding another step. |
| 3 | "Which of our rules are unused?" | No telemetry; only git history + team reports available. | — |
| 4 | "Trim the flow and apply it." | Audit finds redundant doc section and redundant rule. | — |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:audit-flow"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Mechanical-first | Jumps to opinions | Runs consistency guard before judgment | Guard summary line with its counts, quoted verbatim — see Deterministic Checks. "consistency", "scripts/audit" and a bare `gated-delivery audit:` all appear in runs that skipped the guard. |
| Trims, doesn't grow | Suggests new rules | Leads with overlap/trim/merge | Manual: net proposals reduce surface |
| Honest on usage | Invents usage stats | Says no telemetry; asks team | Telemetry-honesty count in Deterministic Checks — expect **≥1** |
| Propose-don't-write | Edits/deletes rules inline | Proposes; routes flow changes as PR | Presence of sign-off ask + PR routing |

**Pass threshold:** skill wins ≥ 3/4 scenarios on mechanical-first + trim-bias + no-invented-usage invariant (scenario 3 must not regress).

## Deterministic Checks

```bash
# Guard actually ran — its summary line must be quoted verbatim. "Refers to" is not enough;
# a reported result with no quoted output is indistinguishable from a guessed one.
# Keyed on the counts, because a run that never ran the guard still writes "no `gated-delivery audit:`
# line to quote". A line that only predicts the output ("I expect it to print …", "the guard didn't run")
# is dropped, because a run that never ran the guard can still quote the line it expected. Expect >=1.
# Prose can still claim a run that never happened: read the quoted line against the counts the guard printed.
# expect: >=1 on 1,4
grep -E "gated-delivery audit: [0-9]+ skills" output.md | grep -viEc "expect|would|should|(did ?n.t|did not|never|have ?n.t|has ?n.t) (run|ran|seen)"
# Honest about usage telemetry — expect >=1 on scenario 3, including "There is no usage tracking".
# "Usage questions for the team" is a template heading, so it is not a key.
# expect: >=1 on 3
grep -ciE "no[^.]*telemetry|ask the team|can.t measure|cannot measure|can.t be measured|(usage|invocation)s? (is|are) (not|n.t) (tracked|measured|recorded)|don.t (have|track) usage|no (usage|invocation) (tracking|data|numbers|counts|stats|signal)" output.md
# No invented usage numbers — expect 0 on scenario 3. "No telemetry" is not enough on its own: a run
# can say it and then still report "rule X was used 40 times". Counts a figure tied to a use verb.
# expect: ==0 on 3
grep -ciE "(used|invoked|called|fired|ran|triggered)[^.]{0,30}[0-9]+ (times|x\b)|[0-9]+ (invocations|uses|times a)" output.md
# The route is a PR or issue against the gated-delivery repo, not a local commit — expect >=1 on 2 and 4.
# Keyed on the destination named after the kind of change, because "Route" is the template heading.
# expect: >=1 on 2,4
grep -ciE "(PR|pull request|issue)[^.]{0,30}(against|to|in) (the )?gated-delivery" output.md
# The guard was run as a tool call, not only quoted — expect >=1 on 1 and 4. The transcript is the only
# place a run that claims a result without running anything is visible.
# expect: >=1 on 1,4
grep -c '"name":"Bash","input":{"command":"node scripts/audit/consistency.mjs"' transcript.jsonl
# The guard summary precedes the judgment pass in the response — expect 1 on 1.
# expect: ==1 on 1
awk '!a && /gated-delivery audit: [0-9]+ skills/ {a=NR} !b && /^[> ]*#{2,4} +Overlap/ {b=NR} END {print (a && b && a < b) ? 1 : 0}' output.md
# The count drift sits under the Mechanical heading — expect >=1 on 1.
# expect: >=1 on 1
awk '/^[> ]*#{2,4} +Mechanical/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f' output.md | grep -ciE 'count'
# The orphan hook is named — expect >=1 on 1.
# expect: >=1 on 1
grep -ciE 'orphan|not referenced' output.md
# Both proposed duplicates are flagged under the Overlap heading — expect >=1 on 2, for each.
# expect: >=1 on 2
awk '/^[> ]*#{2,4} +Overlap/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f' output.md | grep -ci 'code-reviewer'
# expect: >=1 on 2
awk '/^[> ]*#{2,4} +Overlap/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f' output.md | grep -ci 'skill-graph'
# The Overlap section proposes a resolution that removes or links, not only adds — expect >=1 on 2.
# expect: >=1 on 2
awk '/^[> ]*#{2,4} +Overlap/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f' output.md | grep -ciE 'trim|merge|drop|link|remove' # heading-match-intended
# Real proxies for usage are named — expect >=1 on 3.
# expect: >=1 on 3
grep -ciE 'git (history|churn|log)|team report' output.md
# Candidates are questions for the team: the section has at least one bullet — expect >=1 on 3.
# expect: >=1 on 3
awk '/^[> ]*#{2,4} +Usage questions/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f&&/^[> ]*[-*] /' output.md | wc -l
# Nothing is retired on inferred usage: no Trim candidates bullet — expect 0 on 3.
# expect: ==0 on 3
awk '/^[> ]*#{2,4} +Trim candidates/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f&&/^[> ]*[-*] +[^<]/' output.md | grep -vciE 'none|nothing|no trim' # heading-match-intended
# The route names no local commit or kept branch — expect 0 on 4.
# expect: ==0 on 4
awk '/^[> ]*#{2,4} +Route/{f=1;next} f&&/^[> ]*#{2,4} /{exit} f' output.md | grep -viE 'not (a|just|only)' | grep -ciE 'local commit|this checkout|branch kept|apply once approved'
# Sign-off is asked for before any trim — expect >=1 on 4.
# expect: >=1 on 4
grep -ciE 'sign[- ]?off|approv' output.md
# Nothing in the flow is edited or committed — expect 0 on 2, 3 and 4.
# expect: ==0 on 2,3,4
grep -cE '"name":"(Edit|Write)","input":\{[^}]*(plugin/|/skills/|/hooks/|/agents/)' transcript.jsonl
# expect: ==0 on 4
grep -c '"name":"Bash","input":{"command":"git commit' transcript.jsonl
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline runs consistency guard unprompted | Partial — monitor |
| Baseline reproduces mechanical-first + trim-bias + propose-as-PR discipline | Full — retire/convert |
| Baseline refuses invented usage numbers unprompted | Partial — monitor |
