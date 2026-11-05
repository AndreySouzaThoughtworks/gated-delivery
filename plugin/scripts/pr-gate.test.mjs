import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gate, listUnresolvedThreads } from "./pr-gate.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pr-gate.mjs");
const EXIT_CLEAN = 0;
const EXIT_HITS = 1;
const EXIT_USAGE = 2;
const GOOD_TITLE = "feat(PROJ-1): add the thing";
const FINAL = "y";
const NOT_FINAL = "n";
const PR_NUMBER = 7;
const STUB_ARGUMENTS_LOG = "gh-arguments.txt";
const STUB_REPLY = "gh-reply.json";
const STUB_SCRIPT = `#!/bin/sh
printf '%s\\n' "$@" > "$GH_STUB_DIR/${STUB_ARGUMENTS_LOG}"
cat "$GH_STUB_DIR/${STUB_REPLY}"
`;

const threadsReply = (nodes, hasNextPage = false) => {
  assert(Array.isArray(nodes), `nodes must be a list, got ${typeof nodes}`);
  assert(typeof hasNextPage === "boolean", `hasNextPage must be a boolean, got ${hasNextPage}`);
  return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage }, nodes } } } } });
};
const thread = (isResolved, url = "https://example.test/r/1") => {
  assert(typeof isResolved === "boolean", `isResolved must be a boolean, got ${isResolved}`);
  assert(url.startsWith("https://"), `the url must be absolute, got ${url}`);
  return { isResolved, comments: { nodes: [{ url, path: "src/app.js" }] } };
};

const scratch = (reply = threadsReply([])) => {
  const directory = mkdtempSync(join(tmpdir(), "pr-gate-"));
  const stubs = join(directory, "stubs");
  mkdirSync(stubs);
  writeFileSync(join(stubs, "gh"), STUB_SCRIPT);
  chmodSync(join(stubs, "gh"), 0o755);
  writeFileSync(join(stubs, STUB_REPLY), reply);
  assert(existsSync(join(stubs, "gh")), `the gh stub must exist in ${stubs}`);
  assert(typeof reply === "string", `the canned reply must be text, got ${typeof reply}`);
  return { directory, stubs };
};

const cli = ({ body, title = GOOD_TITLE, finalSlice = NOT_FINAL, extra = [], reply, bodyName = "pr-body-feat-x.md" }) => {
  const { directory, stubs } = scratch(reply);
  const bodyFile = join(directory, bodyName);
  writeFileSync(bodyFile, body);
  assert(existsSync(bodyFile), `the body file ${bodyFile} must exist`);
  assert(typeof title === "string", `the title must be text, got ${typeof title}`);
  const result = spawnSync("node", [SCRIPT, "--body-file", bodyFile, "--title", title, "--final-slice", finalSlice, ...extra], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, GH_STUB_DIR: stubs },
  });
  assert.notEqual(result.status, null, `the command must exit on its own, got signal ${result.signal}`);
  return { ...result, stubs, bodyFile };
};

for (const hit of ["Fixes PROJ-1", "Closes PROJ-1", "resolved #12", "close #3", "Closed acme/app#4", "fix: GH-5", "RESOLVES https://github.com/acme/app/issues/6", "Fixed #9", "resolve #10", "fixes #11", "closes #13"]) {
  test(`rejects "${hit}" on a non-final slice`, () => {
    const result = cli({ body: `Slice notes.\n\n${hit}\n` });
    assert.equal(result.status, EXIT_HITS);
    assert.deepEqual(JSON.parse(result.stdout).closingKeywords, [hit]);
  });

  test(`accepts "${hit}" on the final slice`, () => {
    const result = cli({ body: `${hit}\n`, finalSlice: FINAL });
    assert.equal(result.status, EXIT_CLEAN);
    assert.deepEqual(JSON.parse(result.stdout).closingKeywords, []);
  });
}

test("accepts a body that only contains the word fix", () => {
  const result = cli({ body: "This slice will fix the flaky test and close the gap; resolved the TODO in step 2.\n" });
  assert.equal(result.status, EXIT_CLEAN);
});

test("accepts a word that merely ends in fix", () => {
  assert.equal(cli({ body: "The prefix #12 column is wider.\n" }).status, EXIT_CLEAN);
});

test("rejects a title that is only the ticket id and a description", () => {
  const result = cli({ body: "ok\n", title: "PROJ-1: x" });
  assert.equal(result.status, EXIT_HITS);
  assert.match(JSON.parse(result.stdout).title, /does not match/);
});

for (const title of ["feat: add it", "fix(api)!: drop it", "docs(PROJ-2): explain", "chore: bump", "test: cover", "refactor(core): split"]) {
  test(`accepts the conventional title "${title}"`, () => {
    const result = cli({ body: "ok\n", title });
    assert.equal(result.status, EXIT_CLEAN);
    assert.equal(JSON.parse(result.stdout).title, null);
  });
}

test("rejects a conventional type with no description", () => {
  assert.equal(cli({ body: "ok\n", title: "feat: " }).status, EXIT_HITS);
});

test("uses the client's title convention when one is passed", () => {
  const convention = String.raw`^[A-Z]+-\d+: \S`;
  assert.equal(cli({ body: "ok\n", title: "PROJ-1: x", extra: ["--title-convention", convention] }).status, EXIT_CLEAN);
  assert.equal(cli({ body: "ok\n", title: "feat: x", extra: ["--title-convention", convention] }).status, EXIT_HITS);
});

test("rejects a title convention that matches an empty title", () => {
  const result = cli({ body: "ok\n", extra: ["--title-convention", ".*"] });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /does not match an empty title/);
});

test("rejects any unresolved review thread", () => {
  const result = cli({ body: "ok\n", extra: ["--pr", String(PR_NUMBER)], reply: threadsReply([thread(true), thread(false, "https://example.test/r/2")]) });
  assert.equal(result.status, EXIT_HITS);
  assert.deepEqual(JSON.parse(result.stdout).unresolvedThreads, [{ url: "https://example.test/r/2", path: "src/app.js" }]);
});

test("accepts a pull request whose threads are all resolved", () => {
  const result = cli({ body: "ok\n", extra: ["--pr", String(PR_NUMBER)], reply: threadsReply([thread(true), thread(true)]) });
  assert.equal(result.status, EXIT_CLEAN);
  assert.deepEqual(JSON.parse(result.stdout).unresolvedThreads, []);
});

test("asks gh api graphql for the pull request's review threads", () => {
  const result = cli({ body: "ok\n", extra: ["--pr", String(PR_NUMBER)] });
  const logged = readFileSync(join(result.stubs, STUB_ARGUMENTS_LOG), "utf8").split("\n");
  assert.deepEqual(logged.slice(0, 2), ["api", "graphql"]);
  assert(logged.includes(`number=${PR_NUMBER}`), `the number must be passed, got ${logged}`);
  assert(logged.some((argument) => argument.includes("reviewThreads")), "the query must read reviewThreads");
});

test("never calls gh without --pr", () => {
  const result = cli({ body: "ok\n" });
  assert.throws(() => readFileSync(join(result.stubs, STUB_ARGUMENTS_LOG)), /ENOENT/);
});

test("exits 2 when the reply holds no threads", () => {
  const result = cli({ body: "ok\n", extra: ["--pr", String(PR_NUMBER)], reply: JSON.stringify({ data: { repository: { pullRequest: null } } }) });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /holds no reviewThreads\.nodes/);
});

test("exits 2 when threads span more than one page", () => {
  const result = cli({ body: "ok\n", extra: ["--pr", String(PR_NUMBER)], reply: threadsReply([thread(true)], true) });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /has more than 100 review threads/);
});

test("exits 2 for a pull request number that is not positive", () => {
  assert.equal(cli({ body: "ok\n", extra: ["--pr", "0"] }).status, EXIT_USAGE);
  assert.equal(cli({ body: "ok\n", extra: ["--pr", "abc"] }).status, EXIT_USAGE);
});

test("rejects a body file whose directory swallowed the branch slash", () => {
  const { directory } = scratch();
  const swallowed = join(directory, "pr-body-feat");
  mkdirSync(swallowed);
  const bodyFile = join(swallowed, "x.md");
  writeFileSync(bodyFile, "ok\n");
  const result = spawnSync("node", [SCRIPT, "--body-file", bodyFile, "--title", GOOD_TITLE, "--final-slice", NOT_FINAL], { encoding: "utf8" });
  assert.equal(result.status, EXIT_HITS);
  assert.match(JSON.parse(result.stdout).bodyPath, /every \/ in the branch name replaced by -/);
});

test("rejects a body file that is not named pr-body-<branch>.md", () => {
  assert.equal(cli({ body: "ok\n", bodyName: "body.md" }).status, EXIT_HITS);
  assert.equal(cli({ body: "ok\n", bodyName: "pr-body-feat-x.txt" }).status, EXIT_HITS);
});

test("accepts a body file named pr-body-<branch>.md", () => {
  const result = cli({ body: "ok\n" });
  assert.equal(result.status, EXIT_CLEAN);
  assert.equal(JSON.parse(result.stdout).bodyPath, null);
});

test("prints the four result keys", () => {
  assert.deepEqual(Object.keys(JSON.parse(cli({ body: "ok\n" }).stdout)), ["title", "closingKeywords", "unresolvedThreads", "bodyPath"]);
});

test("exits 2 for a final-slice value other than y or n", () => {
  const result = cli({ body: "ok\n", finalSlice: "maybe" });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /--final-slice must be y or n/);
});

test("exits 2 when a required flag is missing", () => {
  assert.equal(spawnSync("node", [SCRIPT, "--title", GOOD_TITLE], { encoding: "utf8" }).status, EXIT_USAGE);
});

test("exits 2 for a body file that does not exist", () => {
  const { directory } = scratch();
  const result = spawnSync("node", [SCRIPT, "--body-file", join(directory, "pr-body-absent.md"), "--title", GOOD_TITLE, "--final-slice", NOT_FINAL], { encoding: "utf8" });
  assert.equal(result.status, EXIT_USAGE);
});

test("gate rejects a final-slice value it does not know", () => {
  assert.throws(() => gate({ body: "", bodyPath: "/tmp/pr-body-a.md", title: GOOD_TITLE, finalSlice: "x", titleConvention: "^feat", threads: [] }), /--final-slice must be y or n/);
});

test("listUnresolvedThreads rejects a pull request number it cannot use", () => {
  assert.throws(() => listUnresolvedThreads(-1), /positive integer/);
});
