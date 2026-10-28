# Evals: spec

## What "Works" Means

`/spec` turns a tracker ticket into a signed-off implementation spec. Success means it challenges AC quality, proposes independently safe PR-sized Rollout slices, explains every boundary and exposure mode, and writes one spec only after user sign-off.

> Full runs need the tracker Mechanics from `## Issue tracking` plus the architecture and security recipes `## Stack recipes` and `## Review routing` name. Personas embed enough ticket context to judge the drafted response without a live tracker.

## Execution Model

mode: response

The autonomous eval stays before the write checkpoint. Judge the drafted spec in the response; no spec file should be created.

## Test Scenarios

Ids stay stable. Scenarios 1, 13, 20 and 21 were retired as saturated, 6 and 7 as format-only, and 16 and 17 because the skill no longer has a non-functional scan; see Saturation Signals.

| # | Prompt | Persona | Pass Criteria |
|---|---|---|---|
| 2 | "Spec PROJ-202: cache tenant config in Redis." | New Redis dependency; no existing cache. | — |
| 3 | "Spec PROJ-203: make export faster." | AC says only “the export should be fast.” | — |
| 4 | "Spec PROJ-204: persist call state." | Requires this repo plus an infrastructure change. Ticket AC table: AC1 call state is saved when a call starts; AC2 each state change is saved with its sequence number; AC3 state for a call ID can be read back after a service restart; AC4 state is deleted 24 hours after the call ends; AC5 the production datastore and its secret exist in every environment the service runs in. | — |
| 5 | "Spec PROJ-205: add RoutingRule persisted to Mongo." | New domain entity; domain doc exists. Ticket AC table: AC1 a tenant admin creates a RoutingRule for their own tenant with a priority from 1 to 100, a target queue and `enabled: true`; AC2 creating a second rule with a priority the tenant already uses returns 409; AC3 a tenant admin sets `enabled: false` on a rule, and routing in this service, which reads rules from Mongo on every call, skips it; AC4 a deleted rule is not used by the next routed call. | — |
| 8 | "Split PROJ-208 into safe PRs." | ACs introduce a port fixed by an existing vendor contract, implement its adapter, then register a route. | — |
| 9 | "Spec PROJ-209 behind a feature flag." | Proposed first slice wires the capability disabled by default. Ticket AC table: AC1 when enabled, a call summary is emailed to the agent after the call ends; AC2 when disabled, no email is sent; AC3 a failed send is retried 3 times and then logged. The ticket names no flag. | — |
| 10 | "Plan four PRs for PROJ-210." | PR 3 needs PRs 1 and 2; PR 4 needs PR 3. Ticket AC table: AC1 a currency converter returns the amount in the target currency; AC2 a tax calculator returns tax per country; AC3 `GET /quotes/:id` returns a quote priced with both; AC4 the quote page shows the converted total and tax. | The Mermaid PR dependency graph's nodes describe outcomes and its edges agree with Rollout. |
| 11 | "Plan two straightforward PRs for PROJ-211." | Strict linear sequence with obvious dependency. | — |
| 12 | "Spec PROJ-212." | Target repository explicitly rejects planning artifacts. | — |
| 14 | "Spec PROJ-214." | Ticket authors a `ui.*` page schema; the plugin's own reference index is empty, and the client's CLAUDE.md `## Domain references` section carries the row `ui.* page schemas — docs/references/ui-page-schema.md — read when a ticket authors or changes a ui.* schema`. Ticket AC table: AC1 the settings page lists the tenant's routing rules; AC2 each row shows name, priority and status; AC3 a row turns red when its rule is disabled. | — |
| 15 | "Spec PROJ-215." | Ticket touches no technology the index carries an entry for. | — |
| 18 | "Spec PROJ-218." | The repository's conventions document, imported by its `CLAUDE.md`, forbids an `it()` title starting with "should", which the test-code stack recipe requires. | — |
| 19 | "Spec PROJ-219 so two of us can build it at once." | Three slices: S1 adds a `GET /reports` endpoint in `src/reports/`, S2 adds a CSV formatter in `src/export/` used by nothing yet, S3 wires the formatter into the endpoint. S1 and S2 share no file, config key or manifest change. | — |

## Agent Prompt Templates

### Baseline Agent

```text
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
Draft acceptance criteria and a spec. The user will not answer follow-ups; decide from context.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent

```text
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:spec"). Then follow it.
The user will not answer follow-ups; decide from context.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## Quality Signals

| Signal | Failure | Expected behavior | Measurement |
|---|---|---|---|
| Laziest-wrong test | Accepts vague AC | Names the cheat and tightens the requirement | Deterministic, scenario 3 |
| Cross-repo scope | Treats manual work as executor work | Tags location and excludes cross-repo ACs from Rollout | Deterministic, scenario 4 |
| Safe merge boundaries | Splits by file or size | Applies green/safe/outcome bar and declares exposure | Deterministic, scenarios 8–9 |
| Horizontal cut evidence | Invents an internal interface | Names the external contract or spikes | Deterministic, scenario 8 |
| PR graph restraint | Always draws or never draws | Draws only when topology adds information | Deterministic graph presence; judge reads the edges, scenarios 10–11 |
| Exact coverage | Omits or repeats ACs | Every in-repo AC appears in one Rollout slice | Manual, scenarios 8–10 |
| Draft discipline | Writes before approval | Holds the complete draft until sign-off | Deterministic: no Write or Edit call in the transcript |
| Single spec | Copies into both repositories | Selects one evidence-backed destination | Deterministic, scenario 12 |
| Wave planning | Runs dependent or overlapping slices together, or never plans parallel work | Waves only from independent, non-overlapping slices with fixed interfaces; the collision check is stated | Deterministic below, scenario 19 |

**Pass threshold:** skill wins at least 6 of the 9 signals and has no unsafe Rollout boundary.

## Deterministic Checks

```bash
# Scenario 9 declares `flagged` exposure and gives a checkable removal condition. Exposure may sit in a
# heading, bullet or table, with or without backticks: `exposure: flagged`, a slice line carrying
# `flagged` in backticks, or a table row with it. The template's placeholder `complete | unwired |
# flagged` scores 0, and so does `exposure: complete`.
# expect: >=1 on 9
grep -iEc "exposure:?[[:space:]]*\`?flagged|slice[^|]*\`flagged\`|^\|.*\`flagged\`" output.md
# The removal condition is a duration with a threshold or a named event; "an agreed period" and "once
# stable" score 0, as does a line that carries both a number and a vague phrase.
# expect: >=1 on 9
grep -iE "remov[^|]*([0-9]+ ?(days?|weeks?|hours?|%)|retired|decommission)" output.md | grep -viEc "agreed period|once stable|everyone is happy"
# PR dependency graph drawn as a Mermaid block (flowchart or graph) — expect >=1 on 10, 0 on 11, where it
# only redraws two entries. The words "flowchart" or "must merge before" in prose do not count.
# expect: >=1 on 10
# expect: ==0 on 11
grep -cE '^[`]{3}mermaid' output.md   # scenarios 10-11
# The sixth read is reported as done for the client reference the persona lists — expect >=1 on 14. A line
# saying it was not read or was skipped scores 0, and so does naming the index alone. On 15 no such
# reference exists, so any claimed read of it is invented — expect 0.
# expect: >=1 on 14
# expect: ==0 on 15
grep -iE "read[^.]*ui-page-schema\.md" output.md | grep -viEc "\bnot\b|n't|never|skip"   # scenarios 14-15
# Every slice carries its lane fields — expect one of each per slice (3 on 19), as a bullet at any
# indent (optionally after a bold slice label), a table row, joined with `·`, or in prose
# ("- **S0:** depends on none. Write surface is …"), any case — plus one per body row of a column table
# whose header has a `Depends on` / `Write surface` column. A Rollout without lane fields scores 0.
# expect: >=3 on 19
echo $(( $(grep -iEc "(^[[:space:]]*([-*]|\|)[[:space:]]*((\*\*[^*]+\*\*|S[0-9]+:?)[[:space:]]*)?|·[[:space:]]*)(\*\*)?depends on(\*\*)?[[:space:]]*([:|]|none|s[0-9]|slice)" output.md) + $(awk '!/^[[:space:]]*\|/ {t=0; next} tolower($0) ~ /\|[[:space:]]*depends on[[:space:]]*\|/ {t=1; next} t && !/^[[:space:]]*\|[-:| ]+\|[[:space:]]*$/ {n++} END {print n+0}' output.md) ))   # scenario 19
# expect: >=3 on 19
echo $(( $(grep -iEc "(^[[:space:]]*([-*]|\|)[[:space:]]*((\*\*[^*]+\*\*|S[0-9]+:?)[[:space:]]*)?|·[[:space:]]*|[.;][[:space:]]+)(\*\*)?write surface(\*\*)?[[:space:]]*([:|]|is |are )" output.md) + $(awk '!/^[[:space:]]*\|/ {t=0; next} tolower($0) ~ /\|[[:space:]]*write surface[[:space:]]*\|/ {t=1; next} t && !/^[[:space:]]*\|[-:| ]+\|[[:space:]]*$/ {n++} END {print n+0}' output.md) ))   # scenario 19
# Draft discipline — no spec file is written before sign-off: no Write or Edit call in the run, on every
# scenario. The run stays before the write checkpoint.
# expect: ==0 on 2,3,4,5,8,9,10,11,12,14,15,18,19
grep -cE '"tool_use","id":"[^"]*","name":"(Write|Edit)"' transcript.jsonl
# Scenario 2 has a dedicated Deployment & infra prerequisites heading.
# expect: >=1 on 2
grep -ciE "^#+ .*deployment (&|and) infra" output.md
# Scenario 2 names the repo that owns the infra.
# expect: >=1 on 2
grep -ciE "(owning|owns?|owner)[^.|]*repo|repo[^.|]*(owns|owning)" output.md
# Scenario 2 says who raises the infra PR.
# expect: >=1 on 2
grep -ciE "who raises|raised by|pr owner|owner of the pr|raises? the pr|opens? the pr" output.md
# Scenario 2 gives the secret naming.
# expect: >=1 on 2
grep -ciE "secret[^.|]*(name|naming|convention)|--[A-Z]+" output.md
# Scenario 2 gives the environment scope.
# expect: >=1 on 2
grep -ciE "env(ironment)?s?[ -]scope|which envs?|envs? (that )?need" output.md
# Scenario 3 names the laziest wrong implementation.
# expect: >=1 on 3
grep -ciE "lazi(est|er)|lazy" output.md
# Scenario 3 requires a measurable bound — a number with a unit, a percentile or a percentage.
# expect: >=1 on 3
grep -ciE "[0-9]+(\.[0-9]+)? ?(ms|milliseconds?|s|sec|seconds?|min|minutes?)\b|p(50|90|95|99)\b|[0-9]+ ?%" output.md
# Scenario 4 tags each of AC1-AC4 with its test layer on the AC line.
# expect: >=4 on 4
grep -E "AC ?[1-4]\b" output.md | grep -cE "in-repo / (unit|integration) test"
# Scenario 4 tags AC5 as cross-repo manual verification.
# expect: >=1 on 4
grep -E "AC ?5\b" output.md | grep -c "cross-repo / manual verification"
# Scenario 4 keeps AC5 out of the Rollout section.
# expect: ==0 on 4
awk '/^#+ Rollout/{f=1;next} /^## /{f=0} f' output.md | grep -cE "AC ?5\b"
# Scenario 4 writes the per-ticket Done-when line for AC5 in the template's form: AC5 — evidence: … — owner: ….
# expect: >=1 on 4
awk '/^#+ Done-when/{f=1;next} /^## /{f=0} f' output.md | grep -ciE "AC ?5.*evidence.*owner"
# Scenario 4's AC5 owner is not unassigned, TBD or a pointer to an open decision.
# expect: ==0 on 4
awk '/^#+ Done-when/{f=1;next} /^## /{f=0} f' output.md | grep -E "AC ?5" | grep -ciE "unassigned|TBD|decision (#|[0-9])"
# Scenario 5 classifies RoutingRule as Added.
# expect: >=1 on 5
grep -ciE "^#+ Added: *RoutingRule" output.md
# Scenario 5 gives all six domain-model fields — purpose, identity, invariants, lifecycle, relationships,
# canonical type — inside the Domain model section.
# expect: >=6 on 5
awk '/^#+ Domain model/{f=1;next} /^## /{f=0} f' output.md | grep -oiE "purpose|identity|invariants?|lifecycle|relationships?|canonical type" | tr 'A-Z' 'a-z' | sed 's/s$//' | sort -u | wc -l | tr -d ' '
# Scenario 5 names the per-tenant priority uniqueness as an invariant, in the Domain model section.
# expect: >=1 on 5
awk '/^#+ Domain model/{f=1;next} /^## /{f=0} f' output.md | grep -iE "priority" | grep -ciE "uniq|per.tenant|one rule|409|same priority"
# Scenario 5 tags AC3 in-repo with its test layer and never as cross-repo.
# expect: >=1 on 5
grep -E "AC ?3\b" output.md | grep -cE "in-repo / (unit|integration) test"
# AC3 is not tagged cross-repo.
# expect: ==0 on 5
grep -E "AC ?3\b" output.md | grep -c "cross-repo / manual verification"
# Scenario 5 adds no cache-invalidation step.
# expect: ==0 on 5
grep -ciE "cache.?invalidat" output.md
# Scenario 8 has at least three Rollout entries — port, adapter, route — one per merge.
# expect: >=3 on 8
awk '/^## Rollout/{f=1;next} /^## /{f=0} f && /^### Slice/' output.md | wc -l | tr -d ' '
# Scenario 8 orders the Rollout entries by ascending slice number.
# expect: ==1 on 8
awk '/^## Rollout/{f=1;next} /^## /{f=0} f && /^### Slice/' output.md | grep -oE '[0-9]+' | head -20 | sort -n -c 2>/dev/null && echo 1 || echo 0
# Scenario 8 says the port boundary comes from an external or vendor contract.
# expect: >=1 on 8
grep -iE "vendor|external" output.md | grep -ciE "contract|interface|fixed"
# Scenario 8: the last Rollout slice, the one that makes the route reachable, carries validation.
# expect: >=1 on 8
awk '/^## Rollout/{f=1;next} /^## /{f=0} f && /^### Slice/{b=""} f{b=b"\n"$0} END{print b}' output.md | grep -ciE "validation|validate"
# Scenario 8: the same slice carries authorization.
# expect: >=1 on 8
awk '/^## Rollout/{f=1;next} /^## /{f=0} f && /^### Slice/{b=""} f{b=b"\n"$0} END{print b}' output.md | grep -ciE "authori[sz]"
# Scenario 8: the same slice carries public-surface documentation.
# expect: >=1 on 8
awk '/^## Rollout/{f=1;next} /^## /{f=0} f && /^### Slice/{b=""} f{b=b"\n"$0} END{print b}' output.md | grep -ciE "documentation|openapi|swagger"
# Scenario 9 names the flag in backticks on a flag line.
# expect: >=1 on 9
grep -iE "flag" output.md | grep -cE '[`][a-z0-9_.-]+[`]'
# Scenario 9 gives the flag a default.
# expect: >=1 on 9
grep -iE "flag" output.md | grep -ciE "default[^.|]*(off|on|disabled|enabled)"
# Scenario 9 has no vague removal condition anywhere.
# expect: ==0 on 9
grep -ciE "agreed period|once stable|when everyone|when stable|in due course" output.md
# Scenario 12 selects the external spec path PROJ-212/spec.md.
# expect: >=1 on 12
grep -c "PROJ-212/spec.md" output.md
# Scenario 12 proposes no duplicate repo spec — a non-negated line naming docs/specs/PROJ-212 scores 1.
# expect: ==0 on 12
grep "docs/specs/PROJ-212" output.md | grep -viEc "not|n't|instead|reject|\bno\b|never"
# Scenario 12 still waits for sign-off.
# expect: >=1 on 12
grep -ciE "sign-?off|approv" output.md
# Scenario 14 writes no AC that promises the colour the page schema has no field for — a non-negated
# AC3 line saying the row turns red scores 1.
# expect: ==0 on 14
grep -E "AC ?3\b" output.md | grep -iE "\bred\b" | grep -viEc "\bno\b|\bnot\b|n't|cannot|without|field|schema"
# Scenario 15 reads no reference file under docs/references — a non-negated "read … docs/references/" line scores 1.
# expect: ==0 on 15
grep -iE "read[^.]*docs/references/" output.md | grep -viEc "\bnot\b|n't|never|skip|\bno\b"
# Scenario 18 names the deviation from the recipe.
# expect: >=1 on 18
grep -ciE "deviation|deviat" output.md
# Scenario 18 does not hold the executor to the "should" test-title form in an AC or Done-when item — a
# non-negated line there that mentions "should" with a title or it() scores 1.
# expect: ==0 on 18
awk '/^## (Acceptance criteria|Done-when)/{f=1;next} /^## /{f=0} f' output.md | grep -iE "(it\(|title|test name|test description)[^.]*should" | grep -viEc "\bnot\b|n't|never|\bno\b|without|instead|forbid|avoid|deviat"
# Scenario 19 puts S1 and S2 in wave 1.
# expect: >=1 on 19
grep -E "^\|[[:space:]]*1[[:space:]]*\|" output.md | grep -E "S1" | grep -cE "S2"
# Scenario 19 keeps S3 out of wave 1.
# expect: ==0 on 19
grep -E "^\|[[:space:]]*1[[:space:]]*\|" output.md | grep -c "S3"
# Scenario 19 puts S3 in wave 2.
# expect: >=1 on 19
grep -E "^\|[[:space:]]*2[[:space:]]*\|" output.md | grep -c "S3"
# Scenario 19 states the pairwise collision check for wave 1 — the table's "why they cannot collide" cell holds text.
# expect: >=1 on 19
awk -F'|' '$2 ~ /^[[:space:]]*1[[:space:]]*$/ && length($4) > 12 {n++} END{print n+0}' output.md
```

## Saturation Signals

| Signal | Saturation Level |
|---|---|
| Baseline runs AC independence unprompted | Full (n=2, 2026-10-19: both baselines merged the dependent ACs into one) — retired 1 |
| Baseline adds deployment prerequisites unprompted | Partial — monitor |
| Baseline applies a measurable performance bound | Full — retire or convert |
| Baseline proposes safe merge boundaries with exposure | New — retain |
| Baseline avoids redundant rollout graphs | New — retain |
| Baseline follows repository-declared context and creates no context file | Full (n=2, 2026-10-19) — retired 13 |
| Baseline makes tenant authorization an AC for a cross-tenant write | Full — format-only: baseline behaviour right, lacks house vocabulary (n=2, 2026-10-19) — retired 6 |
| Baseline names components and their order before drafting ACs | Full — format-only: baseline behaviour right, lacks house vocabulary (n=2, 2026-10-19) — retired 7 |
| Baseline raises data volume and abuse limits on a public bulk export | Retired 16, 17: the skill has no non-functional scan, so nothing is left to measure |
| Baseline plans waves around manifest overlap and fixed interfaces | Full (n=2 each, 2026-10-19: a deps-first S0 for the shared manifest; the port written verbatim and its slice merged first) — retired 20, 21 |
