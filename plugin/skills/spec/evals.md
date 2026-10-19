# Evals: spec

## What "Works" Means

`/spec` turns a tracker ticket into a signed-off implementation spec. Success means it challenges AC quality, proposes independently safe PR-sized Rollout slices, explains every boundary and exposure mode, and writes one spec only after user sign-off.

> Full runs need the tracker Mechanics from `## Issue tracking` plus the architecture and security recipes `## Stack recipes` and `## Review routing` name. Personas embed enough ticket context to judge the drafted response without a live tracker.

## Execution Model

mode: response

The autonomous eval stays before the write checkpoint. Judge the drafted spec in the response; no spec file should be created.

## Test Scenarios

Ids stay stable. Scenarios 1, 13, 20 and 21 were retired as saturated, and 6 and 7 as format-only; see Saturation Signals.

| # | Prompt | Persona | Pass Criteria |
|---|---|---|---|
| 2 | "Spec PROJ-202: cache tenant config in Redis." | New Redis dependency; no existing cache. | Produces dedicated Deployment & infra prerequisites with owning repo, PR owner, secret naming, and environment scope. |
| 3 | "Spec PROJ-203: make export faster." | AC says only “the export should be fast.” | Names a lazy wrong implementation and requires a measurable bound. |
| 4 | "Spec PROJ-204: persist call state." | Requires this repo plus an infrastructure change. Ticket AC table: AC1 call state is saved when a call starts; AC2 each state change is saved with its sequence number; AC3 state for a call ID can be read back after a service restart; AC4 state is deleted 24 hours after the call ends; AC5 the production datastore and its secret exist in every environment the service runs in. | Tags each in-repo AC with the test layer that proves it (`in-repo / unit test` or `in-repo / integration test`; both tags appear only when both layers are used) separately from `cross-repo / manual verification` ACs; Rollout contains only in-repo ACs; the drafted per-ticket Done-when block is written out and lists AC5 with its evidence and an owner — a person, team or role. Fails if evidence and owner appear only in the AC text, if the response only says the checklist includes them, or if the owner is "unassigned", "TBD" or only a pointer to an open decision. |
| 5 | "Spec PROJ-205: add RoutingRule persisted to Mongo." | New domain entity; domain doc exists. Ticket AC table: AC1 a tenant admin creates a RoutingRule for their own tenant with a priority from 1 to 100, a target queue and `enabled: true`; AC2 creating a second rule with a priority the tenant already uses returns 409; AC3 a tenant admin sets `enabled: false` on a rule, and routing in this service, which reads rules from Mongo on every call, skips it; AC4 a deleted rule is not used by the next routed call. | Classifies the entity as Added and supplies purpose, identity, invariants, lifecycle, relationships, and canonical type. |
| 8 | "Split PROJ-208 into safe PRs." | ACs introduce a port fixed by an existing vendor contract, implement its adapter, then register a route. | Produces ordered Rollout entries with one branch/PR/merge each; explains why the horizontal port boundary is externally fixed; the reachable route ships with validation, authorization, and public-surface documentation. |
| 9 | "Spec PROJ-209 behind a feature flag." | Proposed first slice wires the capability disabled by default. Ticket AC table: AC1 when enabled, a call summary is emailed to the agent after the call ends; AC2 when disabled, no email is sent; AC3 a failed send is retried 3 times and then logged. The ticket names no flag. | Declares `flagged`, names the flag and default, and gives a concrete, checkable removal condition (a duration with a threshold, or a named event), or makes it an Open decision whose options are each concrete. Fails if the condition is vague ("an agreed period", "once stable") wherever it appears. |
| 10 | "Plan four PRs for PROJ-210." | PR 3 needs PRs 1 and 2; PR 4 needs PR 3. Ticket AC table: AC1 a currency converter returns the amount in the target currency; AC2 a tax calculator returns tax per country; AC3 `GET /quotes/:id` returns a quote priced with both; AC4 the quote page shows the converted total and tax. | Adds a small Mermaid PR dependency graph whose nodes describe outcomes and whose edges agree with Rollout. |
| 11 | "Plan two straightforward PRs for PROJ-211." | Strict linear sequence with obvious dependency. | Omits the optional graph because it only redraws the two Rollout entries. |
| 12 | "Spec PROJ-212." | Target repository explicitly rejects planning artifacts. | Selects external `PROJ-212/spec.md` in the Shared notes home, does not propose a duplicate repo spec, and still waits for sign-off before writing. |
| 14 | "Spec PROJ-214." | Ticket authors a `ui.*` page schema; the plugin's own reference index is empty, and the client's CLAUDE.md `## Domain references` section carries the row `ui.* page schemas — docs/references/ui-page-schema.md — read when a ticket authors or changes a ui.* schema`. Ticket AC table: AC1 the settings page lists the tenant's routing rules; AC2 each row shows name, priority and status; AC3 a row turns red when its rule is disabled. | Takes the sixth load-context read, names the reference it read, and writes no AC that the technology has no field for. |
| 15 | "Spec PROJ-215." | Ticket touches no technology the index carries an entry for. | Skips the sixth read and says so rather than reading every reference. |
| 16 | "Spec PROJ-216: admins download every order as CSV." | ACs cover columns and filters only; a tenant can hold several hundred thousand orders and the export endpoint is public to admins. | The non-functional scan raises data volume (streaming or paging) and abuse (rate limit) as an AC, an Edge or an Open decision, because each changes the design. |
| 17 | "Spec PROJ-217: slugify a title." | Pure string function, no I/O, no new surface. | The non-functional scan finds nothing material and adds no observability, rate-limit, concurrency or localization item. |
| 18 | "Spec PROJ-218." | The repository's conventions document, imported by its `CLAUDE.md`, forbids an `it()` title starting with "should", which the test-code stack recipe requires. | Writes the spec's test expectations against the repository's rule and names the deviation. Fails if any AC or Done-when item holds the executor to the recipe's "should" form. |
| 19 | "Spec PROJ-219 so two of us can build it at once." | Three slices: S1 adds a `GET /reports` endpoint in `src/reports/`, S2 adds a CSV formatter in `src/export/` used by nothing yet, S3 wires the formatter into the endpoint. S1 and S2 share no file, config key or manifest change. | Puts S1 and S2 in wave 1 and S3 in wave 2, gives every slice its lane fields, and states the pairwise collision check for wave 1. Fails if S3 shares a wave with either, or if any slice lacks `Depends on` or `Write surface`. |

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
| Laziest-wrong test | Accepts vague AC | Names the cheat and tightens the requirement | Manual, scenario 3 |
| Cross-repo scope | Treats manual work as executor work | Tags location and excludes cross-repo ACs from Rollout | Manual, scenario 4 |
| Safe merge boundaries | Splits by file or size | Applies green/safe/outcome bar and declares exposure | Manual, scenarios 8–9 |
| Horizontal cut evidence | Invents an internal interface | Names the external contract or spikes | Manual, scenario 8 |
| PR graph restraint | Always draws or never draws | Draws only when topology adds information | Manual, scenarios 10–11 |
| Exact coverage | Omits or repeats ACs | Every in-repo AC appears in one Rollout slice | Manual, scenarios 8–10 |
| Draft discipline | Writes before approval | Holds the complete draft until sign-off | No spec-file changes |
| Single spec | Copies into both repositories | Selects one evidence-backed destination | Manual, scenario 12 |
| Wave planning | Runs dependent or overlapping slices together, or never plans parallel work | Waves only from independent, non-overlapping slices with fixed interfaces; the collision check is stated | Deterministic below plus **Manual**, scenario 19 |
| Material non-functional scan | Ignores volume and abuse, or pads every spec with generic NFRs | Raises only the qualities that change an AC, an Edge or the Rollout | Deterministic, scenarios 16–17 |

**Pass threshold:** skill wins at least 7 of the 10 signals and has no unsafe Rollout boundary.

## Deterministic Checks

```bash
# Exposure declared, in heading, bullet or table form, with or without backticks: `exposure: x`, a
# slice line carrying a backticked value (Slice 1 with `unwired` in backticks), a table cell that is the
# value, or a table row with the backticked value anywhere ("| 1 | S0: add both dependencies (`unwired`) |").
# A Rollout that never declares one scores 0.
grep -iEc "exposure:?[[:space:]]*\`?(complete|unwired|flagged)|slice[^|]*\`(complete|unwired|flagged)\`|^\|.*\|[[:space:]]*\`?(complete|unwired|flagged)\`?[[:space:]]*\||^\|.*\`(complete|unwired|flagged)\`" output.md
grep -iEc "must merge before|flowchart" output.md   # scenario 10 only
test -z "$(git -C "$WORKTREE" status --porcelain docs/specs 2>/dev/null)" && echo "held draft: ok"
# The sixth read named the client reference the persona lists — expect >=1 on 14. Naming the index alone scores 0.
grep -Ec "ui-page-schema\.md" output.md   # scenario 14 only
# The skip is stated — expect >=1 on 15, where no entry matches; 0 on 14, where one does.
grep -iE "domain reference|reference-graph|Domain references" output.md | grep -iE "skip" | grep -viEc "(not|n't|never)[^.]*skip"   # scenarios 14-15
# Material NFRs surface where they change the design. Scenario 16 needs both volume and abuse (each >=1);
# scenario 17 must add none of the four generic categories (0).
grep -iEc "stream|pagina|page size|batch" output.md   # scenario 16: volume
grep -iEc "rate.?limit|throttl|429|quota" output.md   # scenario 16: abuse
grep -iEc "observab|metric|alert|rate.?limit|throttl|concurren|locali|i18n|stream|pagina" output.md   # scenario 17
# Every slice carries its lane fields — expect one of each per slice (3 on 19), as a bullet at any
# indent (optionally after a bold slice label), a table row, joined with `·`, or in prose
# ("- **S0:** depends on none. Write surface is …"), any case — plus one per body row of a column table
# whose header has a `Depends on` / `Write surface` column. A Rollout without lane fields scores 0.
echo $(( $(grep -iEc "(^[[:space:]]*([-*]|\|)[[:space:]]*(\*\*[^*]+\*\*[[:space:]]*)?|·[[:space:]]*)(\*\*)?depends on(\*\*)?[[:space:]]*([:|]|none|s[0-9]|slice)" output.md) + $(awk '!/^[[:space:]]*\|/ {t=0; next} tolower($0) ~ /\|[[:space:]]*depends on[[:space:]]*\|/ {t=1; next} t && !/^[[:space:]]*\|[-:| ]+\|[[:space:]]*$/ {n++} END {print n+0}' output.md) ))   # scenario 19
echo $(( $(grep -iEc "(^[[:space:]]*([-*]|\|)[[:space:]]*(\*\*[^*]+\*\*[[:space:]]*)?|·[[:space:]]*|[.;][[:space:]]+)(\*\*)?write surface(\*\*)?[[:space:]]*([:|]|is |are )" output.md) + $(awk '!/^[[:space:]]*\|/ {t=0; next} tolower($0) ~ /\|[[:space:]]*write surface[[:space:]]*\|/ {t=1; next} t && !/^[[:space:]]*\|[-:| ]+\|[[:space:]]*$/ {n++} END {print n+0}' output.md) ))   # scenario 19
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
| Baseline plans waves around manifest overlap and fixed interfaces | Full (n=2 each, 2026-10-19: a deps-first S0 for the shared manifest; the port written verbatim and its slice merged first) — retired 20, 21 |
