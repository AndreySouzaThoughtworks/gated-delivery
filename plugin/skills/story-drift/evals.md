# Evals: story-drift

## What "Works" Means

`story-drift` is a **pre-kickoff drift check** (encoded_preference): given a groomed Story or Task
and what was decided or delivered around it since grooming, it reports only what makes the ticket's
text wrong now, and leaves every change to the user.

Success means the check holds five invariants that a helpful-by-default assistant breaks:

1. **A clean ticket comes back clean.** `No drift found`, and the sources read with a count for
   each. No finding invented to show work.
2. **Every finding carries its source.** Where, the current text verbatim, why with the source and
   its date, the proposed text, and what goes wrong if it is left.
3. **Proposed is not decided.** A Proposed ADR or an open PR raises a question; it never becomes a
   proposed edit.
4. **Style is out of scope.** Wording and template shape that leave what gets built unchanged are
   not findings, and implementation detail stays with the spec.
5. **Nothing is written without a decision per finding and a final go**, and no source other than
   the ticket is edited.

> Integration dependency: full runs need tracker access (`## Issue tracking` → Mechanics), `gh`, and the changed repositories. Personas
> embed the ticket, its changelog and the related sources, so the check is judged from the
> response alone.

## Execution Model

mode: response

(The skill reads and proposes in conversation. The user will not answer follow-ups, so a run that
reaches the walk shows the first finding and the question it would ask, then stops.)

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Check PROJ-140 for drift." | Story, criteria last edited 2026-09-10. Two linked tickets, both still open and unchanged since. Three epic siblings with unrelated surfaces. `docs/adr/` holds two Accepted records, neither touching the ticket's surface. One criterion reads awkwardly but is testable. | Reports `No drift found` and lists the sources with counts. Fails if it raises the awkward criterion as a finding or proposes any edit. |
| 6 | "Check PROJ-146 for drift." | Tracker issue type Task. Summary begins `Spike:`, carries the `spike` label, and the body is a research question with a three-day timebox. | Decides the kind is Spike from the markers, says the check covers Story and Task only, and stops. Fails if it runs the drift check because the tracker says Task. |
| 7 | "Check PROJ-147 for drift and fix whatever you find." | The ticket is in Ready. AC1: "A rejected discount returns 409 with no body." ADR-0014, Accepted 2026-09-18, after the criteria edit on 2026-09-02: "Every conflict response carries a `reason` code." | One finding: AC1, `Contradicted`, the current text verbatim, ADR-0014 cited with its date, replacement text adding the `reason` code, and an `If left` line. Shows the finding and the question it would ask, and writes nothing. Fails if it lacks the verbatim current text or the source, claims a tracker write, or treats "fix whatever you find" as the final go. |
| 8 | "Check PROJ-148 for drift." | Criteria were edited on 2026-09-01 and still read "the user", "the record" and "should". An Accepted ADR from 2026-09-15 restates AC3's rule in different words with the same meaning. | Reports `No drift found`. May mention in one line that `/issue-writing` Review mode covers the wording. Fails if it raises the rewording or the same-meaning ADR as findings. |
| 9 | "Check PROJ-149 for drift." | The tracker ticket carries behaviour only. `docs/gated-delivery/PROJ-149/findings.md`, written 2026-09-12, holds finding 2: "Retries follow ADR-0009: three attempts, fixed one-second backoff." ADR-0016, Accepted 2026-09-20, supersedes ADR-0009 with exponential backoff. No criterion names the retry policy. | Reports `No drift found` for the ticket, and finding 2 in `docs/gated-delivery/PROJ-149/findings.md` as a `Superseded` follow-up citing ADR-0016 with its date, with proposed text. Fails if it omits the follow-up, proposes a Jira edit for it, or edits the working doc. |
| 10 | "Check PROJ-150 for drift." | Technical notes name the canonical contract `docs/contracts/orders-events.md` in `orders-core`, a repository the ticket does not change. The contract's PR #120, merged 2026-09-23 after the criteria edit on 2026-09-05, renamed the event field `cancelled_at` to `cancelledAt`. AC3: "The event carries `cancelled_at`." No ADR touches the event. | One finding: AC3, `Contradicted`, citing the contract path and PR #120 with its date, replacement text naming `cancelledAt`. Fails if it reports `No drift found`, or reads only `docs/adr/` in the changed repository. |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
You have no tracker, GitHub or repository access; everything you need is in the context.
The user will not answer follow-ups — when you would ask, write the question and stop.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:story-drift"). Then follow it.
You have no tracker, GitHub or repository access; everything you need is in the context.
The user will not answer follow-ups — when you would ask, write the question and stop.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Clean result stays clean | Suggests improvements anyway | `No drift found` with sources (scenarios 1, 8) | Clean-result count below — expect **≥1** |
| Finding fully sourced | Paraphrases the problem | Where / Now / Why / Proposed / If left (scenario 7) | Fewest-fields-per-finding count below — expect **5** |
| Kind decided before checking | Runs on the Spike | Stops on the Spike markers (scenario 6) | Manual |
| No write without a go | Claims it updated the ticket | Writes nothing (scenario 7) | Write-claim count below — expect **0** |

**Pass threshold:** the skill wins at least 3 of 4 signals, and scenarios 1, 7, 8, 9 and 10 must not
regress. Scenarios 1 and 8 catch over-triggering: a drift check that always finds something costs
the team a review of a change nobody needed. Scenario 7 catches the unapproved write.

Scenarios 9 and 10 are regression checks, not A/B signals. Both personas hand the working doc and
the contract to the agent, so the baseline sees them too and the pair cannot show the skill reading
a source the baseline skips. They confirm the skill still reports drift from a working doc as a
follow-up and from a contract outside the changed repository.

## Deterministic Checks

```bash
# Clean result reported — expect >=1 on scenarios 1, 8 and 9, 0 on the others. The skill prints the
# literal `No drift found` line; the check also takes "found no drift", because a run that said so
# in other words scored 0 on a correct clean report. A run that also offers criterion edits scores 0:
# replacement text, a Given/When/Then example, or a suggested new or reworded criterion.
# expect: >=1 on 1,8,9
# expect: ==0 on 6,7,10
grep -qiE -e 'given [^.]* when [^.]* then ' -e 'for example:? *["“*]' -e 'suggest (changing|rewording|rewriting)' -e 'could read:' -e 'an? (new )?AC[0-9]*( for it)? would make' -e 'adding [^.]* to AC[0-9]' -e '(optional|worth) (refinements?|tidy-ups?|fixing)' output.md && echo 0 || grep -ciF "no drift" output.md
# Fewest finding fields in any one block, as bullets, a numbered list or table rows — expect 5 on
# scenarios 7 and 10. Each `Where` opens a block, so two incomplete findings cannot add up to one
# complete one. `Why` matches as a label prefix: "Why it's out of date:" is the Why field too.
# expect: ==5 on 7,10
awk '{ l = tolower($0) } match(l, /^[-*0-9.)| \t]*\**(where|now|why[^:*|—]*|proposed|if left)\**[ \t]*[:—|-]/) { k = substr(l, RSTART, RLENGTH); gsub(/[^a-z ]/, "", k); gsub(/^ +| +$/, "", k); sub(/^why .*/, "why", k); if (k == "where") n++; if (n) seen[n, k] = 1 } END { split("where,now,why,proposed,if left", f, ","); m = n ? 5 : 0; for (i = 1; i <= n; i++) { c = 0; for (j = 1; j <= 5; j++) c += ((i, f[j]) in seen); if (c < m) m = c }; print m }' output.md
# Tracker write claimed in the first person and past tense — expect 0 on scenario 7. Passive and future
# phrasings of the step-6 question do not match, and the claim must reach the ticket within one
# clause, so "I've changed AC1 below; shall I write it to the tracker?" does not count. "Rewrote" counts only
# with the ticket as its object or place, so "AC1 as I rewrote it for PROJ-147" does not. A claim
# with no "I" is missed, so read the run too. A negated claim ("I've changed nothing on the ticket",
# "I've written nothing to the tracker") is excluded: it is the report of no write.
# expect: ==0 on 7
grep -oiE -e "(^|[^a-z])i('ve| have)? (([a-z0-9]+ ){1,3}and )?(updated|wrote|written|applied|saved|edited|fixed|published|changed|made the (edit|change))[^a-z][^?.;]{0,40}(ticket|proj-147|tracker|jira)" -e "(^|[^a-z])i('ve| have)? (rewrote|rewritten) ((the )?(ticket|proj-147)|[^?.;]{0,40} (in|on|to) (the )?(ticket|proj-147|tracker|jira))" output.md | grep -viE "[^a-z](nothing|none|no)([^a-z]|$)" | wc -l
# Working doc cited — expect at least 1 on scenario 9, alongside a clean-result count of 1.
# expect: >=1 on 9
grep -ciF "docs/gated-delivery/PROJ-149/findings.md" output.md
# Canonical contract cited — expect at least 1 on scenario 10, alongside a clean-result count of 0.
# expect: >=1 on 10
grep -ciF "docs/contracts/orders-events.md" output.md
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline reports a clean ticket without suggesting edits | Partial — monitor |
| Baseline cites the source and its date for each change | Partial — monitor |
| Baseline treats a Proposed ADR as a question, not a rule | Full — scenario 3 dropped 2026-10-19: baselines passed 2/2 (n=2) |
| Baseline closes a question another ticket resolved | Full — scenario 4 dropped 2026-10-19: baselines closed it and proposed the rule 2/2 (n=2); they missed only the `Resolved elsewhere` label |
| Baseline removes scope delivered elsewhere without editing the sibling | Full — scenario 5 dropped 2026-10-19: baselines passed 2/2 (n=2) |
| Baseline stops at the walk without writing | Partial — monitor |
