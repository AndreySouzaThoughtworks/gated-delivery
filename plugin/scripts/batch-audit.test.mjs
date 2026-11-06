import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addedLines, auditRange, commitViolations } from "./batch-audit.mjs";
import { assertActionable, assertErrorIsActionable, assertErrorMatchesActionable } from "./run-cli.test.support.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "batch-audit.mjs");
const EXIT_CLEAN = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;
const TICKET = "PROJ-1";
const RANGE = "base..HEAD";
const FULL_SHA = /^[0-9a-f]{40}$/;
const CLEAN_SUBJECT = `feat(${TICKET}): mask card numbers`;
const CLEAN_TEST = "it('masks all but the last four digits', () => {});\n";
const GIT_IDENTITY = ["-c", "user.name=audit", "-c", "user.email=audit@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

const git = (repo, args) => {
  assert(isAbsolute(repo), `git needs an absolute repository path, got ${JSON.stringify(repo)}`);
  assert(Array.isArray(args), `git needs its arguments as a list, got ${typeof args}`);
  return execFileSync("git", [...GIT_IDENTITY, "-C", repo, ...args], { encoding: "utf8" }).trim();
};

const newRepo = () => { // zanity: ignore[assertion-density] -- single-invariant: a fixture builder whose git calls throw on failure, so the base tag is its one checkable postcondition
  const repo = mkdtempSync(join(tmpdir(), "batch-audit-"));
  git(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "README.md"), "start\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: start"]);
  git(repo, ["tag", "base"]);
  const baseCommit = git(repo, ["rev-parse", "base"]);
  assert.match(baseCommit, FULL_SHA, `the base tag must name a commit, got ${baseCommit}`);
  return repo;
};

const commit = (repo, { subject = CLEAN_SUBJECT, body, file = "card.test.ts", content = CLEAN_TEST }) => { // zanity: ignore[assertion-density] -- single-invariant: a fixture builder whose git calls throw on failure, so the recorded subject is its one checkable postcondition
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content, { flag: "a" });
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", subject, ...(body ? ["-m", body] : [])]);
  const recorded = git(repo, ["log", "-1", "--format=%s"]);
  assert.equal(recorded, subject, `the commit must record its subject, got ${recorded}`);
};

const audit = (repo, options = {}) => {
  assert(typeof options === "object", `options must be an object, got ${typeof options}`);
  const result = auditRange(RANGE, { ticket: TICKET, acs: 1, complete: false, repo, ...options });
  assert(Array.isArray(result.violations), `the audit must list its violations, got ${JSON.stringify(result)}`);
  return result;
};

const rulesOf = (result) => {
  assert(Array.isArray(result.violations), `a result needs a violations list, got ${JSON.stringify(result)}`);
  for (const { rule } of result.violations) assertActionable(rule);
  const rules = result.violations.map(({ rule }) => rule.split(":")[0]);
  assert(rules.every((rule) => rule !== ""), `every violation must name a rule, got ${JSON.stringify(rules)}`);
  return rules;
};

test("accepts a clean batch", () => {
  const repo = newRepo();
  commit(repo, {});
  assert.deepEqual(audit(repo), { commits: 1, violations: [] });
});

test("accepts AC power as plain text in subject, body, title and comment", () => {
  const repo = newRepo();
  commit(repo, {
    subject: "fix(PROJ-1): keep the AC power indicator on",
    body: "The AC power icon stays lit.",
    content: "// the AC power adapter reports its state\nit('shows the AC power indicator', () => {});\n",
  });
  assert.deepEqual(audit(repo).violations, []);
});

test("rejects an AC number in a subject", () => {
  const repo = newRepo();
  commit(repo, { subject: "feat(PROJ-1): AC2 masks" });
  assert.deepEqual(rulesOf(audit(repo)), ["ac-number-in-commit-text"]);
});

test("rejects a bracketed AC number in a body", () => {
  const repo = newRepo();
  commit(repo, { body: "Covers AC[3] of the spec." });
  assert.deepEqual(rulesOf(audit(repo)), ["ac-number-in-commit-text"]);
});

test("rejects a non-conventional subject", () => {
  const repo = newRepo();
  commit(repo, { subject: "masks card numbers" });
  assert.deepEqual(rulesOf(audit(repo)), ["subject-not-conventional"]);
});

test("rejects an AC number in an added test title", () => {
  const repo = newRepo();
  commit(repo, { content: "it('AC3 masks all but the last four digits', () => {});\n" });
  assert.deepEqual(rulesOf(audit(repo)), ["reference-in-test-title"]);
});

test("rejects an AC number in a describe title and a test title of a Python test", () => {
  const repo = newRepo();
  commit(repo, { file: "a.test.js", content: 'describe("AC4 card masking", () => {});\n' });
  commit(repo, { file: "test_card.py", content: "def test_AC5_masks_digits():\n    pass\n" });
  assert.deepEqual(rulesOf(audit(repo, { acs: 2 })), ["reference-in-test-title", "reference-in-test-title"]);
});

test("rejects a ticket id and a spec slug in an added test title but allows the ticket id in the subject", () => {
  const repo = newRepo();
  commit(repo, { content: "it('PROJ-1 masks digits', () => {});\n" });
  commit(repo, { file: "b.test.ts", content: "test('masks per card-masking-spec', () => {});\n" });
  const result = audit(repo, { acs: 2, slug: "card-masking-spec" });
  assert.deepEqual(rulesOf(result), ["reference-in-test-title", "reference-in-test-title"]);
});

test("rejects a spec slug in a commit body", () => {
  const repo = newRepo();
  commit(repo, { body: "Implements card-masking-spec." });
  assert.deepEqual(rulesOf(audit(repo, { slug: "card-masking-spec" })), ["spec-slug-in-commit-text"]);
});

test("rejects a comment line citing an AC in JavaScript and Python", () => {
  const repo = newRepo();
  commit(repo, { file: "mask.ts", content: "// satisfies AC2\nexport const mask = 1;\n" });
  commit(repo, { file: "mask.py", content: "# satisfies AC[2]\nMASK = 1\n" });
  assert.deepEqual(rulesOf(audit(repo, { acs: 2 })), ["reference-in-comment", "reference-in-comment"]);
});

test("rejects a block comment line citing an AC", () => {
  const repo = newRepo();
  commit(repo, { file: "mask.ts", content: "/**\n * covers AC7\n */\nexport const mask = 1;\n" });
  assert.deepEqual(rulesOf(audit(repo)), ["reference-in-comment"]);
});

test("ignores AC tokens in prose files and in code that is not a comment or title", () => {
  const repo = newRepo();
  commit(repo, { file: "notes.md", content: "* AC2 is covered\n# AC3\n" });
  commit(repo, { file: "mask.ts", content: "export const label = 'AC2';\n" });
  assert.deepEqual(audit(repo, { acs: 2 }).violations, []);
});

test("ignores AC tokens on lines the commit removed", () => {
  const repo = newRepo();
  commit(repo, { file: "mask.ts", content: "// satisfies AC2\n" });
  const earlier = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "mask.ts"), "export const mask = 1;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", CLEAN_SUBJECT]);
  const result = auditRange(`${earlier}..HEAD`, { ticket: TICKET, acs: 1, complete: true, repo });
  assert.deepEqual(result, { commits: 1, violations: [] });
});

test("rejects fewer commits than ACs on a complete batch only", () => {
  const repo = newRepo();
  commit(repo, {});
  const complete = audit(repo, { acs: 2, complete: true });
  assert.deepEqual(rulesOf(complete), ["fewer-commits-than-acs"]);
  assert.deepEqual(audit(repo, { acs: 2, complete: false }).violations, []);
});

test("accepts more commits than ACs on a complete batch", () => {
  const repo = newRepo();
  commit(repo, {});
  commit(repo, { file: "second.test.ts" });
  assert.deepEqual(audit(repo, { acs: 1, complete: true }).violations, []);
});

test("skips merge commits", () => {
  const repo = newRepo();
  git(repo, ["checkout", "-q", "-b", "side"]);
  commit(repo, { file: "side.test.ts" });
  git(repo, ["checkout", "-q", "main"]);
  commit(repo, { file: "main.test.ts" });
  git(repo, ["merge", "-q", "--no-ff", "-m", "Merge branch side", "side"]);
  assert.equal(audit(repo).commits, 2);
});

test("addedLines keeps added lines of the new file only and rejects non-text", () => {
  const diff = "--- a/old.ts\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+first\n+++second\n-gone\n+++ /dev/null\n+orphan\n";
  assert.deepEqual(addedLines(diff), [{ file: "new.ts", text: "first" }, { file: "new.ts", text: "++second" }]);
  assertErrorMatchesActionable(() => addedLines(undefined), /.diff. must be text/);
});

test("commitViolations rejects a malformed commit", () => {
  const forbidden = { ticket: TICKET };
  assertErrorMatchesActionable(() => commitViolations({ subject: 1, body: "", added: [] }, forbidden), /subject` and `body` must be text/);
  assertErrorMatchesActionable(() => commitViolations({ subject: CLEAN_SUBJECT, body: "", added: "" }, forbidden), /added` lines must be a list/);
  assertErrorIsActionable(() => commitViolations({ subject: 1, body: "", added: [] }, forbidden));
  assertErrorIsActionable(() => commitViolations({ subject: CLEAN_SUBJECT, body: "", added: "" }, forbidden));
});

test("auditRange rejects a range without dots and a non-positive AC count", () => {
  const repo = newRepo();
  assertErrorMatchesActionable(() => auditRange("base", { ticket: TICKET, acs: 1, complete: false, repo }), /<batch-base>\.\.HEAD/);
  assertErrorMatchesActionable(() => audit(repo, { acs: 0 }), /positive integer/);
  assertErrorMatchesActionable(() => audit(repo, { acs: 1.5 }), /positive integer/);
  assertErrorIsActionable(() => auditRange("base", { ticket: TICKET, acs: 1, complete: false, repo }));
  assertErrorIsActionable(() => audit(repo, { acs: 0 }));
});

const run = (repo, args) => {
  assert(Array.isArray(args), `args must be a list, got ${typeof args}`);
  const result = spawnSync("node", [SCRIPT, ...args, "--repo", repo], { encoding: "utf8" });
  assert(result.status !== null, `the command must exit on its own, got signal ${result.signal}`);
  return result;
};

test("exits 0 and prints JSON for a clean batch", () => {
  const repo = newRepo();
  commit(repo, {});
  const result = run(repo, [RANGE, "--ticket", TICKET, "--acs", "1", "--complete"]);
  assert.equal(result.status, EXIT_CLEAN);
  assert.deepEqual(JSON.parse(result.stdout), { commits: 1, violations: [] });
});

test("exits 1 and lists the violating commit", () => {
  const repo = newRepo();
  commit(repo, { subject: "feat(PROJ-1): AC2 masks" });
  const result = run(repo, [RANGE, "--ticket", TICKET, "--acs", "1"]);
  assert.equal(result.status, EXIT_VIOLATIONS);
  const [violation] = JSON.parse(result.stdout).violations;
  assert.equal(violation.commit, git(repo, ["rev-parse", "HEAD"]));
  assert.match(violation.rule, /^ac-number-in-commit-text: AC2/);
});

test("exits 2 on missing arguments, a bad AC count and a bad range", () => {
  const repo = newRepo();
  assert.equal(run(repo, [RANGE, "--ticket", TICKET]).status, EXIT_USAGE);
  assert.equal(run(repo, [RANGE, "--acs", "1"]).status, EXIT_USAGE);
  assert.equal(run(repo, [RANGE, "--ticket", TICKET, "--acs", "0"]).status, EXIT_USAGE);
  assert.equal(run(repo, ["--ticket", TICKET, "--acs", "1"]).status, EXIT_USAGE);
  assert.equal(run(repo, ["nope..HEAD", "--ticket", TICKET, "--acs", "1"]).status, EXIT_USAGE);
  for (const args of [[RANGE, "--ticket", TICKET], [RANGE, "--acs", "1"], [RANGE, "--ticket", TICKET, "--acs", "0"], ["--ticket", TICKET, "--acs", "1"], [RANGE, RANGE, "--ticket", TICKET, "--acs", "1"]]) {
    const [failure] = run(repo, args).stderr.split("\n");
    assertActionable(failure.replace(/^batch-audit: /, ""));
  }
});
