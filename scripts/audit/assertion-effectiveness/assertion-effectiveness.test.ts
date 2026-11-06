import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../test-support/temp-dir.mjs";
import { assertActionable } from "../../test-support/actionable.test.support.ts";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "assertion-effectiveness.ts");
const BASELINE = "assertion-effectiveness-baseline.json";
const EXIT_NEW_UNPROVEN = 1;
const EXIT_STALE_BASELINE = 1;
const EXIT_TESTS_FAILED = 2;
const TEST_COMMAND = "node --test scripts/subject.test.mjs";

const SUBJECT = `import assert from "node:assert";
export const shout = (text) => {
  assert(typeof text === "string", "text must be a string");
  return text.toUpperCase();
};
`;
const STRINGS_ONLY_TEST = `import { test } from "node:test";
import assert from "node:assert";
import { shout } from "./subject.mjs";
test("shouts", () => assert.equal(shout("a"), "A"));
`;
const NUMBER_TOO_TEST = `${STRINGS_ONLY_TEST}test("rejects a number", () => assert.throws(() => shout(7), /text must be a string/));
`;

const fixtureRepo = (files: Record<string, string>) => {
  assert(Object.keys(files).length > 0, `a fixture repo needs files, got ${Object.keys(files).length}`);
  assert(Object.keys(files).every((path) => !path.startsWith("/")), `fixture paths are repo-relative, got ${Object.keys(files).find((path) => path.startsWith("/"))}`);
  const dir = tempDir("assertion-effectiveness", "fixture");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
};

const ASSERTION_ERROR_PREFIX = "AssertionError [ERR_ASSERTION]: ";
const failureLine = (out: string, marker: RegExp) => {
  assert(out.length > 0, `the tool output must not be empty, got ${JSON.stringify(out)}`);
  const line = out.split("\n").map((candidate) => candidate.replace(ASSERTION_ERROR_PREFIX, "").replace(/^\s+/, "")).find((candidate) => marker.test(candidate));
  assert(line !== undefined, `the output must hold a line matching ${marker}, got: ${out}`);
  return line;
};

const runTool = (dir: string, args: string[] = []) => {
  assert(dir.length > 0, `the tool runs on a repo directory, got "${dir}"`);
  assert(args.every((arg) => typeof arg === "string"), `arguments must be strings, got ${JSON.stringify(args)}`);
  const result = spawnSync("node", [TOOL, "--repo", dir, "--test-command", TEST_COMMAND, ...args], { encoding: "utf8" });
  assert(result.status !== null, `the tool must exit on its own, got signal ${result.signal}`);
  return { code: result.status, out: result.stdout + result.stderr };
};

test("an assertion that no test ever makes false is reported unproven, with its condition", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": STRINGS_ONLY_TEST });
  const { code, out } = runTool(dir);
  assert(code === EXIT_NEW_UNPROVEN, `expected exit ${EXIT_NEW_UNPROVEN} for an unproven site missing from the baseline, got ${code}: ${out}`);
  assert(out.includes('(b) never false shout:3  typeof text === "string"'), `expected the site listed as (b) with its condition, got: ${out}`);
  assert(out.includes("(a) proven 0, (b) unproven 1, (c) unevaluated 0"), `expected the counts in the summary, got: ${out}`);
});

test("the same assertion is proven once a test passes a number, and needs no baseline entry", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": NUMBER_TOO_TEST });
  const { code, out } = runTool(dir);
  assert(code === 0, `expected exit 0 for a proven site, got ${code}: ${out}`);
  assert(out.includes("(a) proven 1, (b) unproven 0, (c) unevaluated 0"), `expected the site proven, got: ${out}`);
});

test("an assertion that no test reaches is reported never evaluated", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": 'import { test } from "node:test";\ntest("unrelated", () => {});\n' });
  const { code, out } = runTool(dir);
  assert(code === EXIT_NEW_UNPROVEN, `expected exit ${EXIT_NEW_UNPROVEN}, got ${code}: ${out}`);
  assert(out.includes('(c) never evaluated shout:3  typeof text === "string"'), `expected the site listed as (c), got: ${out}`);
});

test("a baseline entry for a site that is now proven fails the run naming the entry and the prune command, and --update-baseline prunes it", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": STRINGS_ONLY_TEST });
  assert(runTool(dir, ["--update-baseline"]).code === 0, "writing the baseline must succeed");
  assert(runTool(dir).code === 0, "a site listed in the baseline must pass");
  writeFileSync(join(dir, "scripts/subject.test.mjs"), NUMBER_TOO_TEST);
  const stale = runTool(dir);
  assert(stale.code === EXIT_STALE_BASELINE, `expected exit ${EXIT_STALE_BASELINE} for a stale entry, got ${stale.code}: ${stale.out}`);
  assert(stale.out.includes("1 baseline entries are stale") && stale.out.includes("shout"), `expected the stale entry named, got: ${stale.out}`);
  assert(stale.out.includes("--update-baseline"), `expected the prune command in the message, got: ${stale.out}`);
  assertActionable(failureLine(stale.out, /baseline entries are stale/));
  assert(runTool(dir, ["--update-baseline"]).code === 0, "pruning must succeed");
  assert(JSON.parse(readFileSync(join(dir, BASELINE), "utf8")).findings.length === 0, "the pruned baseline must hold no entry");
  assert(runTool(dir).code === 0, "the run must pass once the stale entry is pruned");
});

test("a baseline entry for a site that is gone fails the run as stale", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": STRINGS_ONLY_TEST });
  runTool(dir, ["--update-baseline"]);
  writeFileSync(join(dir, "scripts/subject.mjs"), 'import assert from "node:assert";\nexport const shout = (text) => text.toUpperCase();\nexport const unrelated = (n) => {\n  assert(n > 0, "n must be positive");\n  return n;\n};\n');
  writeFileSync(join(dir, "scripts/subject.test.mjs"), `${STRINGS_ONLY_TEST}import { unrelated } from "./subject.mjs";\ntest("rejects zero", () => assert.throws(() => unrelated(0), /positive/));\n`);
  const { code, out } = runTool(dir);
  assert(code === EXIT_STALE_BASELINE && out.includes("1 baseline entries are stale"), `expected a stale failure, got ${code}: ${out}`);
});

test("a new unproven site fails and is the only one listed as unproven", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": STRINGS_ONLY_TEST });
  runTool(dir, ["--update-baseline"]);
  writeFileSync(join(dir, "scripts/subject.mjs"), `${SUBJECT}export const whisper = (text) => {\n  assert(text.length < 99, "text is too long");\n  return text.toLowerCase();\n};\n`);
  writeFileSync(join(dir, "scripts/subject.test.mjs"), `${STRINGS_ONLY_TEST}import { whisper } from "./subject.mjs";\ntest("whispers", () => assert.equal(whisper("A"), "a"));\n`);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  const grown = runTool(dir);
  assert(grown.code === EXIT_NEW_UNPROVEN, `expected exit ${EXIT_NEW_UNPROVEN} for a new unproven site, got ${grown.code}: ${grown.out}`);
  const [, newlyListed = ""] = grown.out.split("are not proven by any test");
  assert(newlyListed.includes("whisper") && !newlyListed.includes("shout"), `expected only the new site named after the failure message, got: ${grown.out}`);
  assertActionable(failureLine(grown.out, /assertions are not proven by any test/));
});

test("a baseline entry survives a line shift because the key holds the function and a condition hash", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": STRINGS_ONLY_TEST });
  runTool(dir, ["--update-baseline"]);
  writeFileSync(join(dir, "scripts/subject.mjs"), `\n\n${SUBJECT}`);
  const { code, out } = runTool(dir);
  assert(code === 0, `expected the shifted site to match its baseline entry, got ${code}: ${out}`);
  assert(JSON.parse(readFileSync(join(dir, BASELINE), "utf8")).findings[0].message.startsWith("shout | "), "the baseline message must start with the function name");
});

test("a failing test in the copy exits 2 with the failing command, not a verdict", () => {
  const failing = 'import { test } from "node:test";\nimport assert from "node:assert";\ntest("fails", () => assert.equal(1, 2));\n';
  const dir = fixtureRepo({ "scripts/subject.mjs": SUBJECT, "scripts/subject.test.mjs": failing });
  const { code, out } = runTool(dir);
  assert(code === EXIT_TESTS_FAILED, `expected exit ${EXIT_TESTS_FAILED}, got ${code}: ${out}`);
  assert(out.includes(`the tests must pass in the instrumented copy, but command "${TEST_COMMAND}" failed`), `expected the failing command named, got: ${out}`);
  assertActionable(failureLine(out, /^the tests must pass in the instrumented copy/));
});

test("assert.ok and a typescript file are measured, a shebang file still runs, assert(false) and assert.equal are skipped", () => {
  const files = {
    "scripts/cli.mjs": '#!/usr/bin/env node\nimport assert from "node:assert/strict";\nexport const positive = (n) => {\n  assert.ok(n > 0, "n must be positive");\n  if (n < 0) assert(false, \"negative\");\n  assert.equal(n, n);\n  return n;\n};\n',
    "scripts/typed.ts": 'import assert from "node:assert";\nexport const typed = (text: string) => {\n  assert(text.length > 0, "text must not be empty");\n  return text;\n};\n',
    "scripts/subject.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { positive } from "./cli.mjs";\nimport { typed } from "./typed.ts";\ntest("calls", () => {\n  positive(1);\n  assert.throws(() => typed(""), /must not be empty/);\n});\n',
  };
  const { out } = runTool(fixtureRepo(files));
  assert(out.includes("sites 2: (a) proven 1, (b) unproven 1, (c) unevaluated 0"), `expected 2 sites with one proven, got: ${out}`);
  assert(out.includes("positive:4  n > 0"), `expected assert.ok on line 4 listed, got: ${out}`);
});

test("a repo with no assert call has nothing to measure and says so", () => {
  const dir = fixtureRepo({ "scripts/subject.mjs": "export const one = () => 1;\n", "scripts/subject.test.mjs": 'import { test } from "node:test";\ntest("one", () => {});\n' });
  const { code, out } = runTool(dir);
  assert(code !== 0 && out.includes("no assert call found"), `expected a refusal naming the empty scan, got ${code}: ${out}`);
  assertActionable(failureLine(out, /^no assert call found/));
});

test("a directory that is not a git checkout, an empty checkout and a checkout with no source file are refused with the reason", () => {
  const plain = tempDir("assertion-effectiveness", "plain");
  assert.match(runTool(plain).out, /has no \.git/);
  assertActionable(failureLine(runTool(plain).out, /has no \.git/));
  const empty = tempDir("assertion-effectiveness", "empty");
  execFileSync("git", ["init", "-q"], { cwd: empty });
  assert.match(runTool(empty).out, /has no tracked files/);
  assertActionable(failureLine(runTool(empty).out, /has no tracked files/));
  const docsOnly = fixtureRepo({ "docs/readme.txt": "text\n" });
  assert.match(runTool(docsOnly).out, /none of 1 tracked files is a non-test/);
  assertActionable(failureLine(runTool(docsOnly).out, /^none of 1 tracked files/));
});
