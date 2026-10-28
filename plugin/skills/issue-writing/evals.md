# Evals: issue-writing

## What "Works" Means

`issue-writing` routes a ticket to one of four work kinds — Story, Task, Bug, Spike — and then
holds it to that kind's bar (encoded_preference).

**Routing.** The kind comes from explicit instruction, then semantic markers in the content, then
Jira issue type, then one clarification question. A `Spike:` summary on a Jira Story is a Spike; a
Task holding an open technical question is still a Task; a Design Task is reported unsupported
rather than flattened into a Task.

**The kind's bar.** Story **stops** where the flow says stop, **verifies before asserting** (no AC
from unread claim), refuses undecided rules inside ACs, demands a permissions group for a new
interface. Task states a result and verifiable evidence for it, with no invented persona. Bug keeps
impact, expected, actual, reproduction and context apart, and a suspected cause labelled as one.
Spike carries one question, the decision waiting on it, and a timebox with a value in it, and
leaves the answer to the research: options unjudged in the draft, the recommendation in the closeout.
Across every kind: **proposals not edits** in review mode, and — when the ticket reaches Jira — a PII scan,
every mutation verified by re-fetching, no write without sign-off, and no open question left on a
ticket in a Ready status.

The Story template exists to stop a plausible complete story made in one pass, with the research and
the stops skipped. The routing exists to stop the Story skeleton reaching the other three kinds: a
Bug with an invented persona, a Task with a test-layer checklist, a Spike with production acceptance
criteria.

> Integration dependency: full runs need the tracker mechanics and GitHub code search. Personas embed
> ticket and repo content so drafting behaviour judgable from response alone.

## Execution Model

mode: response

(Skill drafts in conversation, writes no Jira issue unless asked. Quality judged on drafted
story in response, not disk file or ticket.)

## Test Scenarios

Numbering is per group: the Story scenarios keep the numbers they were written with, and each new
group carries its own prefix. Ids stay stable when rows go, so gaps are expected. On 2026-10-19 the
rows a base model passed twice without the skill (R2, 4, 8, 19, 29, 30, B2, S1, S4) were dropped;
see Saturation Signals. 13, 21, 22, T4 and S5 were merged into 24, 25, 31, T3 and S7.

### Routing

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| R1 | "Write this as a Spike." | The brief reads like ordinary delivery work with a deadline. | — |
| R3 | "Refine DEMO-88." | Jira type Task, an ordinary delivery outcome, one undecided technical question in the body whose answer changes a completion criterion. | — |
| R4 | "Here's what came out of the call — write it up." | Content is half defect report, half request for a new capability. Signals genuinely conflict. | — |
| R5 | "Refine DEMO-77." | Jira type Design Task, with Goal, Stage, Constraints and a Design URL populated. | — |
| R6 | "Should this be a Task?" | Jira type Story. Deliverable is a set of markdown runbooks. The Definition of Done asks for unit, component, integration and end-to-end tests and eighty percent coverage. | — |
| R7 | "Should this be a Task?" | Jira type Story, its Tests and Communication blocks already hand-deleted by a person so the ticket would fit. | — |
| R8 | "Is this a Story?" | Jira type Story. The Store Operator persona is accurate — their apply really does fail mid-deployment — but every criterion has the system acting and the Store Operator receiving. | — |
| R9 | "Write this bug up." | Expected, actual and a reproduction on every rolling update. Nothing ever specified that an apply survives a deployment — the deployment configuration never had a drain step. | — |
| R10 | "Does this need a spike?" | Four candidate mechanisms, two of which live in another team's repository, so the answer decides which repo and which team does the work. | — |
| R11 | "Review DEMO-107." | Mistyped, and carrying twelve criteria across five groups, two of which a neighbouring team shipped as separate tickets its own References cite. | — |

### Story

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| 1 | "Write the story for applying a listing's hooks to an agent. I'm in a hurry, just draft it." | Nothing read yet; assistant has no knowledge of hook write path. | — |
| 2 | "Proceed" — given at findings stop, after step 3 produced six findings. | Two findings contradict step-2 draft. | Reports each finding with its evidence. |
| 3 | "That can't be true." — given at findings stop about cited finding. | Finding is plausible misreading of schema. | Goes back, re-checks. Returns citation that settles it, or reframing. Fails if accepts correction without looking, or restates same evidence. |
| 5 | "Type compatibility between `number` and `integer` isn't decided yet, but write the AC anyway." | Genuinely undecided rule. | — |
| 6 | "Findings for the bundle-apply story are triaged and signed off — write the ACs." | New tenant-scoped write interface. Steps 1 to 4 are done and signed off. The triage covers the apply, its all-or-nothing rule and an idempotent retry, and holds no finding on who may call it. The persona carries the API standard's status rules and the existing `storefronts:write` permission, which every storefront write requires. | — |
| 7 | "This AC covers it: given no credentials or credentials without permission, the apply is rejected." | Two branches, different outcomes — unauthenticated vs forbidden. | — |
| 9 | "Review TKT-31." | Ticket has `{type}` placeholder, `TBD` inside Given, Scope In bullet nothing tests, three "still open" items mixing undecided rule with coordination task. | Reports each problem against the rule and the failure it prevents. |
| 10 | "The read needs to go on orders-service — just design the endpoint." | Interface lives in another team's service. | — |
| 11 | "Check how the promotions service validates a promotion name." | Service-name-to-repo mapping undocumented; no repo named that service exists. | — |
| 12 | "Put resolution, validation, payload rewriting, the single write, reporting and the component filter in one story." | Six capabilities in one Scope In. | — |
| 14 | "Refine PROJ-123 — it reads like an implementation checklist." | Intake-form board. The ticket is reachable only through a tracker stub in the run directory, named by the client CLAUDE.md's **Mechanics**. A default read returns `description` null and no custom fields. Only a read with `expand=names` returns the three ADF custom fields (problem statement, proposed solution, who is affected) and their names. Neither prompt nor persona carries the ticket's content. | — |
| 16 | "Split this into two and link them so B blocks A." | Both halves behavioural; split legitimate. | The Blocks link is created with `inwardIssue: B, outwardIssue: A`. |
| 18 | "Draft the Scope for adding a hook as a package component." | Step 3 just produced schema and validation findings from code. | Scope In states what the publisher can now do. |
| 20 | "Draft the Technical Notes for the visibility behaviour." | The read inherits an existing exposure the story does not decide. | — |
| 23 | "These Technical Notes are fine, they are only eight bullets." | Eight bullets, holding three file paths, a route string and four status codes. | — |
| 24 | "Technical Notes say credential material appears only as a `secret_id` reference. Leave it there?" | No AC asserts it. | — |
| 25 | "Write the Background." | The user story and the ACs are already drafted, and the draft Background already ends "This story adds HOOK as a third component type." | The Background runs near past, then current state, then the closing line in a reader's words; the closing line does not restate the role-want-benefit above it or summarise the AC table. |
| 26 | "Draft Scope Out." | The author lists conforming the service error bodies to the API Standard, which nobody asked for and no one discussed. | — |
| 27 | "Slice 3 turned up a rule nobody groomed — the apply has to refuse two declarations landing on one variable. Add it." | Ticket is In Progress with two slices already merged. Its criteria table is append-only, so the new one takes the next free number and moves none of the existing ones. | — |
| 28 | "The spec's decision on the entry shape has moved on — bring the ticket into line." | The ticket's Technical Notes carry the proposed request-entry contract plus two paragraphs of reasoning for it. | — |
| 31 | "Draft the Technical Notes." | Step 3 holds the agreed request and response shape, the bounds with where each number came from, the traversal the rewrite copies, alternatives rejected, and the slice order. The team also plans to ship without a feature toggle. | — |

### Task

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| T1 | "We need bundle-apply off the v1 config client before the platform team removes it — write the ticket." | Configuration work. No user-visible behaviour changes. | The Completion Criteria are checkable. |
| T2 | "This one changes which queue the worker reads from. Write the completion criteria." | Observable behaviour does change. | Each criterion states its condition and the observable outcome on one labelled line. |
| T3 | "Refine DEMO-61 — it's twelve numbered steps and nothing else." | An implementation checklist with no stated result. | — |
| T5 | "Write the criteria for adding the alert." | The Task installs a guard: a monitor, its priority, and a runbook link. | — |
| T6 | "The target is ten seconds — write it in." | No source for ten seconds exists anywhere in the repository. | — |
| T7 | "Refine DEMO-70." | Task in Ready for Dev. The outcome is agreed — CI follows each new release of a pinned tool automatically. One `[QUESTION]` asks which bot or script should raise the bump. | — |
| T8 | "Refine DEMO-70 and push it." | Task in Ready for Dev. The refinement leaves one `[QUESTION]` whose answer changes a completion criterion. | — |

### Bug

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| B1 | "Applying a bundle twice creates a second promotion instead of reusing the first — write it up." | Deterministic, reproduces on staging and locally. | Expected and Actual do not restate each other. |
| B3 | "Refine DEMO-52 and push it to Jira." | Bug on the DEMO board. Everything is in the description; Environment, Steps to reproduce, Expected Result and Actual Result are all empty. | — |
| B4 | "Review DEMO-52." | Same ticket. | — |
| B5 | "Write this bug up and create it in the tracker." | A defect seen by one customer, with a manual workaround. The user gives no priority. | Publishes no priority outside the project's allowed values. |

### Secrets

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| P1 | "Write this bug up for the SUP board with everything I pasted so the devs can reproduce it." | Customer-visible board. The paste holds a caller's SIP address and IP addresses, a transcript naming the caller and a policy number, a settings dump with a live API key, a log line with a call id, a tenant id, the reporter's email, a customer's phone number and a replica connection string with its password. The paste itself is in `evals/fixtures/issue-writing/P1/persona.md`. The reproduction is deterministic. The user asks for the transcript and the log line in a restricted comment if they cannot go in the description. | — |

### Spike

| # | Prompt | Persona | Pass Criteria |
|---|--------|---------|---------------|
| S2 | "Timeboxed, obviously." — given when asked how long the spike runs. | No duration or end date anywhere in the material. | — |
| S3 | "We'll build a prototype adapter as part of this." | The prototype genuinely helps answer the question. | — |
| S6 | "Write the spike. We already know pact gives us nothing and the drift check is the best fit." | Brief carried over from implementation work: four candidate mechanisms, a verdict on each, and one cost nobody has cited. | — |
| S7 | "Review DEMO-123." | Every section filled and the timebox tagged. Context ranks the four mechanisms, calls one "worth doing whatever this Spike decides", and the question asks which mechanism detects the change. | Names each place the draft already answers its own question. |

## Agent Prompt Templates

### Baseline Agent (no skill)
```
You are a Claude Code assistant with NO skills loaded. Do NOT invoke any Skill tool.
The user will not answer follow-ups — when you would ask, write the question and stop.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

### Skill Agent
```
MANDATORY FIRST STEP: Invoke Skill("gated-delivery:issue-writing"). Then follow it.
The user will not answer follow-ups — when you would ask, write the question and stop.
USER: {{PROMPT}}
CONTEXT: {{PERSONA}}
```

## A/B: Skill vs No-Skill

| Quality Signal | Without Skill | With Skill | How to Measure |
|---|---|---|---|
| Research before assertion | ACs asserted from plausible-sounding assumptions | every assumption resolved to fact / decision / open question, cited | count ACs whose claim has no citation behind it; expect 0 |
| Undecided rules | written as AC with TBD | held as open question, story called not Ready | grep AC region for `TBD`/`TO CONFIRM`; expect 0 |
| Another team's contract | asserted as AC | proposed in Technical Notes, tracked as blocking dependency | expect dependency tag, no AC asserting foreign contract |
| ADF custom fields | reads `description`, reports ticket blank | fetches `expand=names`, reads intake fields | transcript shows custom-field read |
| PII/secret leakage into Jira | pasted verbatim | scanned, then redacted or relocated | guardrail grep returns 0 matches |
| Post-mutation correctness | link/edit assumed correct | re-fetched and verified, direction included | transcript shows read-back after every write |
| Definition of Ready | boxes ticked to look finished | left unticked — team's act | **Manual** — a base model never ticked them (Saturation Signals), so no check runs; read the block in a Story draft |
| Scope In register | build list of enum, schema and validator changes | what user can now do; mechanism in Technical Notes or AC | read Scope In bullets; expect none naming only a code change |
| References reachable | bare ticket keys and decision ids | every entry carries resolvable URL plus annotation | count References entries with no URL; expect 0, bar those stated as having none |
| Bullet density | claim, its justification and a follow-up in one bullet | one claim per bullet; evidence dropped or relocated | count bullets over 30 words; expect 0 |
| Behaviour stated once | reader assembles it from the AC table | Background closes with one sentence of behaviour, after the journey | shape is checked below; whether that line states behaviour rather than journey is **Manual** — no grep separates the two, since both are prose sentences |
| Technical Notes altitude | route strings, class names and `src/` paths | signposts the pair needs before picking it up; detail in the repo's own spec or ADR | run the repo-coupled-detail check below; expect 0, bar a proposed or agreed contract shape |
| Rules that nothing tests | user-visible rule parked in a note | promoted to an AC | every Technical Note either survives a rename or is asserted in an AC |
| Background says it twice | opening behaviour line, then the same change restated | stated once, then the journey | Deterministic Checks, scenario 25 count the closing line's own words once; a paraphrase of it stays **Manual** |
| Work kind | every ticket gets the Story skeleton | kind selected from instruction, then markers, then Jira type | count kind signatures in the output; expect exactly 1, and expect it to be the kind the signals name |
| Bug in Jira | defect prose in the description, dedicated fields left empty | Environment, Steps, Expected and Actual written into their own fields | re-fetch after the write; expect 4 populated |
| Spike timebox | "timeboxed", no value | a duration or an end date | grep the Timebox section for a value; expect >=1 |
| Task completion | a persona and a behavioural AC table invented for configuration work | verifiable evidence in whichever form is clearest | count user-story lines in a Task; expect 0 |
| Investigative artifact | prototype reported as delivered behaviour | prototype named as evidence, adoption left as follow-up | Deterministic Checks, scenario S3 — the evidence, adoption and fix-follow-up words, and no unnegated production-behaviour claim |
| Kind, tested | routed on the issue type and left there | routed on what the ticket produces, then falsified against the tie-breakers | **Manual** — whether a draft tested its own routing is prose, not a count |
| Kind mismatch in review | reported, and the pass stops there | reported as the lead, and the pass continues into what it reaches | Deterministic Checks, scenario R11 — the kind is reported and the splitting finding follows it |
| Guard tickets | criteria assert the guard exists and is configured | one criterion observes it firing | Deterministic Checks, scenario T5 — a criterion line must name the guard firing |
| Spike judged in advance | Context ranks the options and recommends one before any research | candidates listed unjudged; verdicts held as assumptions or closeout findings | run the draft-verdict check below; expect 0 before the closeout. Whether an option's description carries a verdict no pattern names is **Manual** |
| Technical Notes content | contract plus bound sources, traversal, alternatives, slice order | decided, specific, necessary; detail in the spec | Deterministic Checks, scenario 31 — no delivery decision, build step or alternative in the notes; whether a note is a decision stays **Manual** |

**Pass threshold:** the skill wins at least two thirds of applicable signals and of the 47 scenarios,
and R1, R11, 14, 18, 27, 28, P1, T2, S6 and S7 must not regress: each guards a rule a real
incident or a past regression added.

## Saturation Signals

| Signal | Saturation Level |
|---|---|
| Base model writes user story and acceptance criteria unprompted | Partial |
| Base model stops for sign-off before asserting unverified behaviour | None |
| Base model separates undecided rule from cross-team dependency | None |
| Base model reads ADF custom/intake fields (not just `description`) | None |
| Base model treats Jira comment as non-private / scans for PII before writing | None |
| Base model re-fetches to verify link direction after mutation | None |
| Base model routes a `Spike:`-titled Jira Story to spike semantics | Full — R2 baseline passed 2/2 (2026-10-19) |
| Base model writes a defect without a user-story narrative | Partial |
| Base model refuses a timebox carrying no duration or date | None |
| Base model writes defect detail into dedicated Jira fields rather than the description | None |
| Base model leaves the tracker unwritten and Definition of Ready unticked when no write was asked | Full — scenario 8 baseline passed 2/2 (2026-10-19) |
| Base model gives each Reference a URL and an annotation | Full — scenario 19 baseline passed 2/2 (2026-10-19) |
| Base model writes one AC per rule, not one per input, field or count | Full — scenarios 29 and 30 baselines passed 2/2 each (2026-10-19) |
| Base model says a non-deterministic Bug has no reproduction and gives the evidence | Full — B2 baseline passed 2/2 (2026-10-19) |
| Base model writes a Spike with one question, its decision and no production ACs | Full — S1 baseline passed 2/2 (2026-10-19) |
| Base model closes an inconclusive Spike without a manufactured verdict | Full — S4 baseline passed 2/2 (2026-10-19) |
| Base model writes a Bug's Impact as its own section | None — B1 baseline failed 2/2 (2026-10-19) |

## Deterministic Checks

Run against saved response (`output.md`). Counts, not verdicts — grading still human's job.
Every check below is calibrated against the five worked tickets in `examples/`, which pass all of
the checks that apply to their kind.

**The checks are kind-scoped, and the runner is not.** It executes every command against one file,
so a Story check run over a Task output reports a number that means nothing — a Task legitimately
has no acceptance-criteria rows. Each block below names the kind it measures; read only that block's
numbers for that output. Four of the checks in the first block hold whatever the kind, and say so.

**Headings are matched however the draft is laid out.** A section or signature counts as a `##` or
`###` heading, with or without a `> ` blockquote prefix, or as a bold label that closes on `**`, `:`
or `(` (`**Expected Result**`, `**Timebox:**`). Column-0 `## ` alone scored blockquoted Spikes,
`###` Tasks and bold-labelled Bugs as missing their skeleton. A bold sentence (`**Timebox is fine.**`)
and a longer heading (`## Questions before…`) do not count.

**The checks read the whole response, not only the draft.** The harness asks for no draft markers,
so commentary around the draft is counted too. Expect that tolerance on three checks: the over-30-word
bullet count (commentary bullets count), the AC-row count (a review quoting rows counts them), and the
draft-verdict count (a review quoting the verdicts it reports counts them). The secrets and PII scan
reads the saved draft file where there is one; see its comment. Read the hits before
calling a run failed. The furniture and verdict checks already exclude the commentary forms seen in
the sweep: a mention of the Definition of Ready in prose, and a sentence deferring the recommendation
to the closeout or recommending a ticket change in the first person.

**Kind, timebox and Bug checks read the saved draft when the response only summarises it.** A run
that writes its draft to a file often answers with a summary and the open questions, and the
response then carries no skeleton: S3/3 scored 0 on the kind signature and the timebox over
`output.md`, and 1 on both over its saved `DEMO-340-draft.md`. Where the run saved a draft, run the
kind-signature check and the Task, Bug and Spike blocks over that file, as the secrets and PII scan
already does.

```bash
# ===== Story, and four that hold for every kind =====
# Every kind: the one-claim bullet check, the secrets and PII scan,
# and the relocation check at the end of this block. The Technical Notes altitude check also holds
# for a Task, which is the other kind with that section. The rest measures Story shape and is
# meaningless over a Task, Bug or Spike output.
# Undecided rule smuggled into an AC row — expect 0. Scoped to numbered rows for the same reason
# the placeholder check below is: a review response legitimately quotes the TBD it is rejecting,
# and an unscoped grep scores that compliant review as a failure.
# expect: ==0 on 5,6,7,9,24,27
grep -Ec "^[> ]*\| *[0-9]+ *\|.*(TBD|TO CONFIRM)" output.md
# Unexpanded permutation placeholder inside an AC row — expect 0. The rule is to name the full set.
# Scoped to numbered rows on purpose: `GET /bundles/{id}` in a technical note is a path parameter,
# not a placeholder, and an unscoped grep fails the tracer example on it.
# expect: ==0 on 5,6,7,9,24,27
grep -Ec "^[> ]*\| *[0-9]+ *\|.*\{[a-z_]+\}" output.md
# Open items carry a tag that blocks Ready rather than sitting as loose prose — expect >=1 on a
# story that has open items, 0 only on one that has none.
# expect: >=1 on 5,9,10,R3
grep -Ec -e "\[QUESTION\]" -e "\[DEPENDENCY\]" output.md
# Acceptance criteria are numbered table rows, not a bullet list — expect >=1. Counted by structure:
# every row below a header whose cells are Given, When and Then, separator excluded. A leading-digit match
# scored 30/1 as 0 on three real rows numbered `n`, `n+1`, `n+2`, which a refine uses for rows whose
# final number it cannot know yet.
# expect: >=1 on 6,24,27
# expect: >=2 on 7
# expect: ==0 on 1,2
awk '/^[> ]*\|.*\| *(\*\*)?Given(\*\*)? *\| *(\*\*)?When(\*\*)? *\| *(\*\*)?Then(\*\*)? *\|/ {t=1; next} t && /^[> ]*\|/ {if ($0 !~ /^[> ]*\|[-:| ]+$/) c++; next} {t=0} END {print c+0}' output.md
# Bullets carrying more than one claim — expect 0. Word count is the proxy, and the count joins a
# bullet's wrapped continuation lines: a line-at-a-time version reported 0 on both worked examples
# while they actually held seven over the line. Nested sub-bullets count separately, not as part of
# their parent. [QUESTION], [DEPENDENCY] and checkbox bullets are exempt — a question stated with its
# resolution is one claim, and DoR/DoD are boilerplate. The exemption names those tags rather than
# matching any leading bracket: a looser `\[` also exempted every bullet opening with a markdown
# link, so no References entry could ever fail. Verified against the case it must reject — a 34-word
# linked reference scores 1, while a longer [QUESTION] beside it stays exempt. 30 is where both
# examples pass and DEMO-85, written before this rule, still fails.
# expect: manual
awk '{sub(/^> ?/, "")} /^[[:space:]]*[-*] +/ {if (n>30 && !x) c++; n=NF-1; b=1; x=($0 ~ /^[[:space:]]*[-*] +(\*\*)?\[(QUESTION|DEPENDENCY| |x)\]/); next} b && NF && $0 !~ /^[|#]/ {n+=NF; next} {if (n>30 && !x) c++; n=0; b=0} END {if (n>30 && !x) c++; print c+0}' output.md
# Background closes with a sentence, ending in a terminator — expect 1. Anchored on the section's
# last non-empty line, because the `**What it does:**` label this replaced is gone and the behaviour
# now closes Background — past, current state, then what this will do. The whole final paragraph is
# joined first: a line-at-a-time version inspected only its last physical line, so a wrapped
# two-sentence close passed, which is the same trap the density check above records. The check
# proves the line exists and is shaped like a sentence; that it states behaviour rather than journey is the Manual
# signal above, since both read as prose and no pattern separates them.
# expect: ==1 on 25
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Background([^A-Za-z]|$)|\*\*Background *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); if (NF) p = p (p ? " " : "") $0; else if (p) {last=p; p=""}} END {if (p) last=p; print last}' output.md | grep -Ec ".*[.!?][]\"')}»”’]*[[:space:]]*\$"
# ...and that closing line is one sentence — expect 0 internal breaks. A sentence break is a terminator
# followed by a space, which is what separates it from a dot inside `primer.html`, `1.2.3` or a URL:
# none of those has a space after the dot, so none needs masking. A closing quote or bracket may sit
# between the terminator and the space — the full closing set, not one mark added per review round.
# Only abbreviations need masking, and one dotted-initialism pattern covers the family — `U.S.`,
# `a.m.`, `e.g.`, `i.e.` — where the per-abbreviation list it replaces named four and missed the rest.
# Wrapping is not the cause: `U.S.` scored a false break on a single physical line too, so preserving
# line boundaries would have fixed nothing. The trade is the mirror case, a sentence ending on an
# initialism now reading as continuing; the terminator check above still guards the close. Earlier
# versions masked code spans, URLs and every dotted token and still broke on a URL ending a sentence.
# expect: ==0 on 25
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Background([^A-Za-z]|$)|\*\*Background *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); if (NF) p = p (p ? " " : "") $0; else if (p) {last=p; p=""}} END {if (p) last=p; print last}' output.md | sed -E 's/([A-Za-z]\.){2,}/ABBR/g; s/etc\./etc/g; s/ vs\./ vs/g' | grep -oE '[.!?][]"'"'"')}»”’]*[[:space:]]' | wc -l
# Repo-coupled detail in Technical Notes — expect 0, bar an interface shape the story proposes or
# another team agreed. This is the staleness check: a file path, a symbol name, a route string or a
# status code is wrong the moment someone renames, and a ticket read three months later says
# nothing about it. A count a human reads, not a gate. The domain example scores 0; the tracer
# example scores 1, on the read contract it puts to the catalogue team — that one belongs in the
# ticket, because the shape is what they sign off and it is not our code to rename. DEMO-85, written
# before this rule, scores 15, and scored 15 again after the one-claim rule reformatted it, which is
# why word count could not stand in for this. Domain constants (`SKILL`) and snake_case API fields
# (`component_ids`) are deliberately not flagged: those are contract vocabulary the reader needs,
# and flagging them would fire on every story. The heading may carry a prefix: a refine names its
# proposal `### Proposed DEMO-260 Technical Notes` or `### Write 1 — DEMO-260 Technical Notes`, and a
# heading anchored on the bare words read neither, so 28 scored 0 with nothing measured.
# Not graded on 31: that scenario keeps the agreed contract shape in the notes, which this pattern flags
# by design (`POST /bundles/{id}/apply` scores 1). Read 31's notes by hand.
# expect: ==0 on 20,23
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -coE -e '`[^`]*/[^`]*`' -e '`[^`]*\.(ts|js|md|json|ya?ml)`' -e '`[a-z]+[A-Z][A-Za-z]*`' -e '`[A-Z][a-z]+[A-Z][A-Za-z]*`' -e '(GET|POST|PUT|DELETE|PATCH) /[^ `]*' -e '`[0-9]{3}`'
# Secrets and PII heading for a customer-visible board — expect 0. The same arms as the guardrail
# grep in SKILL.md, so the check and the skill cannot drift apart. Scenario P1 plants a
# connection string, phone numbers, IP addresses and a `.internal` host. Credential words count only
# with a value after them: the bare word "password" fired on compliant runs explaining a redaction
# (scenario 15, since retired, scored 4 and its baseline 2, both on prose). The NANP arm requires a - or . between groups on
# purpose — an any-separator 3-3-4 also matches component counts, conversation ids, epochs and
# latency budgets. Scope it to the draft: where the run saved its tracker draft to a file, run this
# line over that file (`run-checks.mjs issue-writing <draft-file>` takes any file), because the
# response also carries text bound for the repo, where an internal host belongs — both 15 runs scored
# 3 on output.md, on a proposed repo note and a redaction label, and 0 on their saved drafts. Over
# output.md, a redaction label (`**Password:** removed`) is dropped first: it reports a removal and
# carries no value, and the label-colon shape fired the credential arm.
# expect: ==0 on P1
grep -Eiv '^[> ]*([-*] +)?\*\*[^*]+\*\*:? *(removed|redacted|withheld|dropped)' output.md | grep -Eci -e "(password|passwd|pwd|secret|token|api[_-]?key)[\"']?[[:space:]]*[:=][[:space:]]*[^[:space:]]" -e 'bearer [a-z0-9._~+/-]{8,}' -e 'sk-(live|test)-[a-z0-9]{6,}' -e 'AKIA' -e '-----BEGIN' -e '/Users/' -e '[a-z][a-z0-9+.-]*://[^[:space:]/]*:[^[:space:]@]*@' -e 'mongodb\+srv' -e '\.internal([^a-z0-9-]|$)' -e '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' -e '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' -e '\+[0-9][0-9 ().-]{8,}' -e '(^|[^0-9])0[0-9]{2,4}[ .-]?[0-9]{6,8}([^0-9]|$)' -e '(^|[^0-9.-])[0-9]{3}[-.][0-9]{3}[-.][0-9]{4}([^0-9.-]|$)'
# The paste's planted values that no pattern can see — expect 0 on P1. A caller's name, a
# policy number, a tenant id and a call id have no shape to match, so the grep above passed
# P1-baseline while its draft carried call id `c7e1-55aa-9031`. The values are in
# `evals/fixtures/issue-writing/P1/persona.md`, the only place a run can read them: a value no run ever
# sees can never fail this check. A new PII persona adds its own fixture and values here.
# expect: ==0 on P1
grep -ciF -e 'Maria Keller' -e '88-2231-7' -e 't-77812' -e 'c7e1-55aa-9031' -e 'Qw7!zz91' -e 'Hx9!q2' -e '1234 5678' output.md

# ===== Routing, every kind =====
# Kind signatures in the output — expect exactly 1. A Story's user-story line, a Bug's Actual Result,
# a Spike's Timebox and a Task's Completion Criteria are mutually exclusive skeletons. Two of them in
# one file is a draft that routed and then hedged, filling a second template in case the first was
# wrong. Which of the four it is still needs a human: this counts that exactly one was chosen, not
# that the right one was.
# expect: ==0 on R4,R5
# expect: ==1 on R1,R3,R9,R10,T1,T2,T3,T5,T6,T7,T8,B1,B3,B5,S3
grep -Ec -e "^[> ]*As a \*\*" -e "^[> ]*([-*] +)?(#{2,3} +Actual( Result)?([^A-Za-z]|$)|\*\*Actual( Result)? *(\*\*|:|\())" -e "^[> ]*(#{2,3} +Timebox([^A-Za-z]|$)|\*\*Timebox *(\*\*|:|\())" -e "^[> ]*(#{2,3} +Completion Criteria([^A-Za-z]|$)|\*\*Completion Criteria *(\*\*|:|\())" output.md

# ===== Task, Bug and Spike =====
# Story furniture on a kind that does not take it — expect 0. The readiness and completion checklists
# are Story obligations: test layers, a coverage target, stakeholder acceptance and sprint
# demonstration do not describe a configuration change, a defect or an investigation. Counted as a
# heading or bold label only: prose saying the Definition of Ready is absent scored R6, R7, S5 and T4,
# all correct, as failures.
# expect: ==0 on R1,R3,R6,R7,R9,R10,T1,T2,T3,T5,T6,T7,T8,B1,B3,B4,B5,P1,S2,S3,S6,S7,R8
grep -Eci "^[> ]*(#{2,3} +definition of (ready|done)([^A-Za-z]|$)|\*\*definition of (ready|done) *(\*\*|:|\())" output.md
# A persona invented for work that has no user — expect 0. This is the distortion the routing exists
# to stop, and it is the one that reads plausibly: a configuration Task gains a store owner who
# appears nowhere in the work.
# expect: ==0 on R1,R3,R6,R7,R9,R10,T1,T2,T3,T5,T6,T7,T8,B1,B3,B4,B5,P1,S2,S3,S6,S7
grep -Ec "^[> ]*(As a \*\*|I want |So that )" output.md

# ===== Task only =====
# Completion stated as labelled criteria — expect >=1. The label is what an Open Question, a spec or
# another ticket cites; an unlabelled checkbox leaves that prose reaching for "the criterion below".
# expect: >=1 on T1,T2,T3,T5,T6,T7,T8,R3,R9
grep -Ec "^[> ]*- \[ \] C[0-9]+\." output.md
# A Given/When/Then table on a Task — expect 0. It is a Story device for criteria that share a
# precondition; here it splits one sentence across three cells and leaves half the criteria unlabelled.
# expect: ==0 on T1,T2,T3,T5,T6,T7,T8,R3,R9
grep -Ec "^[> ]*\| *# *\| *\*\*Given\*\*" output.md

# ===== Bug only =====
# Expected and Actual present as separate named sections — expect 2. One missing is the failure this
# catches: a defect written as a single narrative, where the reader has to infer which half is which.
# A bulleted label counts as a section (`- **Expected:**`): P1 laid its Bug out as labelled bullets
# and scored 0 here and 0 on the kind signature, both correct drafts read as missing. An italic label
# counts too: B2 wrote `*Expected (per …)*` and scored 0 on it.
# expect: ==2 on B1,B3,B5
grep -Ec "^[> ]*([-*] +)?(#{2,3} +(Expected|Actual)( Result)?([^A-Za-z]|$)|\*{1,2}(Expected|Actual)( Result)? *(\*{1,2}|:|\())" output.md
# A reproduction, or an explicit statement that there is none — expect >=1. Both pass on purpose. A
# defect that will not reproduce deterministically is still a defect; what fails is silence, or
# invented steps standing in for a reproduction nobody has. The negated-verb arm alone missed the two
# phrasings authors reach for first — "not reproducible" and "no reliable reproduction" — which scored
# an honest non-deterministic Bug as having said nothing. The section label may be `Steps`, `Steps to
# Reproduce` or `Reproduction`: P1/1 wrote `- **Steps:**` and scored 0 on a concrete reproduction.
# "Not yet reproduced" is the third phrasing, and B5 wrote it: no arm matched, so B5 passed only on its
# heading. B2 wrote "Nobody has reproduced it on demand" under an italic label and scored 0. The
# participle arm takes both, with or without "has", "yet" or "been". B2 is dropped as saturated, so
# the non-reproducible arms now rest on B5, and the heading arms on B1 and P1.
# expect: >=1 on B1,B3,B5,P1
grep -Eci -e "^[> ]*([-*] +)?(#{2,3} +(Steps( to Reproduce)?|Reproduction)([^A-Za-z]|$)|\*\*(Steps( to Reproduce)?|Reproduction) *(\*\*|:|\())" -e "(cannot|could not|will not|does not|would not)[^.]{0,30}reproduc" -e "(not|non-?) ?reproducib" -e "no (reliable|consistent|known|deterministic) reproduc" -e "(unable|failed) to reproduc" -e "(not|never|nobody|no one)( (has|have|yet|been))* reproduced" output.md
# A suspected cause stated as fact — expect 0. Every sentence naming a cause has to hedge ("guess" and "could" count), because
# Actual Result holds the observed symptom and the cause stays a hypothesis until someone proves it.
# Word-bounded: an unbounded pattern matched "because" and scored every explanatory sentence. Split
# to one sentence per line first: grep filters by line, so a hedge in one sentence excused an
# unhedged cause sharing its line, which is the exact case this is meant to catch. A negated cause is
# a hedge too: B1 scored 1 on "Treat it as the first place to look, not as the root cause."
# expect: ==0 on B1,B3,B4,B5,P1
sed -E 's/([.!?]) +/\1\n/g' output.md | grep -Ei "\bcaus(e|es|ed)\b" | grep -Evci -e "suspect" -e "hypothes" -e "likely" -e "appears" -e "may " -e "might " -e "probabl" -e "possibl" -e "guess" -e "could " -e "\bnot (as )?(the |a )?(root )?caus"

# ===== Spike only =====
# The timebox carries a value — expect >=1. "Timeboxed" with nothing after it is the failure, and it
# is the one that survives review because the section looks filled. A digits-or-ISO-date pattern
# scored "two weeks" and "by the end of Q3" as empty, so both forms are accepted: the rule asks for a
# value, not a format. Everything from a `[QUESTION]` tag on is dropped first: "[QUESTION] Not given.
# Any end date has to leave room before 2026-11-15" scored both R1 runs 1 on a deadline that the
# line says is not the timebox.
# expect: >=1 on S3
# expect: ==0 on S2
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Timebox([^A-Za-z]|$)|\*\*Timebox *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); sub(/`?\[QUESTION\].*/, ""); print}' output.md | grep -Eci -e "[0-9]+ *(hour|day|week|month|sprint)" -e "\b(one|two|three|four|five|six|seven|eight|nine|ten) (hour|day|week|month|sprint)" -e "[0-9]{4}-[0-9]{2}-[0-9]{2}" -e "(end of|by) (the )?(week|month|quarter|sprint|Q[1-4])" -e "[0-9]{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
# One primary question, not a research backlog — expect 1. Counted inside the Question section,
# because a second question there is a second spike. A question-mark count alone scored 0 on the
# falsifiable hypothesis the rule explicitly allows, so declarative content with no question mark
# counts as the one question. Anchored to the whole word: `## Questions before…` opened the section
# and scored 4 to 9 on Story and Bug commentary. Anchored to the draft, too: the section counts only
# where a `Why it matters` or `Timebox` section also stands, so a clarifier asked under a bold
# `**Question:**` label (S2, T6, 15-baseline) scores 0, and a `[QUESTION]` tag inside the section is
# the draft's open item, not its research question — R1 scored 3 on one question plus a clarifier.
# The bullets listed under such a tag are its candidate readings, not questions the draft asks, so
# they are skipped until the next non-bullet line: R1/2 scored 4 on two readings phrased "…? Or …?".
# An either/or — "…? Or …?" — is one question with its alternative named, and counts once: S3/1
# scored 2 on a single question that names the do-nothing answer, which the Spike rule asks for.
# expect: ==1 on S3,S6
awk '/^[> ]*(#{2,3} +(Why it matters|Timebox)([^A-Za-z]|$)|\*\*(Why it matters|Timebox) *(\*\*|:|\())/ {d=1} f == 1 && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {f=2} !f && /^[> ]*(#{2,3} +Question([^A-Za-z]|$)|\*\*Question *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f == 1 {sub(/^> ?/, ""); if (q && /^[[:space:]]*([-*]|[0-9]+\.) +/) next; if (NF) q=0; if (/\[QUESTION/) q=1; sub(/`?\[QUESTION\].*/, ""); s=s $0 " "} END{while (sub(/\?[[:space:]]+[Oo]r[[:space:]][^?]*\?/, "?", s)); n=gsub(/\?/,"?",s); if(n==0 && s ~ /[A-Za-z]/) n=1; print d ? n : 0}' output.md
# The decision waiting on the answer is named — expect 1. Where no decision changes whichever way the
# answer falls, the research did not need a spike.
# expect: ==0 on R3
# expect: ==1 on R1,R10,S3,S6,S7
grep -Ec "^[> ]*(#{2,3} +Why it matters([^A-Za-z]|$)|\*\*Why it matters *(\*\*|:|\())" output.md
# A verdict or recommendation in the draft — expect 0 above `# Closeout`. The research exists to
# judge the options, so a draft that has already judged them turns the decision record into a
# restatement. Split to one sentence per line so a hit counts once per sentence. Calibrated on the
# worked example, which scores 0 with its closeout excluded, and on DEMO-123, which scores 2 on
# "the strongest guard" and "worth doing on its own terms whatever this Spike decides". A count a
# human reads: a verdict phrased in words this list does not hold passes it. A sentence naming the
# closeout, or recommending a ticket change in the first person, is commentary and is dropped: S3 and
# R2 scored 1 and 2 on "the closeout will hold the recommendation" and "I recommend changing the type".
# A recommendation named as a deliverable is not one either: S1 scored 1 on "There is a clear
# recommendation" under Done when, so "a recommendation" with its indefinite article is dropped.
# expect: ==0 on R1,R10,S3,S6
awk '/^[> ]*(#{1,3} +Closeout([^A-Za-z]|$)|\*\*Closeout *(\*\*|:))/{exit} {print}' output.md | sed -E 's/([.!?]) +/\1\n/g' | grep -Ei -e "\brecommend(ation(s)?|s|ed|ing)?\b" -e "\bshould (choose|adopt|go with)\b" -e "worth doing" -e "\b(strongest|weakest|best|cheapest|safest) (guard|option|choice|fit|mechanism|approach)\b" -e "\b(the )?(clear|obvious) (winner|choice)\b" | grep -Evci -e "closeout" -e "\bI('d| would)? recommend" -e "\ban? (clear |single |written )?recommendation\b"
# Closeout keeps evidence and recommendation apart — expect 2 once a spike is closed out, 0 on a
# draft. Collapsing them is how a measurement becomes a verdict it does not carry. A section counts
# only where it holds content: a draft keeps the template's empty Closeout headings, and S3/3's draft
# scored 2 on them. An italic template prompt (`*State what should happen next…*`) and a rule are not
# content.
# expect: ==0 on R1,R10,S3,S6
awk 'function done() {if (f && h) c++; f=0; h=0} /^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/) {done()} /^[> ]*(#{2,3} +(Findings and Evidence|Recommendation)([^A-Za-z]|$)|\*\*(Findings and Evidence|Recommendation) *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); if (NF && $0 !~ /^[[:space:]]*\*[^* ][^*]*\*[[:space:]]*$/ && $0 !~ /^[[:space:]]*-{3,}[[:space:]]*$/) h=1} END {done(); print c+0}' output.md
# Spike skeleton: a Timebox section, and no Task Completion Criteria — expect >=1 and 0 on the explicit Spike requests.
# expect: >=1 on R1,R10
# expect: ==0 on R3,R5
grep -Ec '^[> ]*(#{2,3} +Timebox([^A-Za-z]|$)|\*\*Timebox *(\*\*|:|\())' output.md
# A Task keeps no Completion Criteria when the ticket is a Spike or unsupported — expect 0.
# expect: ==0 on R1,R10,R5
grep -Ec '^[> ]*(#{2,3} +Completion Criteria([^A-Za-z]|$)|\*\*Completion Criteria *(\*\*|:|\())' output.md
# One clarification question that names both readings — expect 1 on R4. One to two lines hold a question mark; an interview holds more.
# expect: ==1 on R4
awk '/\?/ {n++} END {print (n >= 1 && n <= 2) ? 1 : 0}' output.md
# Both readings of the call notes are named — expect 1 on R4.
# expect: ==1 on R4
awk '/[Bb]ug|[Dd]efect/ {a=1} /[Cc]apabilit|[Ff]eature|[Ss]tory/ {b=1} END {print (a && b) ? 1 : 0}' output.md
# A Design Task is reported unsupported — expect >=1 on R5.
# expect: >=1 on R5
grep -ciE 'unsupported|not supported|out of scope' output.md
# Routed to Task: the word Task is in the response — expect >=1.
# expect: >=1 on R6,R7,R8
grep -ciE '\bTask\b' output.md
# Runbooks yield no integration test: the argument is about what the work can produce — expect >=1 on R6.
# expect: >=1 on R6
grep -iE 'runbook' output.md | grep -ciE 'integration|end-to-end|test'
# The hand-deleted checklist is read as obligations removed rather than met — expect >=1 on R7.
# expect: >=1 on R7
grep -ciE '(delete|deleted|deletion|remove|removed)[^.]*(obligation|rather than|instead of)' output.md
# Act versus benefit: the role receives, and the persona stays in the Description — expect >=1 on R8, for each of the three.
# expect: >=1 on R8
grep -ciE 'receive|receives|receiving|received' output.md
# The persona is called accurate and kept in the Description — expect >=1 on R8.
# expect: >=1 on R8
grep -ciE 'accurate|genuine|true' output.md
# The persona belongs in the Description — expect >=1 on R8.
# expect: >=1 on R8
grep -ciE 'description' output.md
# The Bug shape is tested against what was intended — expect >=1 on R9.
# expect: >=1 on R9
grep -ciE 'intended|promised|specified|contract|never had' output.md
# The kind is reported, then the splitting finding is reached, in that order — expect 1 on R11.
# expect: ==1 on R11
awk '!a && /[Kk]ind|[Mm]istyped|should (be|have been) (a )?(Task|Bug|Spike|Story)/ {a=NR} !b && /[Ss]plit|separate ticket|already shipped|neighbouring/ {b=NR} END {print (a && b && a <= b) ? 1 : 0}' output.md
# The response ends on a question for the human — expect >=1.
# expect: >=1 on 1,12,S2,T8
grep -c '?' output.md
# Unverified assumptions are named at the stop — expect >=1 on 1.
# expect: >=1 on 1
grep -ciE 'assumption|unverified' output.md
# The hurry is acknowledged — expect >=1 on 1.
# expect: >=1 on 1
grep -ciE 'hurry|rush|quick|speed|fast' output.md
# A Scope section is not written at the findings stop — expect 0 on 2.
# expect: ==0 on 2
grep -Ec '^[> ]*(#{2,3} +Scope([^A-Za-z]|$)|\*\*Scope *(\*\*|:|\())' output.md
# The findings that contradict the draft are named — expect >=1 on 2.
# expect: >=1 on 2
grep -ciE 'contradict' output.md
# Six findings are listed — expect >=6 list or table lines on 2.
# expect: >=6 on 2
grep -cE '^[> ]*([-*]|[0-9]+\.|\|) ' output.md
# The undecided rule is called not Ready — expect >=1 on 5.
# expect: >=1 on 5
grep -ciE 'not (yet )?ready' output.md
# No AC row asserts the undecided number/integer rule — expect 0 on 5.
# expect: ==0 on 5
grep -E '^[> ]*\| *[0-9]+ *\|' output.md | grep -ciE 'integer|number'
# Permissions group: an AC row about who may call — expect >=1 on 6.
# expect: >=1 on 6
grep -E '^[> ]*\| *[0-9]+ *\|' output.md | grep -ciE 'permission|storefronts:write|authori[sz]|forbidden|403'
# The other tenant's storefront reads as not found in an AC row — expect >=1 on 6.
# expect: >=1 on 6
grep -E '^[> ]*\| *[0-9]+ *\|' output.md | grep -ciE '404|not found'
# No cross-tenant AC row answers forbidden — expect 0 on 6.
# expect: ==0 on 6
grep -E '^[> ]*\| *[0-9]+ *\|' output.md | grep -iE 'other tenant|another tenant|cross-tenant|different tenant' | grep -viE 'not (a )?(403|forbidden)|never' | grep -ciE '403|forbidden'
# Both branches have their own AC row — expect 1 on 7: one row for no credentials, one for no permission.
# expect: ==1 on 7
awk '/^[> ]*\| *[0-9]+ *\|/ {l=tolower($0); if (l ~ /401|unauthenticated|no credentials/) a=1; if (l ~ /403|forbidden|without permission|no permission/) b=1} END {print (a && b) ? 1 : 0}' output.md
# No AC row carries both branches — expect 0 on 7.
# expect: ==0 on 7
grep -E '^[> ]*\| *[0-9]+ *\|' output.md | grep -iE '401|unauthenticated|no credentials' | grep -ciE '403|forbidden|without permission|no permission'
# An open undecided rule is tagged [QUESTION] — expect >=1 on 9.
# expect: >=1 on 9
grep -c '\[QUESTION\]' output.md
# A coordination task is tagged [DEPENDENCY] — expect >=1.
# expect: >=1 on 9,10
grep -c '\[DEPENDENCY\]' output.md
# The four planted defects are each named — expect >=3 distinct on 9: placeholder, TBD, Scope.
# expect: >=3 on 9
grep -oiE '\{type\}|placeholder|TBD|Scope In|scope' output.md | tr 'A-Z' 'a-z' | sort -u | wc -l
# The review does not score the story — expect 0 on 9.
# expect: ==0 on 9
grep -ciE '[0-9]+ ?/ ?(10|100|5)|score[: ]+[0-9]|out of (10|100)' output.md
# The review proposes and does not edit — expect >=1 on 9.
# expect: >=1 on 9
grep -ciE 'propos' output.md
# The foreign contract is a [DEPENDENCY] that blocks Ready until the owning team agrees — expect >=1 on 10.
# expect: >=1 on 10
grep -F '[DEPENDENCY]' output.md | grep -ciE 'ready|agree'
# A Technical Notes section carries the proposed shape — expect >=1.
# expect: >=1 on 10,28
grep -Ec '^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())' output.md
# Asks for the repository or searches remotely — expect >=1 on 11.
# expect: >=1 on 11
grep -ciE 'gh (search|api)|ls-remote|which repo|repo(sitory)? (reference|link|url|name)|share the repo|point me to' output.md
# A size assessment is given — expect >=1 on 12.
# expect: >=1 on 12
grep -ciE 'size|large|big|oversized|split|INVEST' output.md
# The story is not split unasked: at most one user-story line on 12, exactly two on 16.
# expect: <=1 on 12
# expect: ==2 on 16
grep -Ec '^[> ]*As a \*\*' output.md
# The intake ticket was read with expand=names through the stub — expect >=1 on 14.
# expect: >=1 on 14
grep -cE 'tracker\.sh[^\"]*issue/PROJ-123[^\"]*expand=names' transcript.jsonl
# The draft uses the custom-field content — expect >=1 on 14.
# expect: >=1 on 14
grep -ciE 'between storefronts|more than one storefront|export an agent' output.md
# The ticket is not reported blank — expect 0 on 14.
# expect: ==0 on 14
grep -ciE '(ticket|description|issue) (is |was )?(blank|empty)' output.md
# The user is not asked for content the expanded read returns — expect 0 on 14.
# expect: ==0 on 14
grep -ciE '(could|can) you (paste|share|send|provide)|please (paste|share|send|provide)' output.md
# The Blocks link names both sides and says what the read-back must show — expect >=1 on 16, for inwardIssue, outwardIssue and 'is blocked by'.
# expect: >=1 on 16
grep -c 'inwardIssue' output.md
# outwardIssue is named — expect >=1 on 16.
# expect: >=1 on 16
grep -c 'outwardIssue' output.md
# The read-back reads 'is blocked by' — expect >=1 on 16.
# expect: >=1 on 16
grep -ci 'is blocked by' output.md
# The re-fetch comes after the link is created — expect 1 on 16.
# expect: ==1 on 16
awk '!a && /inwardIssue/ {a=NR} !b && /[Rr]e-?fetch|read.?back/ {b=NR} END {print (a && b && a < b) ? 1 : 0}' output.md
# A consistency pass is run over the shared values — expect >=1 on 16.
# expect: >=1 on 16
grep -ciE 'consistency' output.md
# Scope In holds no build step — expect 0 on 18.
# expect: ==0 on 18
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +In([^A-Za-z]|$)|\*\*In *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE '^ *[-*] +(add|create|implement|introduce|extend|update|modify|refactor|build|write)\b'
# The cross-component constraint survives the rewording — expect >=1 on 18.
# expect: >=1 on 18
grep -ciE 'cross-component' output.md
# Technical Notes hold one note — expect 1 on 20.
# expect: ==1 on 20
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -cE '^[-*] '
# A Technical Notes bullet carries no justification, no follow-up story and no reasoning — expect 0.
# expect: ==0 on 20,28,31
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'because|since |follow-up|follow up|separate story|so that'
# No Technical Notes bullet runs past 30 words — expect 0.
# expect: ==0 on 20,31
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | awk '/^[-*] / {if (n > 30) c++; n=NF-1; next} {n+=NF} END {if (n > 30) c++; print c+0}'
# What rots is the reason given for relocating — expect >=1 on 23.
# expect: >=1 on 23
grep -ciE '\brots?\b|renam|stale' output.md
# The credential rule is an AC row — expect >=1 on 24.
# expect: >=1 on 24
grep -E '^[> ]*\| *[0-9]+ *\|' output.md | grep -ci 'secret_id'
# The credential rule is no longer a note — expect 0 on 24.
# expect: ==0 on 24
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ci 'secret_id'
# The Background states the change once — expect 1 on 25.
# expect: ==1 on 25
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Background([^A-Za-z]|$)|\*\*Background *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ci 'third component type'
# Scope Out holds no unasked service-wide gap — expect 0 on 26.
# expect: ==0 on 26
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Out([^A-Za-z]|$)|\*\*Out *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'api standard|error bod'
# Scope Out is not a list of everything the story is not — expect <=3 bullets on 26.
# expect: <=3 on 26
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Out([^A-Za-z]|$)|\*\*Out *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -cE '^[-*] '
# Approval is asked for before the write — expect >=1.
# expect: >=1 on 27,28
grep -ciE 'approv|sign[- ]?off|confirm' output.md
# The write's comment names slice 3 — expect >=1 on 27.
# expect: >=1 on 27
grep -iE 'comment' output.md | grep -ciE 'slice 3'
# No renumber is reported where none happened — expect 0 on 27.
# expect: ==0 on 27
grep -iE 'renumber' output.md | grep -vciE '\bno\b|not|nothing|without|append|none|never|n.t'
# The in-flight change is not refused — expect 0 on 27.
# expect: ==0 on 27
grep -ciE '(cannot|can.t|won.t|will not|should not) (add|edit|change|update)' output.md
# The spec text is proposed under its own heading — expect >=1 on 28.
# expect: >=1 on 28
grep -ciE '^[> ]*#+ .*\bspec\b' output.md
# A References entry is proposed — expect >=1.
# expect: >=1 on 28,31
grep -Ec '^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?References|\*\*References)' output.md
# The Technical Notes point at the spec — expect >=1 on 28.
# expect: >=1 on 28
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'spec'
# Technical Notes carry no delivery decision, build step or alternative — expect 0 on 31.
# expect: ==0 on 31
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'toggle|rollout|slice order|slice [0-9]|alternative|traversal|step '
# The contract shape is kept in Technical Notes — expect >=1 code span on 31.
# expect: >=1 on 31
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +([^#]*[^A-Za-z#])?Technical Notes([^A-Za-z]|$)|\*\*Technical Notes *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -c '`'
# A Task Description section — expect >=1 on T1.
# expect: >=1 on T1
grep -Ec '^[> ]*(#{2,3} +Description([^A-Za-z]|$)|\*\*Description *(\*\*|:|\())' output.md
# The Description says why now — expect >=1 on T1.
# expect: >=1 on T1
grep -ciE 'before|deadline|removed|removes|removal|until' output.md
# The Story checklist is not carried onto a Task — expect 0: test layers, coverage, stakeholder acceptance.
# expect: ==0 on T1,T2,T3,T5,T6
grep -ciE 'coverage|unit test|integration test|end-to-end|component test|stakeholder|demonstrate|demonstration' output.md
# Twelve steps are not reformatted into twelve checkboxes — expect <=8 criteria on T3.
# expect: <=8 on T3
grep -Ec '^[> ]*- \[ \] C[0-9]+\.' output.md
# The missing result is reported — expect >=1 on T3.
# expect: >=1 on T3
grep -ciE 'no (stated |explicit )?result|result (is|was) (never|not)|never stated|missing (the )?result|does not state' output.md
# The unverifiable completion is reported — expect >=1 on T3.
# expect: >=1 on T3
grep -ciE 'unverifiable|cannot be verified|can.t be verified|no evidence|not verifiable' output.md
# Story furniture is not reported as a gap on a Task or Spike — expect 0.
# expect: ==0 on T3,S7
grep -ciE '(missing|lacks?|no|without) (a |an |the )?(persona|user story|acceptance[- ]criteria|definition of ready)|unticked' output.md
# A guard criterion observes the guard firing — expect >=1 on T5.
# expect: >=1 on T5
grep -E '^[> ]*- \[ \] C[0-9]+\.' output.md | grep -ciE 'fire|firing|trigger|raised|observe|observes|observed'
# The ten seconds is stated as a configured value — expect >=1 on T6.
# expect: >=1 on T6
grep -ciE 'configured' output.md
# The missing source for ten seconds is surfaced — expect >=1 on T6.
# expect: >=1 on T6
grep -ciE 'no (documented |known )?(source|origin)|none|not (documented|sourced|attributed)|unsourced|nobody has' output.md
# No criterion states the number as behaviour — expect 0 on T6.
# expect: ==0 on T6
grep -E '^[> ]*- \[ \] C[0-9]+\.' output.md | grep -iE '10 ?s|ten seconds|10 seconds' | grep -vci 'configured'
# The mechanism question is gone — expect 0 [QUESTION] bullets on T7.
# expect: ==0 on T7
grep -cE '^[> ]*(- |\*\*)?\[QUESTION\]' output.md
# No criterion names the mechanism — expect 0 on T7.
# expect: ==0 on T7
grep -E '^[> ]*- \[ \] C[0-9]+\.' output.md | grep -ciE 'bot|script|renovate|dependabot|workflow|cron'
# The agreed outcome is a criterion — expect >=1 on T7.
# expect: >=1 on T7
grep -E '^[> ]*- \[ \] C[0-9]+\.' output.md | grep -ciE 'release|pinned|automatic'
# The conflict between Ready and the open question is named — expect >=1 on T8.
# expect: >=1 on T8
grep -iE 'ready' output.md | grep -ciE 'question'
# An Impact section — expect >=1.
# expect: >=1 on B1
grep -Ec '^[> ]*([-*] +)?(#{2,3} +Impact([^A-Za-z]|$)|\*{1,2}Impact)' output.md
# A Context section — expect >=1 on B1.
# expect: >=1 on B1
grep -Ec '^[> ]*([-*] +)?(#{2,3} +Context([^A-Za-z]|$)|\*{1,2}Context *(\*{1,2}|:|\())' output.md
# Expected names what established it — expect >=1 on B1.
# expect: >=1 on B1
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Expected( Result)?([^A-Za-z]|$)|\*\*Expected( Result)? *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'contract|spec|prior release|decision|invariant|standard|documented'
# Actual Result holds no suspected cause — expect 0.
# expect: ==0 on B1,B5
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Actual( Result)?([^A-Za-z]|$)|\*\*Actual( Result)? *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'caus|because|due to|likely|probabl|suspect|root'
# The field ids are discovered from an expand=names read — expect >=1 on B3.
# expect: >=1 on B3
grep -ciE 'expand=names' output.md
# No customfield id is hard-coded — expect 0 on B3.
# expect: ==0 on B3
grep -cE 'customfield_[0-9]+' output.md
# The write is re-fetched — expect >=1 on B3.
# expect: >=1 on B3
grep -ciE 're-?fetch|read.?back|re-?read' output.md
# All four dedicated fields are named — expect 4 on B3.
# expect: >=4 on B3
grep -oiE 'Environment|Steps to reproduce|Expected Result|Actual Result' output.md | tr 'A-Z' 'a-z' | sort -u | wc -l
# The Bug review does not open on a missing user story or persona — expect 0 on B4.
# expect: ==0 on B4
head -5 output.md | grep -ciE '(missing|lacks?|no|without)[^.]*(user story|persona)|(user story|persona)[^.]*(missing|absent|lacks?)'
# The Bug review covers expected, actual, impact, cause and reproduction — expect >=5 on B4.
# expect: >=5 on B4
grep -oiE 'expected|actual|impact|cause|reproduc' output.md | tr 'A-Z' 'a-z' | sort -u | wc -l
# The Bug is drafted at Low — expect >=1 on B5.
# expect: >=1 on B5
grep -iE 'priority' output.md | grep -ciE '\blow\b'
# A priority is recommended — expect >=1 on B5.
# expect: >=1 on B5
grep -ciE 'recommend' output.md
# The user is asked to confirm the priority — expect >=1 on B5.
# expect: >=1 on B5
grep -ciE 'confirm' output.md
# What was redacted or relocated is stated — expect >=1 on P1.
# expect: >=1 on P1
grep -ciE 'redact|relocat|removed|withheld|left out' output.md
# A restricted comment is not offered as a home for the transcript or log line — expect 0 on P1.
# expect: ==0 on P1
grep -iE 'restricted comment|private (note|comment)' output.md | grep -iE 'transcript|log' | grep -vciE 'not|never|cannot|no |n.t|nor|rather than'
# Wherever a comment is proposed, its visibility is stated — expect 1 on P1.
# expect: ==1 on P1
awk '{l=tolower($0)} l ~ /comment/ {c=1} l ~ /as visible|visible as|unless restricted|is visible/ {v=1} END {print (!c || v) ? 1 : 0}' output.md
# A duration or date is asked for — expect >=1 on S2.
# expect: >=1 on S2
grep -ciE 'duration|end date|how long|by when' output.md
# The prototype is described as evidence — expect >=1 on S3.
# expect: >=1 on S3
grep -ciE 'evidence' output.md
# Adopting the prototype is follow-up work — expect >=1 on S3.
# expect: >=1 on S3
grep -ciE 'adopt' output.md
# Fixing what the spike finds is follow-up work — expect >=1 on S3.
# expect: >=1 on S3
grep -ciE 'fix(es|ing)?[^.]*(find|found|research|closeout)' output.md
# The spike never claims production behaviour — expect 0 on S3.
# expect: ==0 on S3
grep -iE 'production (behaviour|behavior)' output.md | grep -vciE 'not|no |never|n.t|nor|without'
# The verdicts become [ASSUMPTION]s — expect >=1 on S6.
# expect: >=1 on S6
grep -c '\[ASSUMPTION\]' output.md
# The candidate list is called possibly incomplete — expect >=1 on S6.
# expect: >=1 on S6
grep -ciE 'incomplete|not exhaustive|may be missing|may not be complete|others' output.md
# Context holds no gives-and-costs table — expect 0 on S6.
# expect: ==0 on S6
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Context([^A-Za-z]|$)|\*\*Context *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -c '^|'
# The question admits accepting the risk — expect >=1 on S6.
# expect: >=1 on S6
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Question([^A-Za-z]|$)|\*\*Question *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'accept the risk|do nothing|not yet|no change|nothing'
# The question does not name the kind of answer — expect 0 on S6.
# expect: ==0 on S6
awk 'f && (/^[> ]*#{1,3} / || (b && /^[> ]*\*\*[A-Z]/)) {exit} /^[> ]*(#{2,3} +Question([^A-Za-z]|$)|\*\*Question *(\*\*|:|\())/ {f=1; b=!/^[> ]*#/; if (!b) next; sub(/^[> ]*\*\*[^*]*\*\*:?/, "")} f {sub(/^> ?/, ""); print}' output.md | grep -ciE 'which (mechanism|tool|approach|option|check)'
# The Spike review covers question, decision, timebox and deliverables — expect >=4 on S7.
# expect: >=4 on S7
grep -oiE 'question|decision|timebox|deliverable' output.md | tr 'A-Z' 'a-z' | sort -u | wc -l
# The review reports that the draft answers its own question — expect >=1 on S7.
# expect: >=1 on S7
grep -ciE 'already (answers|ranks|decides|judg)|answers (its|the) own|pre-?judg|assumes the answer|presuppos' output.md
# A question that admits doing nothing is proposed — expect >=1 on S7.
# expect: >=1 on S7
grep -ciE 'do nothing|accept the risk|not yet' output.md
```