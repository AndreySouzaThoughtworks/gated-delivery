---
name: spec
description: Create a spec file from a tracker ticket. Walks the user through the plugin's change template with hard checkpoints, defines the ordered PR-sized Rollout, and writes only after explicit sign-off. Use from /slice (Route A) or directly before implementation.
---
# /spec — Create a spec file for one ticket

**Hold drafts in conversation until sign-off.** Draft spec content lives in conversation until step 9. Do not write it until the user signs off on every section.

**Branch preconditions.** A repo-hosted spec written at step 9 must land on `main` or the ticket's own branch (`feat/{ticket-id}-*`), with a clean working tree. Any other state — STOP and ask the user how to proceed. An external working spec is committed only in the notes repository — the repository holding the Shared notes home (`## Delivery notes` in the client's CLAUDE.md); do not mutate the changed repository to store it. Before reading from or writing to that notes-repo checkout, verify it too: working tree clean and HEAD on `main`, otherwise STOP. Pulling `main` from a feature branch merges it, and committing there lands the spec inside an unrelated PR.

## Inputs

- `ticket-id` — e.g. `PROJ-123` (any tracker key). If missing, **ask inline as free text** — not `AskUserQuestion`, which for discrete choices, not open input.
- `spec-path` — resolved at step 1: repo-hosted `docs/specs/{ticket-id}-{slug}.md`, or external `{ticket-id}/spec.md` in the Shared notes home (`## Delivery notes`) when the changed repository rejects planning artifacts

> Stack assumption: step 3 load the architectural context `## Stack recipes` (client's CLAUDE.md) names for this repo's stack. When it names none, use the repo's own architecture docs and conventions, treat stack-specific prompts (module wiring, etc.) as "repo's equivalent."

## Process

### 1. Load context

Complete these five context-loading steps in order, plus a sixth when a domain reference matches. Repository instructions own the locations of project context and canonical documents. Start from repository instruction files such as root `CLAUDE.md` or `AGENTS.md`, then follow the documents they reference. Do not create missing context files or introduce a second documentation convention in the changed repository. Step 6 reads a plugin-owned reference, which adds no document to the repository and so is not one. A missing canonical reference required by the ticket is different — STOP and surface it, because proceeding would invent a contract.

1. **Fetch the ticket** through the tracker Mechanics (`## Issue tracking`). Read: summary, description, user-story, AC table, labels, parent epic, blocked-by / blocks links, comments. Give lens — which keywords look for, which subsystems matter — before opening anything else.
2. **Read the repository instructions and every project-context document they reference.** With the current service structure this normally starts at `CLAUDE.md`, which imports the repository's architecture, coding conventions, domain context, technology stack, and testing strategy. Note which rules and references matter to the ticket.
3. **Read referenced docs that touch the ticket** — the repository's test-layer definitions, relevant ADRs, canonical RFCs, message-interface specs, lifecycle plans, and in-repo plans. Skip unrelated ones. External RFCs describe target state; in-repo plans often define narrower immediate scope. If they disagree, default to the in-repo plan unless the user explicitly says otherwise.
4. **Read this skill's own `templates/change.md`.** It defines the required structure for step 4, including `## Rollout`. Merge any repo-specific additions from an existing target-repository template into that structure.
5. **Read the canonical domain model named by the repository instructions, when one exists.** Note which entities the ticket appears to touch and classify them in step 3d as Added / Changed / Renamed / Referenced. Without one, perform the same classification against the code and do not create a domain-document convention.
6. **Read the matching domain reference**, when the ticket touches a technology this plugin carries one for. `../../references/reference-graph.md`, relative to this file, indexes them and says what each is read for; read any whose entry matches, so an AC does not promise behaviour the technology has no way to express. Skip when nothing matches.

Before selecting a destination, check both candidate locations for an existing ticket spec: repo-hosted `docs/specs/{ticket-id}-*.md` and external `{ticket-id}/spec.md` in the Shared notes home. If a candidate file exists, STOP: this ticket is already specced. Report where it lives and direct the caller to `/slice` Route B′ for a decision or Rollout change, or to edit the file directly. `/spec` creates a spec; the flow updates it. If more than one candidate file exists, STOP and ask which is canonical.

If no candidate file exists, resolve `spec-path` from repository evidence before drafting:

- The Spec placement rule (`## Delivery notes`) covers this repository → follow it.
- Existing accepted `docs/specs/` history or repository guidance allowing planning artifacts → use `docs/specs/{ticket-id}-{slug}.md`.
- Repository guidance or deletion history rejecting planning artifacts → use `{ticket-id}/spec.md` in the Shared notes home (`## Delivery notes`). When no Shared notes home is declared, ask where external specs live and record the answer there.
- Keep one spec. For external storage, use the writable notes-repo checkout at `GATED_DELIVERY_NOTES_REPO`; when unset, clone it with `gh` into a temporary directory. The installed plugin cache is read-only.

**Then ask user for anything repo can't tell you.** Before moving on, ask whether they have more context — examples: RFCs, message-interface specs, design docs, links, prior art, much of which live outside repo (Notion, sibling repos). Don't treat an absent in-repo document as a gap until you ask: a missing canonical reference is usually one the user can provide. Fold reusable context into the canonical owner named by the repository instructions; when none exists, keep it in the spec rather than inventing a new location.

### 2. CHECKPOINT — confirm intent with user

Show user-intent line and AC table from the ticket (**AC = acceptance criterion**, one testable "given input → expected output" requirement; plural ACs). Ask: _"Is this the right intent for the spec, and are the ticket's ACs the right starting point for the implementation ACs?"_ If user want refine intent, capture refined version — but the ticket stay source of truth for user-facing story.

If ticket lack AC table, or existing ACs incomplete or ambiguous, stop and ask user resolve before proceeding. No architecture or implementation analysis until the ticket's acceptance criteria usable starting point.

### 3. Explore the codebase and load architectural context

**Always invoke these skills at start of step 3 — not "if unfamiliar." No exceptions.** If any invocation fail because skill not found, STOP and alert user.

- `Skill(repo-forensics)` — **full pass** over ticket's area, run first. Establish what actually true before you reason about what to build. Route output:

  | Forensics section | Destination |
  |---|---|
  | Verified, Files & checks | `## Relevant files` |
  | Contradictions, Stale | `## Red flags` |
  | Blast radius (Risk, first half) | `## Edges` |
  | Questions needing human confirmation | `## Open decisions` |
  | Missing context | ask user at step 1's "anything the repo can't tell you" — becomes `## Open decisions` entry only if genuine fork with options, since that section's shape is Decision/Options/Tradeoffs. Missing schema is fetch, not decision |
  | **Inferred** | **nowhere by default** — see below |
  | Disposition (§10) | contradictions: ledger's last column; stale entries: appended to bullet (stale list has no columns); *risk*: becomes AC or `## Open decisions` entry if implies work, else not persisted |
  | Smallest safe next step (§11) | not persisted — inform slice plan at `/slice` step 5 |
  | Surfaces inspected, delivery risk (Risk, second half) | not persisted; scope the pass, inform slice sizing |

  **Inferred claim must not enter spec as though verified.** `## Relevant files` has no way to mark confidence, so unverified claim written there indistinguishable from checked one — and verified/inferred split is whole point of pass. Before drafting, every inferred claim implementation depend on gets one of two fates: **verify it** (read file, run check) so it become Verified, or **carry it into `## Open decisions`** as named assumption to confirm. Never silently promote.

  Its stop point does **not** apply here — `/spec`'s own checkpoints are the stop; take findings and continue.
- **Platform architecture recipe** named by `## Stack recipes` — platform-wide architectural laws (plane separation, PII handling, RPO/RTO declaration, idempotency, layering mandates, etc.). Many issues only surface when you map ticket's requirements against law list.
- **Codebase architecture recipe** named by `## Stack recipes` — codebase-level rules: `type` vs `interface`, port-creation YAGNI, layer boundaries, null/undefined handling. Cross-reference against repo's actual existing patterns (may diverge from recipe — note divergences as decisions, not errors).
- When `## Stack recipes` names no recipe for a slot, read the repository's own architecture docs for that slot instead — absence of a configured recipe is not a skill-not-found failure.
- **Placement decisions (helper-vs-entity):** when open decision is *where pure function/helper live and how named*, also consult the file-suffix conventions of the production-code recipe `## Stack recipes` names, else the repository's (e.g. stateless helpers → `*.helper.ts`, typically under `domain/helpers/`; entity-style naming for things with identity/lifecycle). Resolve placement **recipe-aligned at spec time** so `/slice`'s validators don't bounce it into mid-implementation file-move.

**Then read concrete files in area ticket touch.** Note:

- **Relevant files** — code with reusable logic, patterns to match, shared types, directly-modified surfaces
- **Red flags** — code smells, oversized files, tangled responsibilities in target area
- **Open decisions** — places where implementation has meaningful architectural fork

**Then sketch architecture flow.** If ≥3 components participate in change, or order of events matter across new flow, draft short Mermaid sequence or flowchart diagram (~10 nodes max) of how flow run end-to-end, paired with one paragraph naming seam(s) introduced. Get user sign-off on shape of flow before drafting ACs at step 4 — picture is what ACs written against, and changes to it after ACs locked in are expensive. Skip sketch entirely when change local (one or two components, no ordering concerns); don't manufacture diagram to fill slot.

**Then answer four structural questions explicitly:**

#### 3a. Canonical data model

If work persist, transform, or emit data of any kind, **locate canonical data-model doc** (often Notion RFC, message-interface spec like `docs/message-interface.md`, OpenAPI contract, AsyncAPI schema). Local TypeScript types in codebase may reflect legacy or in-flight schemas — they are _not_ automatically source of truth.

**Resolve composed schemas fully before concluding field present or absent.** When schema use composition (`$ref`, `allOf`, shared envelope, base type), unresolved reference mean shape _unknown_, not field _absent_. Field you look for — tenant id, correlation id, event sequence — often live in envelope/base, not per-event payload. Fetch referenced schema rather than infer from leaf you can see; if you can't fetch it, say "unknown pending that schema," never "absent."

Cite canonical doc in spec's `## Relevant files` section. Use it (not local type) as source of truth for field names, optionality, structure. If local type contradict canonical model, that's a **contradiction ledger row** (`## Red flags` → Contradictions) whose disposition is open decision: which one win, and what migration story? Don't resolve by picking one you read first.

If no canonical doc exist, **surface as open decision** — invented schemas expensive to undo.

#### 3b. Production deployment readiness

If work introduce new external dependency (database, cache, queue, secret, third-party API, new cloud resource), spec **must** include dedicated "Deployment & infra prerequisites" section — not as Edge case, not as Done-when checkbox. Identify:

- **Which repo owns infra** (e.g. a shared Terraform repo for legacy infrastructure; service repo's `.deploy/` for Helm values; a release-channel repo for newer deployment models). `## Domain references` or the repository instructions name the client's real ones.
- **Who raises PR** (spec author? platform team? both?).
- **Secret-naming convention** — the client's standard from `## Domain references` or the repository instructions (e.g. `${app}--{SECRET-NAME}`, `<service>--REDIS-HOST`).
- **Env scope** — which envs need infra? Often _not_ all envs service deployed to. Match service's actual `replicaCount > 0` envs to avoid paying for unused resources.
- **Reference service for pattern** — find service already using same dependency, cite its layout (e.g. service already wired into the infra repo; a service already carrying the shared Redis client's Helm bindings).

This sub-step catch "we silently expected someone else to do production work."

#### 3c. Cross-repo footprint

Sum above: does ticket's work span more than this repo? If yes, spec's AC section need explicit tagging (see step 4) — `in-repo / automated` vs `cross-repo / manual`. Note footprint here so AC tagging consistent later, and so step 9 of `/slice` (Open PR) can call out which ACs the PR satisfy vs which external.

#### 3d. Internal domain entities

Identify which entities the ticket adds, changes, or renames in this service's bounded context. Cross-reference the canonical domain model identified in step 1; when none exists, use the code:

- **Added** — entities introduced by ticket. Each need Purpose / Identity / Invariants / Lifecycle / Relationships / Canonical type in spec's `## Domain model` section.
- **Changed** — existing entities ticket modify (new invariant, new lifecycle state, new relationship, renamed field). Note what specifically changed.
- **Renamed** — entities whose name change. Note rename target and any call-site fallout.
- **Referenced (unchanged)** — entities ticket's logic depend on but don't modify. List them so executor know what to read; omit if no dependency.

If none apply, spec's `## Domain model` section is `N/A — no domain entities added, changed, or renamed` with one-line reason. Don't drop section header — explicit N/A is signal that domain modelling was considered, not skipped.

Your analysis here flows into the spec's `## Domain model` section at step 4. Follow the canonical domain model's per-entity shape when one exists; otherwise use Purpose / Identity / Invariants / Lifecycle / Relationships / Canonical type. `/slice` merges the spec's delta into the repository-declared model at ticket close, when the repository maintains one.

#### 3e. Security & threat model

**Always run security pass; scale depth to change.** Design-time lens that catch authz / trust-boundary gaps *before* ACs written against insecure design — class of issue code-level review can't catch, because faithful implementation of unsafe design look correct. Canonical example: tenant-scoped write endpoint that authenticate caller but never check whether they authorized to write *that* tenant's data — code correct, design open.

Invoke the threat-modeling skill `## Review routing` names for methodology (decompose → STRIDE per component → map mitigations → residual risk); when none is named, apply those four steps directly. Scale by what change touch:

- **Full pass** when change add or alter *trust boundary*: new inbound endpoint, new external caller/integration, authn/authz, tenant-scoped data, PII, secrets, or new external dependency. For high-risk surfaces, dispatch the threat-modeler agent `## Review routing` names (and optionally its threat-reviewer for independent second pass); when none is named, run the full pass in-session and say so.
- **Lightweight pass** — walk six STRIDE prompts (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) against change in short paragraph — when purely internal/local with no new boundary.

For new/changed surface, decompose entry/exit points, trust boundaries, data flows; apply STRIDE; give every material threat a **disposition**:

- **Control exists** — existing guard / validation / limit already cover it (cite it).
- **Becomes an AC** — mitigation testable in-repo (authz guard, input bound, rate limit) → write as acceptance criterion at step 4.
- **Becomes an Open decision** — mitigation need design call (auth model, cross-repo contract, deploy dependency) → carry to step 6.
- **Accepted** — explicitly, with reason and who accepted it.

Map mitigations to controls the stack recipes already ship — the security sections of the `## Stack recipes` entries (guards-auth, authorization, validation-security, rate-limiting, cors-helmet) — and to platform laws from the platform architecture recipe (PII handling, etc.). Output flows into the spec's `## Security` section and into `## Open decisions` or `## Acceptance criteria`. The code-time complement is `/slice` step 6.5's conditional security review.

### 4. Draft sections in conversation

Walk this skill's own `templates/change.md` section by section in template order, presenting drafts to the user. Drafts live in conversation only — no disk write until step 9.

**For Architecture sketch section** — if step 3's flow-sketch exercise produced diagram, paste it (and its paragraph) into section. If trigger rule didn't fire, omit section header entirely from spec — don't write empty section.

**For Domain model section** — present Added/Changed/Renamed/Referenced classification from step 3d. For each Added entity, use the repository's canonical domain-model shape or the fallback shape from step 3d. For Changed/Renamed entries, draft only lines that changed. Confirm entity list with user before drafting detail; the spec is the canonical record of the delta until it is merged into the repository's model at ticket close.

**For Acceptance criteria section** — if ticket's cross-repo footprint (step 3c) non-empty, tag each AC with implementation location and verification mode. Use one of:

- `in-repo / unit test` — implementable by slice-executor via TDD; verified by automated test in this repo
- `in-repo / integration test` — implementable in this repo with Testcontainers or similar; verified by integration test
- `cross-repo / manual verification` — outside this repo's executor scope (infra, ops, deployment readiness); verified manually against deployed environment

Add one-paragraph header at top of AC section explaining tags. Let slice-executor see at glance which ACs to TDD and which to skip with scratch note.

**For Rollout and Done-when sections** — leave their repeated slice entries open while first drafting. Step 5 proposes the merge sequence; step 6 may reshape it as decisions resolve. After the sequence is final, emit one `### Slice <n>` Done-when block per Rollout entry, in the same order. Include only stack validators and verification commands that apply to this repository.

### 5. CHECKPOINT — review ACs and propose the merge sequence

Walk every item below explicitly with the user:

- **Independence:** For each AC, construct a scenario where it fails while every other AC passes. If you cannot, fold it into the AC whose verification detail it represents.
- **Intent trace:** Every AC must trace to the user intent in Summary. If an AC serves a different intent, split the story.
- **Laziest-wrong test:** Name the laziest incorrect implementation that satisfies each AC literally. Tighten any AC that permits one.
- **Merge sequence:** Propose the ordered `## Rollout`. Each slice is one branch, PR, and merge. A one-slice sequence is the common case. Where the ticket cannot form reviewable safe slices, leave the existing choices open: split the ticket, use multiple specs, or accept one larger PR. Do not write the sequence without user sign-off.
- **No contradictions:** An implementer following the spec must not be able to produce conflicting behavior.

For every proposed boundary, apply the template's three-part bar: repository green, safe to deploy, and one sentence describing what becomes true on `main`. Declare each slice `complete`, `unwired`, or `flagged`; a flagged slice includes its flag name, default, and removal condition.

When a slice is too large, narrow behavior before cutting horizontally:

1. Narrow to one data type, request shape, tenant, or rule.
2. Cut horizontally only against an interface fixed outside the slice: an existing caller, a contract not controlled here, or the current implementation.
3. Otherwise run a spike. Do not commit `main` to a guessed interface merely to reduce diff size.

Once a surface is reachable, its safety envelope belongs in the same slice. Rollout names merge units, not executor batches; `/slice` decides batch boundaries from implementation seams.

**Ordering note.** Adding a capability on the exposure axis buys smaller reviews and deployment decoupled from release. Fixing a defect buys only the smaller reviews — the first slice of a fix carries no value on `main` until the last one lands. That affects which slice you would rather land first, and whether slicing the ticket is worth its overhead at all; it does not change what is allowed.

Add the template's optional PR dependency graph when there are at least three slices or the required-before relationships are not obvious. Nodes describe PR outcomes and arrows mean “must merge before.” The Rollout entries remain authoritative; omit a graph that only redraws a simple one- or two-PR list.

If any check fails, return to step 4 and revise.

### 6. CHECKPOINT — open decisions

If `Open decisions` section non-empty, walk it with user. For each decision:

- Present question, options, tradeoffs
- **Framing check (`senior-review-lens` Lens H):** before resolving, ask whether question is deepest relevant one or whether hard constraint (PII, compliance, vendor contract, latency budget, deployment topology) already collapsed 2–3 of options. If yes, restate question one level deeper and revise option list before getting user's call. Surface "X vs Y" decision that turn out corollary of deeper constraint waste user's attention.
- Get user's call (or explicitly defer if waiting on someone else)
- Update section: replace open question with chosen approach + reasoning + consequences

Spec **cannot** be dispatched for implementation while any decision unresolved. If decisions can't be resolved now, spec committed in draft state and `/slice` route to Route B (Resolve decisions) on next invocation.

If a decision changes PR shape or exposure, revise Rollout with the user before continuing.

### 7. CHECKPOINT — self-review pass

Before showing final draft to user, re-read entire spec from executor's perspective. Hunt explicitly for:

- **Stale cross-references** — ACs renumbered? Sections renamed? Decision N's wording updated? Find every "AC[N]" / "Decision[N]" / "step [N]" reference, verify it still point at right thing.
- **Contradictions between sections** — does Summary's field list match Interface code block? Does Decision N's "consequence" match AC's expected behaviour? Does Done-when match AC list?
- **Removed references** — did user say "drop X as a reference" mid-flight? Search for X. Almost always linger somewhere.
- **Missing implementation details** — does spec say where new files go, which module wire them, how new port bound, what env vars exist? Executor that must guess will guess wrong.
- **ACs that can't be tested as written** — re-read each AC, ask: "What would the test look like?" If you can't sketch one in 5 seconds, AC too vague.
- **Domain model deltas accurate** — every entity classified Added / Changed / Renamed / Referenced (unchanged) match work ACs imply. Canonical type pointer is real path (or noted as "added by this ticket"). If nothing touched, section is explicit "N/A — …" not missing header.
- **Architecture sketch present iff rule triggers** — `## Architecture sketch` section appear in spec only if ≥3 components participate or ordering matter; omitted otherwise. Empty section header with no content is failure mode to watch for.
- **Forensics output survived drafting** — every Contradictions row has disposition; no stale entry rest on age alone; every `## Relevant files` entry name check that guard it; **no claim that was Inferred now sitting in spec as fact** (it was verified, or it's named assumption in `## Open decisions`). If pass found nothing, explicit "No contradictions detected between the inspected surfaces." line present — empty table ambiguous between "clean" and "skipped".
- **Rollout covers ACs exactly once** — every `in-repo` AC appears in exactly one slice; cross-repo ACs appear in none. Every slice declares exposure, satisfies the three-part boundary bar, and every `flagged` slice includes a removal condition.
- **Done-when matches Rollout** — exactly one slice block per Rollout entry, in the same order, containing only checks that apply to this repository.
- **Optional PR graph agrees with Rollout** — when present, every node maps to one slice, every dependency points forward in the chosen sequence, and no graph-only requirement contradicts a Rollout boundary.

Fix everything found _before_ user see final draft. User catching these fine; you catching them first better.

### 8. CHECKPOINT — final review

Show user complete drafted spec. Ask: _"Ready to write this to disk?"_

### 9. Write and publish the spec

Write the signed-off draft to the `spec-path` resolved in step 1.

For a repo-hosted spec, leave the file uncommitted on the current allowed branch. `/slice` Route C commits it as the first commit on the slice-1 branch, so it is reviewed with that slice and reaches `main` through its PR.

For an external working spec:

1. Verify the notes-repo checkout against the branch preconditions above, then pull its `main` before writing.
2. Write `{ticket-id}/spec.md` in the Shared notes home.
3. Commit and push directly to the notes repository's `main`; never force-push.
4. If remote `main` moved, merge it, preserve both tickets' changes, rerun the consistency check, then push.

Update frontmatter:

- `ticket: {ticket-id}`
- `type: change`
- `status: Draft` (or `Ready` if all decisions are resolved; `/slice` Route F sets `Shipped` at ticket close)
- `created: <today's date>`

### 10. Update the ticket

Add a comment linking to the single spec location. Post it through the tracker Mechanics (`## Issue tracking`). Use the repository URL for a repo-hosted spec or the notes-repository URL for an external spec. Run `Skill(issue-writing)`'s guardrail scan on the comment before posting it; a link is still a write.

**Where speccing invalidated the ticket, reconcile it.** Step 2 made the ticket the source of
truth for the user-facing story, so a criterion the spec silently contradicts leaves two documents
disagreeing with no signal which one won — and the ticket is the one the team reads. Route the edit
through `Skill(issue-writing)`; its publishing section decides what may reach a ticket.
Criteria and scope change with the user's approval and a comment saying what revealed it. The design
behind them stays in this spec, bar an interface shape the ticket proposes or another team agreed,
which stays in the ticket with its link.

### 11. Report

Tell the caller where the spec lives and whether it was published. For a repo-hosted spec, say explicitly that the file is uncommitted until `/slice` Route C commits it on the slice-1 branch, and that stopping before then leaves it only in the working tree. For an external spec, report the pushed commit.

## What `/spec` does NOT do

- Make architectural decisions — surface them and wait for the user
- Write spec sections before the final-review checkpoint
- Open implementation PRs or commit code
- Skip the review checklist or Rollout sign-off
- Duplicate a spec between the changed repository and the Shared notes home
- Re-spec a ticket that already has a spec — direct the caller to update the existing file

## Related skills

- `/slice` — primary caller (Route A) and workflow this spec dispatched into.
- `Skill(repo-forensics)` — inspect-first full pass loaded at start of step 3; feed `## Relevant files`, `## Red flags`, `## Edges`, `## Open decisions`.
- Platform and codebase architecture recipes named by `## Stack recipes` — architectural context loaded at step 3.
- Threat-modeling skill and threat-modeler / threat-reviewer agents named by `## Review routing` — security & threat pass at step 3e.
- `Skill(issue-writing)` — guardrail scan and publishing rules for every ticket write at step 10.
- `Skill(senior-review-lens)` — Lens H (framing depth) invoked inline at step 6 for each open decision.
