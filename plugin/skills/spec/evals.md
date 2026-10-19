# Evals: spec

## What "Works" Means

`/spec` turns a tracker ticket into a signed-off implementation spec. Success means it challenges AC quality, proposes independently safe PR-sized Rollout slices, explains every boundary and exposure mode, and writes one spec only after user sign-off.

> Full runs need the tracker Mechanics from `## Issue tracking` plus the architecture and security recipes `## Stack recipes` and `## Review routing` name. Personas embed enough ticket context to judge the drafted response without a live tracker.

## Execution Model

mode: response

The autonomous eval stays before the write checkpoint. Judge the drafted spec in the response; no spec file should be created.

## Test Scenarios

| # | Prompt | Persona | Pass Criteria |
|---|---|---|---|
| 1 | "Spec PROJ-201." | ACs separately say endpoint returns 200, returns JSON, and JSON contains `total`; the latter two cannot fail independently of the first successful response. | Runs independence check and folds verification details instead of accepting all three as separate ACs. |
| 2 | "Spec PROJ-202: cache tenant config in Redis." | New Redis dependency; no existing cache. | Produces dedicated Deployment & infra prerequisites with owning repo, PR owner, secret naming, and environment scope. |
| 3 | "Spec PROJ-203: make export faster." | AC says only “the export should be fast.” | Names a lazy wrong implementation and requires a measurable bound. |
| 4 | "Spec PROJ-204: persist call state." | Requires this repo plus an infrastructure change. | Tags in-repo automated ACs separately from cross-repo manual ACs; Rollout contains only in-repo ACs; per-ticket Done-when requires evidence and an owner for every cross-repo manual AC. |
| 5 | "Spec PROJ-205: add RoutingRule persisted to Mongo." | New domain entity; domain doc exists. | Classifies the entity as Added and supplies purpose, identity, invariants, lifecycle, relationships, and canonical type. |
| 6 | "Spec PROJ-206: add an endpoint that updates another tenant's routing config." | New authenticated tenant-scoped write. | STRIDE pass identifies tenant authorization as an AC or decision; authentication alone is not accepted. |
| 7 | "Spec PROJ-207: publish call-ended to analytics and billing." | At least three components and meaningful ordering. | Includes a small architecture flow sketch and names the seams before drafting ACs. |
| 8 | "Split PROJ-208 into safe PRs." | ACs introduce a port fixed by an existing vendor contract, implement its adapter, then register a route. | Produces ordered Rollout entries with one branch/PR/merge each; explains why the horizontal port boundary is externally fixed; the reachable route ships with validation, authorization, and public-surface documentation. |
| 9 | "Spec PROJ-209 behind a feature flag." | Proposed first slice wires the capability disabled by default. | Declares `flagged`, names the flag and default, and requires a concrete removal condition. |
| 10 | "Plan four PRs for PROJ-210." | PR 3 needs PRs 1 and 2; PR 4 needs PR 3. | Adds a small Mermaid PR dependency graph whose nodes describe outcomes and whose edges agree with Rollout. |
| 11 | "Plan two straightforward PRs for PROJ-211." | Strict linear sequence with obvious dependency. | Omits the optional graph because it only redraws the two Rollout entries. |
| 12 | "Spec PROJ-212." | Target repository explicitly rejects planning artifacts. | Selects external `PROJ-212/spec.md` in the Shared notes home, does not propose a duplicate repo spec, and still waits for sign-off before writing. |
| 13 | "Spec PROJ-213 in this repository." | `CLAUDE.md` points to `.ai-context/` files and a repository-specific canonical domain path; no separate context index exists. | Follows the repository-declared documents, uses the declared domain model, and does not propose creating context files. |
| 14 | "Spec PROJ-214." | Ticket authors a `ui.*` page schema; the reference index carries a matching entry. | Takes the sixth load-context read, names the reference it read, and writes no AC that the technology has no field for. |
| 15 | "Spec PROJ-215." | Ticket touches no technology the index carries an entry for. | Skips the sixth read and says so rather than reading every reference. |
| 16 | "Spec PROJ-216: admins download every order as CSV." | ACs cover columns and filters only; a tenant can hold several hundred thousand orders and the export endpoint is public to admins. | The non-functional scan raises data volume (streaming or paging) and abuse (rate limit) as an AC, an Edge or an Open decision, because each changes the design. |
| 17 | "Spec PROJ-217: slugify a title." | Pure string function, no I/O, no new surface. | The non-functional scan finds nothing material and adds no observability, rate-limit, concurrency or localization item. |

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
| AC independence | Copies ticket ACs | Constructs fail-while-others-pass and folds dependent checks | Manual, scenario 1 |
| Laziest-wrong test | Accepts vague AC | Names the cheat and tightens the requirement | Manual, scenario 3 |
| Cross-repo scope | Treats manual work as executor work | Tags location and excludes cross-repo ACs from Rollout | Manual, scenario 4 |
| Safe merge boundaries | Splits by file or size | Applies green/safe/outcome bar and declares exposure | Manual, scenarios 8–9 |
| Horizontal cut evidence | Invents an internal interface | Names the external contract or spikes | Manual, scenario 8 |
| PR graph restraint | Always draws or never draws | Draws only when topology adds information | Manual, scenarios 10–11 |
| Exact coverage | Omits or repeats ACs | Every in-repo AC appears in one Rollout slice | Manual, scenarios 8–10 |
| Draft discipline | Writes before approval | Holds the complete draft until sign-off | No spec-file changes |
| Single spec | Copies into both repositories | Selects one evidence-backed destination | Manual, scenario 12 |
| Repository-owned context | Assumes fixed document paths | Starts from repository instructions and follows their canonical references without creating context files | Manual, scenario 13 |
| Material non-functional scan | Ignores volume and abuse, or pads every spec with generic NFRs | Raises only the qualities that change an AC, an Edge or the Rollout | Deterministic, scenarios 16–17 |

**Pass threshold:** skill wins at least two thirds of applicable signals and has no unsafe Rollout boundary.

## Deterministic Checks

```bash
grep -iEc "exposure:[[:space:]]*(complete|unwired|flagged)" output.md
grep -iEc "must merge before|flowchart" output.md   # scenario 10 only
test -z "$(git -C "$WORKTREE" status --porcelain docs/specs 2>/dev/null)" && echo "held draft: ok"
grep -iEc "CLAUDE.md|repository instructions|canonical" output.md   # scenario 13
# The sixth read happened and named its source — expect >=1 on 14, 0 on 15, where no entry matches.
grep -Ec "reference-graph|Domain references" output.md   # scenario 14 only
# Material NFRs surface where they change the design. Scenario 16 needs both volume and abuse (each >=1);
# scenario 17 must add none of the four generic categories (0).
grep -iEc "stream|pagina|page size|batch" output.md   # scenario 16: volume
grep -iEc "rate.?limit|throttl|429|quota" output.md   # scenario 16: abuse
grep -iEc "observab|metric|alert|rate.?limit|throttl|concurren|locali|i18n|stream|pagina" output.md   # scenario 17
```

## Saturation Signals

| Signal | Saturation Level |
|---|---|
| Baseline runs AC independence unprompted | Partial — monitor |
| Baseline adds deployment prerequisites unprompted | Partial — monitor |
| Baseline applies a measurable performance bound | Full — retire or convert |
| Baseline proposes safe merge boundaries with exposure | New — retain |
| Baseline avoids redundant rollout graphs | New — retain |
