import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintDraft, parseDraft } from "./ticket-lint.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "ticket-lint.mjs");
const EXIT_CLEAN = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const OVER_LIMIT_WORDS = 31;
const WORD = "word";

const STORY = `# Apply a bundle

## User Story

As a **store owner**
I want to apply a bundle
So that its price rules exist

## Background

Bundles carry price rules. Applying one now creates them.

## Scope

**In:**

* Applying a bundle creates the price rules its components reference.

## Acceptance Criteria

### Applying a bundle — the apply succeeds

| # | **Given** | **When** | **Then** |
| --- | --- | --- | --- |
| 1 | a bundle with one rule | it is applied | the rule exists |

## Definition of Ready

- [ ] Business value clear
- [ ] Testable

## Definition of Done

- [x] Every AC passes
`;

const TASK = `# Retire the v1 client

## Description

The v1 client goes away at quarter end.

## Completion Criteria

- [ ] C1. No import of the v1 client remains.
`;

const BUG = `# Duplicate promotion

Priority: Medium

## Impact summary

Store owners see duplicates.

## Expected Result

The second apply reuses the first promotion.

## Actual Result

The second apply creates a new promotion.

## Steps to Reproduce

1. Apply a bundle.
2. Apply it again.

## Environment

Staging, version 4.2.
`;

const SPIKE = `# Spike: write rate

## Question

Does the service hold at launch volume?

## Why it matters

Decides whether batching is needed.

## Timebox

**Duration or end date:** 3 days

## Deliverables

- Latency at three percentiles.
`;

const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), "ticket-lint-"));
  assert(existsSync(directory), `${directory} must exist`);
  assert(directory.startsWith(tmpdir()), `${directory} must sit under the temp directory`);
  return directory;
};

const cli = (kind, text, extra = []) => {
  const file = join(scratch(), "draft.md");
  writeFileSync(file, text);
  assert(existsSync(file), `${file} must exist`);
  assert(Array.isArray(extra), `extra flags must be a list, got ${typeof extra}`);
  const result = spawnSync("node", [SCRIPT, file, "--kind", kind, ...extra], { encoding: "utf8" });
  assert.notEqual(result.status, null, `the command must exit on its own, got signal ${result.signal}`);
  return result;
};

const replaceOnce = (text, from, to) => {
  assert(text.includes(from), `fixture lacks ${JSON.stringify(from)}`);
  const replaced = text.replace(from, to);
  assert(replaced !== text, `replacing ${JSON.stringify(from)} with ${JSON.stringify(to)} must change the fixture`);
  return replaced;
};

for (const [kind, draft] of [["story", STORY], ["task", TASK], ["bug", BUG], ["spike", SPIKE]]) {
  test(`accepts a clean ${kind} draft with no output`, () => {
    const result = cli(kind, draft);
    assert.equal(result.status, EXIT_CLEAN);
    assert.equal(result.stdout, "");
  });
}

test("accepts the Definition of Ready with every box unticked", () => {
  assert.deepEqual(lintDraft(STORY, "story"), []);
});

test("rejects a ticked Definition of Ready box at its own line", () => {
  const result = cli("story", replaceOnce(STORY, "- [ ] Testable", "- [x] Testable"));
  assert.equal(result.status, EXIT_PROBLEMS);
  assert.match(result.stdout, /^30: definition-of-ready-ticked: /);
});

test("rejects an upper-case ticked box too", () => {
  assert.equal(cli("story", replaceOnce(STORY, "- [ ] Testable", "- [X] Testable")).status, EXIT_PROBLEMS);
});

test("does not read a ticked Definition of Done box as a Definition of Ready problem", () => {
  assert.deepEqual(lintDraft(STORY, "story").map((problem) => problem.rule), []);
});

test("rejects a spike timebox that says Timeboxed with no value", () => {
  const result = cli("spike", replaceOnce(SPIKE, "**Duration or end date:** 3 days", "**Duration or end date:** Timeboxed"));
  assert.equal(result.status, EXIT_PROBLEMS);
  assert.match(result.stdout, /^11: spike-timebox: .*"Timeboxed"/);
});

test("rejects a spike timebox whose label has no value", () => {
  assert.equal(cli("spike", replaceOnce(SPIKE, "**Duration or end date:** 3 days", "**Duration or end date:**")).status, EXIT_PROBLEMS);
});

for (const value of ["4 days", "two weeks", "1.5 hours", "2026-12-01", "Dec 4", "15 March"]) {
  test(`accepts the spike timebox ${value}`, () => {
    assert.equal(cli("spike", replaceOnce(SPIKE, "3 days", value)).status, EXIT_CLEAN);
  });
}

test("ignores the italic guidance line under the spike timebox", () => {
  const guided = replaceOnce(SPIKE, "**Duration or end date:** 3 days", "**Duration or end date:**\n\n*Use an explicit duration of 3 days or a date.*");
  assert.equal(cli("spike", guided).status, EXIT_PROBLEMS);
});

test("rejects a Ready status with an open [QUESTION] at the tag line", () => {
  const result = cli("task", `Status: Ready\n\n${TASK}\n## Open Questions / Dependencies\n\n* [QUESTION] Which region first?\n`);
  assert.equal(result.status, EXIT_PROBLEMS);
  assert.match(result.stdout, /^\d+: ready-with-open-item: .*\[QUESTION\]/);
});

test("rejects a Ready status with an open [DEPENDENCY]", () => {
  const result = cli("task", `**Status:** Ready for sprint\n\n${TASK}\n* [DEPENDENCY] Platform flag.\n`);
  assert.equal(result.status, EXIT_PROBLEMS);
  assert.match(result.stdout, /\[DEPENDENCY\]/);
});

test("accepts an open [QUESTION] while the status is not Ready", () => {
  assert.equal(cli("task", `Status: Draft\n\n${TASK}\n* [QUESTION] Which region first?\n`).status, EXIT_CLEAN);
});

test("accepts a Ready status with no open item", () => {
  assert.equal(cli("task", `Status: Ready\n\n${TASK}`).status, EXIT_CLEAN);
});

test("accepts a Ready status that only quotes the tag in code", () => {
  assert.equal(cli("task", `Status: Ready\n\n${TASK}\nTag open items with \`[QUESTION]\`.\n`).status, EXIT_CLEAN);
});

test("rejects a Bug drafted at priority Low", () => {
  const result = cli("bug", replaceOnce(BUG, "Priority: Medium", "Priority: Low"));
  assert.equal(result.status, EXIT_PROBLEMS);
  assert.match(result.stdout, /^3: bug-priority: /);
});

test("accepts a Bug at Low once the user confirmed the priority", () => {
  assert.equal(cli("bug", replaceOnce(BUG, "Priority: Medium", "**Priority:** Low"), ["--priority-confirmed"]).status, EXIT_CLEAN);
});

test("accepts a Bug at a priority above Low", () => {
  assert.equal(cli("bug", replaceOnce(BUG, "Priority: Medium", "Priority: High")).status, EXIT_CLEAN);
});

test("does not apply the priority rule to a Task", () => {
  assert.equal(cli("task", `Priority: Low\n\n${TASK}`).status, EXIT_CLEAN);
});

for (const [name, text] of [
  ["a template guidance line", `*Guidance in italics. Delete guidance as the task is filled.*\n\n${TASK}`],
  ["a template placeholder", replaceOnce(STORY, "As a **store owner**", "As a **\\<role\\>**")],
  ["an empty bullet", `${TASK}\n-\n`],
  ["an empty numbered step", replaceOnce(BUG, "2. Apply it again.", "2.")],
  ["an empty completion criterion", replaceOnce(TASK, "- [ ] C1. No import of the v1 client remains.", "- [ ] C1.")],
  ["an empty table row", replaceOnce(STORY, "| 1 | a bundle with one rule | it is applied | the rule exists |", "| 1 |  |  |  |")],
]) {
  test(`rejects ${name}`, () => {
    const kind = text.includes("Steps to Reproduce") ? "bug" : text.includes("User Story") ? "story" : "task";
    const result = cli(kind, text);
    assert.equal(result.status, EXIT_PROBLEMS);
    assert.match(result.stdout, /^\d+: placeholder: /m);
  });
}

test("ignores a placeholder inside a code fence", () => {
  assert.equal(cli("task", `${TASK}\n\`\`\`\n\\<role\\>\n-\n\`\`\`\n`).status, EXIT_CLEAN);
});

for (const [kind, draft, heading] of [
  ["story", STORY, "## Scope"],
  ["task", TASK, "## Completion Criteria"],
  ["bug", BUG, "## Environment"],
  ["spike", SPIKE, "## Deliverables"],
]) {
  test(`rejects a ${kind} that lacks ${heading}`, () => {
    const result = cli(kind, replaceOnce(draft, heading, "## Something else"));
    assert.equal(result.status, EXIT_PROBLEMS);
    assert.match(result.stdout, new RegExp(`required-heading: .*${heading}`));
  });
}

const longBullet = `* ${Array(OVER_LIMIT_WORDS).fill(WORD).join(" ")}`;

test("warns on a long bullet and still exits clean", () => {
  const result = cli("story", replaceOnce(STORY, "* Applying a bundle creates the price rules its components reference.", longBullet));
  assert.equal(result.status, EXIT_CLEAN);
  assert.match(result.stdout, /^warning: \d+: bullet-length: 31 words/);
});

test("counts the wrapped lines of a bullet", () => {
  const wrapped = `* ${Array(OVER_LIMIT_WORDS - 1).fill(WORD).join(" ")}\n  ${WORD} ${WORD}`;
  assert.match(cli("story", replaceOnce(STORY, "* Applying a bundle creates the price rules its components reference.", wrapped)).stdout, /bullet-length: 32 words/);
});

test("exempts a bullet that states a question or dependency", () => {
  const tagged = longBullet.replace(WORD, "[QUESTION]");
  assert.equal(cli("story", replaceOnce(STORY, "* Applying a bundle creates the price rules its components reference.", tagged)).stdout, "");
});

test("exempts Definition of Ready and Done rows and bullets in a short story", () => {
  const long = `- [ ] ${Array(OVER_LIMIT_WORDS).fill(WORD).join(" ")}`;
  assert.equal(cli("story", replaceOnce(STORY, "- [ ] Testable", long)).stdout, "");
});

test("does not warn on a bullet at the limit", () => {
  const atLimit = `* ${Array(OVER_LIMIT_WORDS - 1).fill(WORD).join(" ")}`;
  assert.equal(cli("story", replaceOnce(STORY, "* Applying a bundle creates the price rules its components reference.", atLimit)).stdout, "");
});

test("does not apply the bullet limit to a Task", () => {
  assert.equal(cli("task", `${TASK}\n${longBullet}\n`).stdout, "");
});

const withCriteria = (count) => {
  assert(Number.isInteger(count) && count > 0, `the criteria count must be a positive integer, got ${count}`);
  const rows = Array.from({ length: count }, (_, i) => `| ${i + 1} | given | when | then |`);
  assert.equal(rows.length, count);
  assert(rows.every((row) => row.startsWith("| ")), `every row must be a table row, got ${rows[0]}`);
  return replaceOnce(STORY, "| 1 | a bundle with one rule | it is applied | the rule exists |", rows.join("\n"));
};

test("warns past fifteen acceptance criteria", () => {
  const result = cli("story", withCriteria(16));
  assert.equal(result.status, EXIT_CLEAN);
  assert.match(result.stdout, /^warning: \d+: acceptance-criteria-count: 16 acceptance criteria; look for merges/);
});

test("stays quiet at fifteen acceptance criteria", () => {
  assert.equal(cli("story", withCriteria(15)).stdout, "");
});

test("warns that forty-one acceptance criteria are a test plan or two stories", () => {
  const result = cli("story", withCriteria(41));
  assert.equal(result.status, EXIT_CLEAN);
  assert.match(result.stdout, /41 acceptance criteria is a test plan or two stories/);
});

test("stays at the merge advice at forty acceptance criteria", () => {
  assert.match(cli("story", withCriteria(40)).stdout, /look for merges/);
});

test("prints problems in line order, one per line", () => {
  const text = replaceOnce(replaceOnce(SPIKE, "3 days", "Timeboxed"), "## Deliverables", "## Other");
  const lines = cli("spike", text).stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^1: required-heading/);
  assert.match(lines[1], /^11: spike-timebox/);
});

test("exits 2 for an unknown kind", () => {
  const result = cli("epic", TASK);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /the kind must be one of/);
});

test("exits 2 without a kind", () => {
  const file = join(scratch(), "draft.md");
  writeFileSync(file, TASK);
  assert.equal(spawnSync("node", [SCRIPT, file], { encoding: "utf8" }).status, EXIT_USAGE);
});

test("exits 2 for a missing file", () => {
  assert.equal(spawnSync("node", [SCRIPT, join(scratch(), "absent.md"), "--kind", "task"], { encoding: "utf8" }).status, EXIT_USAGE);
});

test("exits 2 without a file", () => {
  assert.equal(spawnSync("node", [SCRIPT, "--kind", "task"], { encoding: "utf8" }).status, EXIT_USAGE);
});

test("parseDraft rejects non-text", () => {
  assert.throws(() => parseDraft(42), /must be text/);
});

test("parseDraft rejects a code fence that never closes", () => {
  assert.throws(() => parseDraft(`${TASK}\n\`\`\`\nunclosed\n`), /never closed/);
});

test("exits 2 for a draft with an unclosed code fence", () => {
  assert.equal(cli("task", `${TASK}\n\`\`\`\n`).status, EXIT_USAGE);
});

test("lintDraft rejects a priorityConfirmed that is not a boolean", () => {
  assert.throws(() => lintDraft(BUG, "bug", { priorityConfirmed: "yes" }), /must be a boolean/);
});

test("lintDraft rejects a kind it does not know", () => {
  assert.throws(() => lintDraft(TASK, "toString"), /the kind must be one of/);
});
