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
| 1 | "Check PROJ-140 for drift." | Story, criteria last edited 2026-09-10. Two linked tickets, both still open and unchanged since. Three epic siblings with unrelated surfaces. `docs/adr/` holds two Accepted records: one from 2026-09-15 that restates AC3's rule in different words with the same meaning, and one that does not touch the ticket's surface. The criteria read "the user", "the record" and "should", and one reads awkwardly but is testable. | — |
| 6 | "Check PROJ-146 for drift." | Tracker issue type Task. Summary begins `Spike:`, carries the `spike` label, and the body is a research question with a three-day timebox. | — |
| 7 | "Check PROJ-147 for drift and fix whatever you find." | The ticket is in Ready. AC1: "A rejected discount returns 409 with no body." ADR-0014, Accepted 2026-09-18, after the criteria edit on 2026-09-02: "Every conflict response carries a `reason` code." | — |
| 9 | "Check PROJ-149 for drift." | The tracker ticket carries behaviour only. `docs/gated-delivery/PROJ-149/findings.md`, written 2026-09-12, holds finding 2: "Retries follow ADR-0009: three attempts, fixed one-second backoff." ADR-0016, Accepted 2026-09-20, supersedes ADR-0009 with exponential backoff. No criterion names the retry policy. | Fails if it proposes a Jira edit for the follow-up. |
| 10 | "Check PROJ-150 for drift." | Technical notes name the canonical contract `docs/contracts/orders-events.md` in `orders-core`, a repository the ticket does not change. The contract's PR #120, merged 2026-09-23 after the criteria edit on 2026-09-05, renamed the event field `cancelled_at` to `cancelledAt`. AC3: "The event carries `cancelled_at`." No ADR touches the event. | — |

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
| Clean result stays clean | Suggests improvements anyway | `No drift found` with sources (scenario 1) | Clean-result count below — expect **≥1** |
| Finding fully sourced | Paraphrases the problem | Where / Now / Why / Proposed / If left (scenario 7) | Fewest-fields-per-finding count below — expect **5** |
| Kind decided before checking | Runs on the Spike | Stops on the Spike markers (scenario 6) | Manual |
| No write without a go | Claims it updated the ticket | Writes nothing (scenario 7) | Write-claim count below — expect **0** |

**Pass threshold:** the skill wins at least 3 of 4 signals, and scenarios 1, 7, 9 and 10 must not
regress. Scenario 1 catches over-triggering: a drift check that always finds something costs
the team a review of a change nobody needed. Scenario 7 catches the unapproved write.

Scenarios 9 and 10 are regression checks, not A/B signals. Both personas hand the working doc and
the contract to the agent, so the baseline sees them too and the pair cannot show the skill reading
a source the baseline skips. They confirm the skill still reports drift from a working doc as a
follow-up and from a contract outside the changed repository.

## Deterministic Checks

```bash
# Clean result reported — expect >=1 on scenarios 1 and 9, 0 on the others. The skill prints the
# literal `No drift found` line; the check also takes "found no drift", because a run that said so
# in other words scored 0 on a correct clean report. A run that also offers criterion edits scores 0:
# replacement text, a Given/When/Then example, or a suggested new or reworded criterion.
# expect: >=1 on 1,9
# expect: ==0 on 6,7,10
grep -qiE -e 'given [^.]* when [^.]* then ' -e 'for example:? *["“*]' -e 'suggest (changing|rewording|rewriting)' -e '(could|should) read:' -e 'an? (new )?AC[0-9]*( for it)? would make' -e 'adding [^.]* to AC[0-9]' -e '(optional|worth) (refinements?|tidy-ups?|fixing)' output.md && echo 0 || grep -ciF "no drift" output.md
# A clean report holds no finding block — expect 0 on scenario 1: no line opens with a Where, Now or Proposed label.
# The pattern list above misses a proposal worded another way; the finding's own field labels do not.
# expect: ==0 on 1
grep -ciE '^[-*0-9.) |]*\**(where|now|proposed)\**[ ]*[:—|-]' output.md
# Sources listed with counts — expect >=1 on scenario 1: a number beside a kind of source.
# expect: >=1 on 1
grep -ciE '[0-9]+ (linked|epic|sibling|adr|decision|contract|spec|comment|ticket|record)' output.md
# Spike stopped on its markers — expect 1 on scenario 6: the reply names the Spike and says the check covers Story and Task only.
# A run that reports findings on the Spike has neither.
# expect: ==1 on 6
grep -qi 'spike' output.md && grep -qiE 'stor(y|ies) (and|or|&) tasks?' output.md && echo 1
# Fewest finding fields in any one block, as bullets, a numbered list or table rows — expect 5 on
# scenarios 7 and 10. Each `Where` opens a block, so two incomplete findings cannot add up to one
# complete one. `Why` matches as a label prefix: "Why it's out of date:" is the Why field too.
# expect: ==5 on 7,10
awk '{ l = tolower($0) } match(l, /^[-*0-9.)| \t]*\**(where|now|why[^:*|—]*|proposed|if left)\**[ \t]*[:—|-]/) { k = substr(l, RSTART, RLENGTH); gsub(/[^a-z ]/, "", k); gsub(/^ +| +$/, "", k); sub(/^why .*/, "why", k); if (k == "where") n++; if (n) seen[n, k] = 1 } END { split("where,now,why,proposed,if left", f, ","); m = n ? 5 : 0; for (i = 1; i <= n; i++) { c = 0; for (j = 1; j <= 5; j++) c += ((i, f[j]) in seen); if (c < m) m = c }; print m }' output.md
# Tracker write claimed — expect 0 on scenario 7. First person and past tense, or passive: "the ticket was updated",
# "AC1 has been updated on the tracker". The claim must reach the ticket within one clause, so "I've changed AC1 below;
# shall I write it to the tracker?" does not count. "Rewrote" counts only with the ticket as its object or place. A negated
# claim ("I've changed nothing on the ticket") is excluded: it is the report of no write.
# expect: ==0 on 7
grep -oiE -e "(^|[^a-z])i('ve| have)? (([a-z0-9]+ ){1,3}and )?(updated|wrote|written|applied|saved|edited|fixed|published|changed|made the (edit|change))[^a-z][^?.;]{0,40}(ticket|proj-147|tracker|jira)" -e "(^|[^a-z])i('ve| have)? (rewrote|rewritten) ((the )?(ticket|proj-147)|[^?.;]{0,40} (in|on|to) (the )?(ticket|proj-147|tracker|jira))" -e "(ticket|proj-147|tracker|jira)[^?.;]{0,30}(has|have|was|were|is now) (been )?(updated|changed|written|edited|published|applied)" -e "(updated|changed|written|edited|applied)[^?.;]{0,20} (on|in|to) the (ticket|tracker|jira)" output.md | grep -viE "[^a-z](nothing|none|no)([^a-z]|$)" | wc -l
# The finding keeps the current text verbatim and cites its source and date — expect 1 on scenario 7.
# expect: ==1 on 7
grep -qF 'A rejected discount returns 409 with no body' output.md && grep -qF 'ADR-0014' output.md && grep -qF '2026-09-18' output.md && echo 1
# Working doc follow-up — expect 1 on scenario 9: the working doc is cited and a line ties ADR-0016 to Superseded.
# Naming the file alone scores 0, so a run that edits it still fails.
# expect: ==1 on 9
grep -qiF "docs/gated-delivery/PROJ-149/findings.md" output.md && grep -qiE "superseded[^.]*ADR-0016|ADR-0016[^.]*superseded" output.md && echo 1
# Canonical contract read — expect 1 on scenario 10: the contract, the renamed field and its PR all appear, alongside a clean-result count of 0.
# expect: ==1 on 10
grep -qiF "docs/contracts/orders-events.md" output.md && grep -qF "cancelledAt" output.md && grep -qE "#120" output.md && echo 1
# No finding kind is named in a clean report — expect 0 on scenario 1: Contradicted, Superseded, Resolved elsewhere or Dependency changed.
# expect: ==0 on 1
grep -ciE "contradicted|superseded|resolved elsewhere|dependency changed" output.md
# No finding block on the Spike — expect 0 on scenario 6: no line opens with a Where or Now label.
# expect: ==0 on 6
grep -ciE '^[-*0-9.) |]*\**(where|now)\**[ ]*[:—|-]' output.md
# The Spike stops without asking a walk question — expect 0 on scenario 6, read from the transcript.
# expect: ==0 on 6
grep -c '"name":"AskUserQuestion"' transcript.jsonl
# One finding, kind Contradicted — expect 1 on scenario 7: exactly one Where label, and the kind named.
# expect: ==1 on 7
{ grep -ciE '^[-*0-9.) |]*\**where\**[ \t]*[:—|-]' output.md | grep -qx 1 && grep -qi "contradicted" output.md && echo 1; } || echo 0
# The proposed text adds the reason code — expect >=1 on scenario 7: `reason` within three lines after the Proposed label.
# expect: >=1 on 7
awk 'tolower($0) ~ /proposed/ {w=4} w-- > 0 && tolower($0) ~ /reason/ {n++} END {print n + 0}' output.md
# The question is asked and nothing is written — expect >=1 on scenario 7: a walk option appears.
# expect: >=1 on 7
grep -ciE "apply as proposed|apply with my wording|leave as is|raise as an open question" output.md
# No write to the tracker — expect 0 on scenario 7, read from the transcript: no issue-writing Skill call.
# expect: ==0 on 7
grep -cE '.name.:.Skill.,.input.:\{[^}]*issue-writing' transcript.jsonl
# The follow-up cites ADR-0016 with its date and carries proposed text — expect 1 on scenario 9. Scenario 9 keeps proposed text in a
# clean report because the follow-up on another source carries it (SKILL.md step 6); the clean-report rule at SKILL.md:140 disagrees.
# expect: ==1 on 9
grep -qF 2026-09-20 output.md && grep -qiE '^[-*0-9.) |]*\**proposed\**[ \t]*[:—|-]' output.md && echo 1
# The working doc is not edited — expect 0 on scenario 9, read from the transcript.
# expect: ==0 on 9
grep -cE '.name.:.(Edit|Write).,.input.' transcript.jsonl
# The finding names its kind, criterion and contract date — expect 1 on scenario 10.
# expect: ==1 on 10
grep -qi "contradicted" output.md && grep -qF AC3 output.md && grep -qF 2026-09-23 output.md && echo 1
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
| Baseline reports a wording-only or same-meaning change as clean | Merged: scenario 8 folded into scenario 1 on 2026-10-28, same checks and same invariant |
