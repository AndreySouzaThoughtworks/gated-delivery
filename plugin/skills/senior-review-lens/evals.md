# Evals: senior-review-lens

## What "Works" Means

`senior-review-lens` = **structural self-audit** (encoded_preference): given diff (Lenses A–G)
or ADR/design doc (Lens H), run relevant lenses, auto-apply mechanical fixes, surface
judgment calls — end in `READY-TO-COMMIT | REVISE-FIRST` verdict. Success = catch
**structural / cohesion** design issues correctness-only reviewer miss (where helper belong,
table-vs-inline, test-pyramid placement, dead type variants, compiler-enforced over
hand-discipline, framing depth) **without** drift into correctness review (that `code-reviewer`
job) or invent findings on clean code.

> Only scenario 4, the clean-diff guard, remains. The lens-catch scenarios were retired because a
> no-skill baseline finds the same issues (see Saturation Signals). No scenario exercises a lens
> finding, and Lens H (framing depth) has no eval scenario.

> No integration dependency: scenarios embed diff/doc in persona, so audit judged from
> response. Lens exercised named in persona, not prompt.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 4 | "Ready?" | Diff = clean, well-placed bug fix with focused unit test at right layer; nothing structural off. The diff compiles as shown: the new spec file imports the helper it tests. | Returns **READY-TO-COMMIT**, does NOT invent structural findings. Does not flag style/naming nits. |

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
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:senior-review-lens"). Then follow it.
The user will not answer follow-ups — use the context to decide yourself.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Explicit verdict | Ends with vague "looks fine" | Emits `READY-TO-COMMIT` or `REVISE-FIRST` | `grep -cE -e '^READY-TO-COMMIT$' -e '^REVISE-FIRST$' output` — anchored to token alone on own line, so template placeholder does not count. Two `-e` patterns not one alternation: `\|` escaped for markdown table reaches regex as literal pipe, matches nothing. |
| Stays in lane (no false finds) | May invent structure/style nits on clean code | Returns READY-TO-COMMIT on clean diff (scenario 4) | Manual: zero invented findings |

**Pass threshold:** scenario 4 passes on every run. It is the only scenario and must not regress.

## Deterministic Checks

```bash
# Invented finding on the clean diff — a lens named with a finding, either "Lens A" in prose or a
# lens-table row such as "| A. Cohesion | 1 finding |". A row reporting CLEAN or N/A does not count,
# and neither does a line saying a lens does not apply ("Lens H doesn't apply"). Expect 0 on 4.
# expect: ==0 on 4
grep -iE '\blens [a-h]\b|^\| *\**[a-h]\. [^|]+\| *\**[0-9]+ findings?' output.md | grep -viEc "n.t apply|not apply|N/A"
# A verdict was emitted — expect 1 on 4, where the token is READY-TO-COMMIT
# expect: ==1 on 4
grep -cE -e '^READY-TO-COMMIT$' -e '^REVISE-FIRST$' output.md   # verdict token, alone on its line
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline raises one structural/cohesion issue unprompted | Full — format-only: baseline finds the same issue, lacks lens vocabulary (n=2, 2026-10-19). Retired scenarios 1 (Lens A, helper in controller), 2 (Lens B, enum branch chain), 3 (Lens C/D, rule tested only in e2e) |
| Baseline reframes an X-vs-Y ADR around the collapsing constraint unprompted | Full — format-only: baseline finds the same issue, lacks lens vocabulary (n=2, 2026-10-19). Retired scenario 5; Lens H has no eval scenario |
| Baseline reproduces A–H lens taxonomy + verdict format without skill | Full — retire/convert |
| Baseline correctly declines to flag clean diff (scenario 4) unprompted | Partial — monitor |
