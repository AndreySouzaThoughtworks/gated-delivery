# Evals: senior-review-lens

## What "Works" Means

`senior-review-lens` = **structural self-audit** (encoded_preference): given diff (Lenses A–G)
or ADR/design doc (Lens H), run relevant lenses, auto-apply mechanical fixes, surface
judgment calls — end in `READY-TO-COMMIT | REVISE-FIRST` verdict. Success = catch
**structural / cohesion** design issues correctness-only reviewer miss (where helper belong,
table-vs-inline, test-pyramid placement, dead type variants, compiler-enforced over
hand-discipline, framing depth) **without** drift into correctness review (that `code-reviewer`
job) or invent findings on clean code.

> No integration dependency: scenarios embed diff/doc in persona, so audit judged from
> response. Lens exercised named in persona, not prompt.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Is this ready to push?" | Diff adds `formatCurrency` helper inside `user.controller.ts`; codebase already has `formatting/` util home. | Fires **Lens A** (cohesion): flags helper natural home = formatting util, not controller. Proposes move. |
| 2 | "Review this before I commit." | Diff introduces 6-branch `if/else if` mapping status enum → label string, inline in method. | Fires **Lens B** (table-vs-inline): recommends lookup table/map keyed by enum over branch chain. |
| 3 | "Is this good to merge?" | Diff adds new pure validation rule but tests only through full e2e that boots app; no unit test. | Fires **Lens C/D** (pyramid placement / realism): flags behaviour belongs in unit test; e2e tests wrong layer. |
| 4 | "Ready?" | Diff = clean, well-placed bug fix with focused unit test at right layer; nothing structural off. The diff compiles as shown: the new spec file imports the helper it tests. | Returns **READY-TO-COMMIT**, does NOT invent structural findings. Does not flag style/naming nits. |
| 5 | "Check the framing of this ADR." | ADR poses "Postgres vs Mongo for the audit log", but persona notes hard 7-year immutable-retention + PII-erasure constraint that already collapses choice. | Fires **Lens H** (framing depth): restates decision one level deeper around retention/erasure constraint before accepting X-vs-Y framing. |

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
| Structural cohesion catch | Approves; only checks correctness | Names lens + misplaced/structural issue (scenarios 1–3, 5) | Lens-named count in Deterministic Checks — **≥1** on 1–3 and 5, **0** on 4 |
| Auto-apply vs surface split | Lumps everything into one comment list | Separates auto-applied mechanical fixes from judgment calls | **Manual:** content under both headings, each item under right one? Not greppable — both headings part of output template, so any template-shaped output matches regardless. |
| Explicit verdict | Ends with vague "looks fine" | Emits `READY-TO-COMMIT` or `REVISE-FIRST` | `grep -cE -e '^READY-TO-COMMIT$' -e '^REVISE-FIRST$' output` — anchored to token alone on own line, so template placeholder does not count. Two `-e` patterns not one alternation: `\|` escaped for markdown table reaches regex as literal pipe, matches nothing. |
| Stays in lane (no false finds) | May invent structure/style nits on clean code | Returns READY-TO-COMMIT on clean diff (scenario 4) | Manual: zero invented findings |
| Framing depth on ADRs | Accepts surface X-vs-Y question | Restates decision around collapsing constraint | Manual (scenario 5) |

**Pass threshold:** skill wins ≥ 2/3 of 5 scenarios on naming right lens + holding
no-false-findings invariant (scenario 4 must not regress).

## Deterministic Checks

```bash
# A lens was named with a finding — either "Lens A" in prose or a lens-table row such as
# "| A. Cohesion | 1 finding |". A row reporting CLEAN or N/A does not count, and neither does a
# line saying a lens does not apply ("Lens H doesn't apply"). Expect >=1 on 1–3 and 5, 0 on 4.
grep -iE '\blens [a-h]\b|^\| *\**[a-h]\. [^|]+\| *\**[0-9]+ findings?' output.md | grep -viEc "n.t apply|not apply|N/A"
# A verdict was emitted
grep -cE -e '^READY-TO-COMMIT$' -e '^REVISE-FIRST$' output.md   # verdict token, alone on its line
# auto-applied vs surfaced: MANUAL. Both are template headings, so any grep on them matches
# a template-shaped run that separated nothing.
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline raises one structural/cohesion issue unprompted | Partial — monitor |
| Baseline reproduces A–H lens taxonomy + verdict format without skill | Full — retire/convert |
| Baseline correctly declines to flag clean diff (scenario 4) unprompted | Partial — monitor |
