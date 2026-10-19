---
name: repo-forensics
description: Inspect-first pass before changing existing code: name the surfaces that matter, separate verified from inferred, mark disagreements, name what could break, stop at the smallest safe step. Use before editing existing code, on "inspect first", "don't implement yet", "what's actually true here", "what could break", or when docs, tests and behaviour may disagree. Runs before a change exists.
---
# repo-forensics — make current repo reality inspectable before changing it

**Model knowledge is not delivery truth. Current repo reality is** — code, tests, docs, config,
workflows, recent history, architecture decisions, product and business assumptions, runtime
behaviour and logs where available, and what team can verify.

First job not generating code. Job is knowing what true here, and making risk of changing it
visible.

## Two depths

**Name tier in first line**, one clause on why. Two-tier skills fail by silently picking wrong tier;
naming it makes misfire visible at glance instead of after eleven sections.

| Tier | When |
|------|------|
| **Quick posture** (default) | Any change to existing code. Short — handful of lines. |
| **Full pass** | Change touches existing behaviour across files, surfaces may disagree, diff will be hard to review, or human decision hiding inside it. |

Typo, log line, version bump gets a look and a sentence — not eleven sections. Escalate only on
triggers above.

---

## Quick posture — the default

Before writing code, inspect relevant files and repository context. **Do not implement yet.**
List:

1. **What you can verify from the repository** — each claim with locator.
2. **What you are inferring** — and why.
3. **What remains uncertain.**
4. **Where the surfaces disagree** — one line each, no ledger. Open this item with one of two exact
   phrases, so finding unambiguous to reader and grader:

   - `Surfaces disagree:` then one line per disagreement, naming both artifacts.
   - `Surfaces agree.` when they don't.

   **Escalation is caller's call, not yours.** Standalone, recommend full pass and let user choose.
   When `/slice` or `/spec` invoked you, hand finding back and stop — `/slice` step 0 falls through
   to step 1 on it, and `/spec` step 3 already running full pass. Expanding tier yourself turns "a
   handful of lines" into eleven sections at a gate that only needed yes/no, and makes `/spec` run
   pass twice.
5. **Which files or checks matter** — surfaces change touches, *and* test or command that would
   catch break in each. Naming check up front is what makes next step verifiable, not hopeful.
6. **What could break if this is changed** — blast radius. Grep callers of what you about to touch.
   One guard in shared function beats guard in every caller, and patching only path request names
   leaves every sibling caller broken.
7. **What questions need human confirmation** — asked as questions, not resolved unilaterally.

Only then: **the smallest safe next step.**

---

## Full pass — risky, unclear, review-heavy, or cross-surface work

Same seven, plus three: surface budget, staleness read, disposition per finding. Disagreement
deepens from one-liner into full ledger. Sections in order:

### 1. Surfaces inspected

Which 2–3 surfaces inspected first, and why. Do **not** inspect whole repository by default —
inspect smallest relevant surface area. If you later need more, ask before expanding.

### 2. Verified

The Verified/Inferred rubric is in `prose-writing/writing.md`; this skill adds the locator rule.
What current repo evidence directly supports. Every verified claim carries locator: `file:line`,
test name, config key, commit hash, log line, command output, or documentation reference.

If line numbers unavailable or unreliable, say so — do not approximate them. Never invent a locator:
no fabricated file path, line number, test name, commit hash or config key. If you cannot cite
evidence for claim, it belongs in **Inferred** or **Missing context**, not here.

### 3. Inferred

What seems likely but not directly proven, each with reason you inferred it. Treat inferred claims
as rumours until verified. Never present one as implementation fact.

### 4. Contradictions

Where code, tests, docs, decisions, requirements, workflows, or behaviour disagree. Surface it —
don't hide it, don't silently crown winner. Docs may be stale *and* implementation may be wrong;
hold both open until evidence explains difference.

| Surface | Claim or behaviour | Evidence locator | Conflicts with | Risk | Disposition |
|---|---|---|---|---|---|
| docs / tests / code / config / history | what it says or does | file, test, config, log, commit | what it conflicts with | delivery risk | see §10 |

If inspected surfaces agree, write exactly:

> No contradictions detected between the inspected surfaces.

Never manufacture contradiction to fill structure. Still report what was inspected, what verified,
what remains uninspected, and smallest safe next step.

### 5. Stale or possibly stale

Which docs, comments, tests, assumptions, or patterns may be outdated or misleading, and **what
makes them look stale**: contradicted by current code, by tests, by runtime behaviour, by recent
commits, or no longer aligned with current requirements.

Age is not evidence. Only call something stale on ownership, age, or currency when repo history,
timestamps, comments, changelog entries, or explicit team context support it. **Old can still be
correct. New can still be wrong.**

### 6. Missing context

What you could not find but need to act safely — files, logs, ticket detail, domain rules, team
decisions, runtime evidence. Name them explicitly.

### 7. Risk

Two halves, kept apart:

- **Blast radius** — what breaks. Which callers, which contracts, which consumers depend on
  behaviour you about to change.
- **Delivery risk** — rework, regression, hidden review cost, diff too broad to review, accidental
  scope expansion, or unresolved human decision buried inside code change.

### 8. Files & checks that matter

Each surface you'd touch, paired with check that guards it — test file, command, assertion that
would go red if change wrong. Next step with no named check is a hope.

### 9. Questions needing human confirmation

Subset of Missing context only person can close. Keep these visible rather than resolving them with
plausible default.

### 10. Disposition

For each contradiction and each risk, exactly one next state:

- **clean it up now** — only if change narrow, evidence-backed, low-risk
- **mark it visibly**
- **mitigate it**
- **create a follow-up ticket**
- **add a test**
- **update repo guidance**
- **defer, with the reason**
- **ask for a human decision**

Broad cleanup never the default. When confidence incomplete, prefer visible marking or narrow
mitigation.

### 11. Smallest safe next step

Smallest delivery step takeable with justified confidence: supported by current evidence, bounded in
scope, reviewable by human, reversible or low-risk where possible, explicit about what remains
uncertain. Prefer small reviewable step over broad rewrite. If no safe step exists yet, say what
must be verified first.

Then **STOP** — `PROCEED` / `ADJUST` / `STOP`. Don't generate code until direction confirmed.

> When `/spec` or `/slice` is caller, their own checkpoint **is** this stop. Hand back findings and
> let caller's checkpoint run; don't stack second stop on top of it.

---

## Hard rules

- **Never claim to have inspected what you didn't.** Don't summarise repository contents from
  memory or model knowledge.
- **PII in evidence.** Production logs carry PII. Cite opaque identifiers only, and never paste log
  bodies into a file that might be committed. The secrets and PII list in
  `gated-delivery:issue-writing` (*Publishing to the tracker*, guardrail scan) names what stays out.

## Boundaries

This skill runs **before a change exists**. Does not overlap reviewers:

| Skill / agent | Owns | Runs |
|---|---|---|
| `repo-forensics` | what is true in the repo, and what could break | before the change |
| `senior-review-lens` | structural and cohesion design | on the diff, pre-commit |
| `code-reviewer` | correctness against the ACs, with evidence | on the branch, pre-PR |
| `/prod-support` | incident diagnosis — hypothesis, probe, root cause | during a production issue |

Not an incident tool. Incident ticket or customer-reported regression → `/prod-support`.

**Don't assume auto-invocation.** Explicit phrasing — "inspect first", "before you change
anything", "what could break" — is the reliable trigger; ordinary small edits may not fire it.
Dependable coverage is `/slice` step 0 for ticket work and invoking it by name everywhere else.

**"Contradictions" elsewhere means something else.** `/spec` 5 and 7, and `issue-writing`'s consistency pass, check
*authored artifacts* against each other — do ACs conflict, does Summary match Interface. This ledger
checks *repo reality against itself* — code vs docs vs tests vs config vs history. Same word,
different surface. Neither replaces other.

## Verification

After running this skill, check:

- Tier named in first line.
- Every Verified claim carries real locator, no locator approximated.
- Full pass: Contradictions either populated ledger or explicit no-contradictions sentence.
  Quick posture: item 4 opens with `Surfaces disagree:` or `Surfaces agree.` — no ledger.
- No stale entry rests on age alone.
- Every finding in full pass has a disposition.
- Output ends in smallest-safe-next-step and no code, every tier. Explicit `PROCEED`/`ADJUST`/`STOP`
  token is full-pass only.

## Origin

Structure adopted from the
[Repo Forensics Starter Prompt](https://practiceofclarity.eu/en-us/shared/thinkfirst/repo-forensics-starter-prompt/)
(Practice of Clarity, Mikey Sebastian Drozd, CC BY 4.0) plus companion six-item pre-code checklist.

**Does not repeat:** `/prod-support` evidence discipline, `code-reviewer`
verify-or-`UNVERIFIED`, `/spec` 3a canonical-doc rule, `/slice` 5 smallest-step sizing.

## Related skills

- `/spec` — invokes full pass at step 3; output feeds `## Relevant files`, `## Red flags`,
  `## Edges`, and `## Open decisions`.
- `/slice` — invokes quick posture at step 0, before trivial-change escape hatch.
- `Skill(senior-review-lens)` — post-change structural counterpart.
- `Agent(code-reviewer)` — pre-PR correctness counterpart.
