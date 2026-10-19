# Evals: renovate-shepherd

## What "Works" Means

`/renovate-shepherd` triage open Renovate PRs (encoded_preference): categorize correct
(Inbox vs In-Flight), fetch with `--limit 100` so old PRs not dropped, produce structured
verdict, detect repo **merge profile** before merge, refuse unsafe major bumps.

> Integration dependency: live run need `gh` + open Renovate PRs. Personas describe PR set and
> repo branch-protection so categorization, verdict, merge-path choice judgable.

## Execution Model

mode: response

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Triage the Renovate PRs." | 4 open Renovate PRs: #10 approved+automerge-on, #12 approved+automerge-off, #14 not approved, #9 not approved (oldest). | Two tables: **In Flight** = {#10}; **Inbox** = {#12, #14, #9} sorted oldest-first (#9 before #14). Use `--limit 100`. |
| 2 | "Should I merge PR #14?" | #14 bumps package **major** version; changelog list removed API used in `src/`. | Verdict **DO NOT MERGE** (or NEEDS REVIEW), cite breaking changelog + affected `src/` use. No rubber-stamp. |
| 3 | "Merge PR #12 once it's green." | Repo A: auto-merge **enabled**, no release bot. | Use simple path: `gh pr merge --auto --squash`. Does NOT run release-bot wait loop. |
| 4 | "Merge PR #12 once it's green." | Repo B: auto-merge **disabled**, strict required checks, release bot commits `[no ci] chore(release)` after each merge. | Use **manual sequence**: wait for release-bot commit on `main`, `update-branch`, wait CI, verify SHA unchanged, then `--squash`. |
| 5 | "Triage." | One Inbox PR has `pnpm-lock.yaml` conflict with `main`. | Skip it with reason (Renovate will rebase); no force-resolve. |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
Help triage Renovate PRs. The user won't answer follow-ups — decide from context.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:renovate-shepherd"). Then follow it.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|----------------|---------------|------------|----------------|
| Inbox vs In-Flight categorization | Flat list | Two tables by approved×automerge | Manual (scenario 1) |
| Oldest-first ordering | Arbitrary order | Sorted by `createdAt` asc | Manual (scenario 1) |
| `--limit 100` | Default 30 (drops old PRs) | Explicit 100 | `grep -c "limit 100" output` |
| Structured verdict block | Prose opinion | SAFE/NEEDS REVIEW/DO NOT MERGE block | `grep -iEc -e "do not merge" -e "safe to merge" -e "needs review" output` |
| Merge-profile detection | Assume one merge path | Pick auto vs manual by repo config | Manual (scenarios 3/4) |
| Major-bump caution | May approve | Flag breaking changelog | Manual (scenario 2) |

**Pass threshold:** skill win ≥ 2/3 scenarios on categorization + verdict + merge-path correctness.

## Deterministic Checks

```bash
grep -iEc "do not merge|safe to merge|needs review" output.md   # structured verdict
grep -c "limit 100" output.md                                    # no silent PR truncation
# Each table is present as its own heading — expect 1 each. Anchored on the heading, because the
# bare words matched any prose mentioning an inbox or a PR in flight, including a run that built no
# tables; counted separately, because one combined count of 2 was satisfied by two Table A headings
# and no Table B at all.
grep -Ec "^#+ +Table A — Inbox" output.md      # expect 1
grep -Ec "^#+ +Table B — In Flight" output.md  # expect 1
```

## Saturation Signals

| Signal | Saturation Level |
|--------|-----------------|
| Baseline categorize Inbox vs In-Flight unprompted | Partial — monitor |
| Baseline detect merge profile (auto vs strict+release-bot) unprompted | Full — retire/convert |
| Baseline always pass `--limit 100` unprompted | Partial — monitor |
