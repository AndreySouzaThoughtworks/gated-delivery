---
name: senior-review-lens
description: Pre-flight structural self-audit — lenses A–G (cohesion, table-vs-inline, test pyramid, test realism, test descriptions, dead variants, type-system shift) on a diff, plus H (framing depth) on an ADR or design doc. Use before committing a non-trivial change, before pushing or opening a PR, when asked "is this ready to push", or when adding an exception, constant, test or ADR.
---
# Senior Review Lens

Procedural pre-flight audit. Run lenses A–G below against diff, plus Lens H against an ADR or design doc. Apply fixes BEFORE human reviewer see it.

Lens does NOT replace correctness review (the `code-reviewer` agent does that). Also does NOT duplicate the mechanical validators a caller runs at its own validator gate — **hexagonal layer purity intentionally absent** because the architecture validator named under `## Review routing` already enforce layer boundaries, SDK wrapping, adapter quality, data boundaries, infrastructure coupling, controller architecture. This skill add perspective of **senior consultant / staff engineer / tech lead** asking: _"is this code well-designed beyond just legal? does each line serve a clear purpose? what would a senior reviewer push back on?"_

## When to invoke

| Trigger                                                          | Invoke           |
| ---------------------------------------------------------------- | ---------------- |
| Before `git commit` on a non-trivial change (>1 file or >20 LOC) | Full pass (A–G; H only for an ADR or design doc) |
| Before `git push` on a feature branch with a PR                  | Full pass (A–G)  |
| Adding a new domain type, exception class, port, adapter         | Lenses A + G     |
| Adding a new test or test fixture                                | Lenses C + D + E |
| Adding a lookup table / map / registry                           | Lens B           |
| Writing an ADR or design doc                                     | Lens H           |
| `as` cast or `// @ts-expect-error`                               | Lens G           |

## How to invoke

**Input from caller.** `diff-range` _(optional)_ — what to audit. Supply it whenever the change is already committed. Two forms:

- **One range** — `<base-sha>..HEAD`. The common case.
- **A list of commits** — used when the subject is a set of merges rather than a contiguous history, as when a caller audits several merged PRs whose range would otherwise include unrelated work. Read them with one `git show <sha> <sha> …`, in the order given, which the caller supplies as merge order. Where two commits touch one file, judge the file by its combined final state, not each patch alone: duplication introduced by the first and removed by the second is not a finding.

When invoked, **run relevant lenses in order**. Lenses A–G run against code diff; Lens H run against ADR/design doc. Each lens:

1. Read diff: `git diff <diff-range>` for a range, or `git show` over the listed commits, when caller supplied one; else `git diff --staged` when preparing commit, or `git diff` for working-tree review; use specific files mentioned when reviewing subset. For Lens H, read ADR/design doc.
2. Ask lens's questions.
3. If answer is smell, propose structural alternative (don't just complain).
4. Apply fixes that are clear wins. If fix invasive, document rationale and get second opinion. Surface judgment calls to user.

Report at end with table in **Output format**:

| Lens | Finding                                  | Action                    |
| ---- | ---------------------------------------- | ------------------------- |
| A    | vendor literal repeated across 6 throws  | introduced `engine` field |
| C    | test layer too high                      | split into unit+integration |

---

## Lens A — Cohesion / natural home

Every new/moved literal, constant, method, or mapping logic:

**Ask:**

1. Which **domain concept** owns this? (Translation, Voice, Identity, etc.)
2. Is artifact at layer + module of that concept, or scattered/displaced?
3. Same concept written more than once across different sites? (Vendor name in 6 throw sites, status code in 3 maps, etc.)

**Symptoms:**

- Hardcoded vendor literal (`'Stripe'`, `'GitHub'`, `'Okta'`) repeated across multiple throw/log sites in adapter
- Domain-kind → presentation-text mapping living in controller while kinds themselves declared in adapter or domain
- Method named after concept (`isExpired`, `isAuthorized`) sitting next to unrelated method
- Constant exported from layer A, consumed only in layer B
- Type union variant whose name doesn't match layer that emits it

**Mitigation:**

- Adapter declares identity ONCE via `readonly engine: Engine = ENGINE.X` on port-contract field. All throw sites use helper that bakes in `this.engine`. Zero literal repetition.
- Domain-aware mapping logic lives in entity/exception constructor, not controller.
- Constant exported from layer A but consumed only from B → move to B.

---

## Lens B — Table-vs-inline

Every map, lookup table, or registry-style constant:

**Ask:**

1. Does table **compress structure** — carry distinct behaviour or distinct data per row — or just rename few literals?
2. Rows derivable from stdlib API or framework?
3. Each row carrying unique semantic, or some rows just "fallback to default" with no real distinction?

**Principle:** indirection earns its weight. Lookup table that doesn't compress structure is ceremony.

**Symptoms:**

- `*_BY_HTTP_STATUS` table whose rows replicate stdlib `STATUS_CODES` from `node:http`
- Lookup map down to one or two entries (after trimming unused keys) — table now just rename ceremony
- Map where every entry resolves to same value — collapse to that single value
- `TYPE_BY_X` map duplicating existing union narrowing compiler already enforces

**Mitigation:**

- Few rows + no behavioural distinction → inline at call sites. Don't keep table for "future entries."
- Stdlib-equivalent → use stdlib (`STATUS_CODES`, `STATUS_TEXT`, `WeakMap`).
- Single-literal collapse → drop table, use literal.
- Range-based logic → write function (`typeFromStatus(status)` with ranges) instead of enumerated table.

---

## Lens C — Test pyramid placement

Every new test, test-file restructure, test fixture migration:

**Ask:**

1. What **single concern** does this test assert? (Status code wiring? DTO regex? Adapter HTTP mapping? Business logic?)
2. Which layer **owns** that concern? (Domain unit / service / adapter / DTO / mapper / controller integration / e2e / openapi)
3. Test at right layer, or one level too high?
4. Same assertion already covered at lower layer?

**Symptoms:**

- Controller integration spec testing language-code mapping (mapper concern)
- Controller integration spec parametrizing per-kind error mapping (exception unit concern)
- Controller integration spec asserting regex acceptance variants (DTO unit concern)
- E2E test asserting Swagger doc shape (openapi unit concern)
- Controller integration spec >10 `it` blocks where most aren't wiring concerns
- Per-kind `it.each` in TWO specs (exception unit + controller integration) — duplicate

**Mitigation:**

- Controller integration: ONLY wiring-on-one-representative — 200 happy / 502 representative / 400 representative. ~3 `it` blocks.
- Pure validator behaviour (regex, transform, decorator) → DTO unit spec via `plainToInstance + validateSync`. No Nest boot.
- Per-kind / per-variant enumeration → exception unit spec or mapper unit spec.
- Full-stack smoke → e2e. Doc-shape → openapi unit.

**Reference:** Martin Fowler, "The Practical Test Pyramid". Many unit, fewer integration, fewest e2e. Push every test as far down as it can honestly go.

---

## Lens D — Test realism

Originally about fixtures; underlying principle applies to fixtures, mock returns, stub shapes, assertion targets — anywhere test asserts on value system might not actually distinguish.

**Ask:**

1. Does this value (input fixture, mock return, stub shape, expected output) appear (or matter) in downstream code path after validation, normalisation, or upstream framing?
2. Does system **distinguish** this variant from others, or normalise/discard it?
3. Is test asserting **upstream gate's permissivity**, or **system's actual behaviour**?

**Principle:** anchor tests on downstream consumer — route table, switch branches, lookup map, or persistence layer that actually distinguishes value. Don't test what validator/framework/SDK tolerates upstream; test what product does with what survives.

**Symptoms:**

- Validator/DTO test asserts value is "accepted" but next layer normalises, strips, or discards that variant — test exercises validator permissivity, not product behaviour
- Mock returns shape production code reshapes/maps before using — assertion-on-mock-shape doesn't validate reshape
- Stub provides input SUT doesn't read or branch on
- Parametrized fixture row whose value never appears in any downstream consumer
- Fixture covers full set regex/schema tolerates rather than subset downstream actually distinguishes

**Mitigation:**

- Anchor inputs and expectations on downstream consumer that actually distinguishes value.
- If SUT can't distinguish two inputs, don't write two positive tests on them; write one.
- If validation accepts value but no downstream layer preserves or branches on it, drop that fixture from positive tests OR move it to explicit "broad-acceptance" test labelled as permissivity test, not product test.
- Validator's job is to reject what's invalid; product's job is to act on distinctions. Test each at own level.

---

## Lens E — Test descriptions in audience vocabulary

Every `it(...)` / `describe(...)` title and every test code comment:

**Ask:**

1. Does title require **external lookup** to interpret — RFC reference, spec number, acronym soup?
2. Does title reference **internal identifiers** (enum constants, type names) without saying what they mean?
3. Would new team member need to chase reference to understand what's asserted?

**Principle:** test names should be self-explaining in audience's vocabulary. Audience for unit test is next developer reading it cold — not spec author, not type system.

**Symptoms:**

- `it('should return 502 with RFC 7807 problem details ...')` — external standard reference
- `it('should comply with OAuth 2.0 PKCE flow')` — spec reference
- `it('returns FOO_INVALID for empty input')` — internal-constant reference; reader has to look up what `FOO_INVALID` means
- `it('serializes Map<UUID, Result<E, Maybe<Order>>>')` — type-name name-bombing
- `it('handles the JWS-RS-256 flow')` — acronym soup with no behavioural description
- Test comment: `// per RFC 9110 §15.6.3`

**Mitigation:**

- Replace reference with project's own term for observable shape (`problem details body`, `error envelope`, `bearer-token auth`, `rejects empty input`) — project terms point to class/type in code; spec numbers and constant names point outside it.
- Describe behaviour: `it('should return 502 with problem details body and warn-log Datadog dimensions when the engine rejects')`.
- RFC/spec references ARE acceptable in: ADRs, design docs, README architecture sections — surfaces whose job is documenting decision rationale.

---

## Lens F — Dead variant / YAGNI on type unions

Every type-union variant, enum member, dead branch:

**Ask:**

1. Is variant **currently emitted** by at least one adapter / service / domain operation?
2. Is "future use" concrete (on roadmap, in tasks.md, in story) or hypothetical ("for when we add X")?
3. What's cost of **re-adding** it when actually needed?

**Symptoms:**

- Union variant declared in type but never emitted by any adapter/service (`PaymentKind = '... | crypto'` while no adapter calls crypto provider)
- `case X: ... default: throw` where X never the value
- Private helper used in exactly ONE call site (fancy name for one-liner)
- Discriminated union variant kept "for future engines that don't exist yet"

**Mitigation:**

- Drop dead variant. Re-add when real caller needs it (compile-time check ensures you can't forget).
- Inline one-shot helper via destructuring at call site.
- "Future-proofing" recommendation is textbook signal to apply YAGNI harder, not softer.

---

## Lens G — Type-system shift (compiler-enforced over hand-discipline)

Every runtime check, convention-based pattern, "remember to do X" comment:

**Ask:**

1. Can this be expressed as **type-level constraint** (`satisfies`, generic constraint, port-contract field)?
2. Can `as const satisfies T` replace manual sync check?
3. Can **branded type** prevent misuse instead of runtime guard?
4. Any `as` cast replaceable with typed helper or class extension?

**Symptoms:**

- `as` casts scattered across test bodies (especially `as unknown as`)
- `// must remember to update the union/list when adding a new enum member`
- Hand-written test stub via `jest.fn() as unknown as RealClass`
- Runtime check that "this can't happen" with comment but no compile-time guard

**Mitigation:**

- `Object.freeze({...} as const) satisfies Readonly<Record<K, V>>` for exhaustive maps.
- Class extension instead of `as unknown as` cast for test stubs.
- `readonly engine: Engine` on port contract — compiler enforces every adapter declares identity.
- Typed helper hides one cast inside it, exposes cast-free API.

---

## Lens H — Framing depth (for ADRs, design docs, RFCs)

**Surface:** this lens runs against ADR, design doc, or RFC — **not** against `git diff`. Triggered when drafting or reviewing decision document, or when `/spec` encounters open decision at its step 6.

Every ADR or design doc, ask whether framing is **deepest relevant question**:

**Ask:**

1. Decision is "X vs Y" — is that actually right axis, or surface choice already-decided constraints have collapsed?
2. What gets **ruled out by hard constraints** (PII, compliance, vendor contract, latency budget)? Does that collapse option space before X-vs-Y question even matters?
3. Any deeper question one level above current framing?

**Symptoms:**

- ADR titled "POST vs GET for /translate" when PII rules out GET → real question is URL shape (verb-URL vs resource-noun)
- Design doc framed as "Redis vs Memcached" when real question is whether workload needs cache at all
- RFC framed as "library A vs library B" when both serve same need and deeper question is abstraction boundary

**Mitigation:**

- Restate problem one level deeper. "verb vs noun" → "stateless compute action over a resource-oriented protocol".
- List what each constraint rules out. Often 2-3 of 4 options collapse before framing's named tradeoff matters.
- Lead doc with deeper framing; surface choice becomes corollary.

---

## Output format

After running relevant lenses, produce this report:

```
## Senior-review-lens pass

| Lens | Status | Findings |
|---|---|---|
| A. Cohesion | CLEAN \| N findings | <one-line per finding: file:line — what's wrong — proposed alternative> |
| B. Table-vs-inline | CLEAN \| N findings | … |
| C. Test pyramid | CLEAN \| N findings | … |
| D. Test realism | CLEAN \| N findings | … |
| E. Test descriptions | CLEAN \| N findings | … |
| F. Dead variants | CLEAN \| N findings | … |
| G. Type-system shift | CLEAN \| N findings | … |
| H. Framing depth | CLEAN \| N/A (no ADR in scope) \| N findings | … |

### Auto-applied
- <fix> (clear win, no judgment call)

### Surfaced for judgment
- <issue + 2 alternatives>: which would you prefer?

### Verdict

<one of: READY-TO-COMMIT / REVISE-FIRST — emit the chosen token alone on its own line>
```

Verdict token goes on own line, by itself. Enumerating both in heading made verdict unreadable to any check: grep for either token matched every output that merely followed this template, whether or not verdict was actually reached.

## Rules

- **Don't over-trigger.** 1-line typo fix doesn't need 8 lenses.
- **Cite lens by letter** (A–H) in finding so user can map back to this checklist.
- **Cross-reference sibling-service precedents when available** to validate structural call.
- **High signal-to-noise.** Output for human reading: one sentence per finding, action-oriented, no hedging or throat-clearing. Format: `<file:line> — <smell> — <structural alternative>`. Senior reviewers pack maximum signal into minimum words because their time is bottleneck and ambiguity wastes author's time. If right move is "drop X", say "drop X" — not "consider whether X is still needed". Confidence communicated by directness.
