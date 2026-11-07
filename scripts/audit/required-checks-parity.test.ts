import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentedChecks, liveChecks, requiredChecksProblems } from "./required-checks-parity.ts";

const SCRIPT = join(import.meta.dirname, "required-checks-parity.ts");
const NAMES = ["zanity", "Links (lychee)", "node 26"];
const EXIT_PROBLEMS = 1;
const WRONG = 5 as never;

const documentWith = (rows: string[]) => {
  assert(Array.isArray(rows), `the rows are a list, got ${typeof rows}`);
  const root = mkdtempSync(join(tmpdir(), "required-parity-"));
  assert(root.startsWith(tmpdir()), `${root} must be a throwaway under ${tmpdir()}`);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/development.md"), `# d\n\n## Checks every change passes\n\n| Check | Runs |\n|---|---|\n${rows.map((row) => `| ${row} | runs |`).join("\n")}\n\n## Next\n`);
  return root;
};

const runCommand = (commandArguments: string[], names: string[]) => {
  assert(commandArguments.length > 0, `the command needs arguments, got ${commandArguments.length}`);
  assert(Array.isArray(names), `the names are a list, got ${typeof names}`);
  return spawnSync(process.execPath, [SCRIPT, ...commandArguments], { input: JSON.stringify({ contexts: names }), encoding: "utf8" });
};

test("the real documentation lists the names of the real table", () => {
  const names = documentedChecks(process.cwd());
  assert.ok(names.includes("zanity") && names.includes("Links (lychee)"), `expected zanity and Links (lychee) in ${JSON.stringify(names)}`);
});

test("identical sets raise no problem", () => {
  assert.deepEqual(requiredChecksProblems(NAMES, NAMES), []);
});

test("ordering and whitespace differences are accepted", () => {
  const documented = documentedChecks(documentWith(["`node  26`", "` zanity `", "`Links (lychee)`"]));
  assert.deepEqual(requiredChecksProblems(documented, liveChecks(JSON.stringify({ contexts: ["Links (lychee)", "node 26", "zanity"] }))), []);
});

test("a check that GitHub requires and the docs omit is named as extra with its fix", () => {
  const [problem, ...others] = requiredChecksProblems(NAMES, [...NAMES, "secret-scan"]);
  assert.equal(others.length, 0);
  assert.match(problem, /GitHub requires "secret-scan" on main.*does not list it\. Fix: add a row/);
});

test("a check that the docs list and GitHub does not require is named as missing with its fix", () => {
  const [problem, ...others] = requiredChecksProblems(NAMES, ["zanity", "node 26"]);
  assert.equal(others.length, 0);
  assert.match(problem, /lists "Links \(lychee\)", but GitHub does not require it on main\. Fix: remove the row/);
});

test("both differences are reported together", () => {
  assert.equal(requiredChecksProblems(NAMES, ["zanity", "node 26", "extra-one"]).length, 2);
});

test("an empty documented list is rejected", () => {
  assert.throws(() => requiredChecksProblems([], NAMES), /lists no check.*Fix: restore the table/);
});

test("live checks that are not a list are rejected", () => {
  assert.throws(() => requiredChecksProblems(NAMES, WRONG), /`live` must be a list of names, got number/);
});

test("a table without rows is rejected when read from the documentation", () => {
  assert.throws(() => documentedChecks(documentWith([])), /must hold rows/);
});

test("a row with an empty name is rejected", () => {
  assert.throws(() => documentedChecks(documentWith(["` `"])), /check name must not be empty/);
});

test("a documentation root that is not a path is rejected", () => {
  assert.throws(() => documentedChecks(WRONG), /`root` must be a directory path, got 5; pass the repository root/);
  assert.throws(() => documentedChecks(""), /`root` must not be empty, got ""; pass the repository root/);
});

test("an answer without a contexts array is rejected", () => {
  assert.throws(() => liveChecks('{"message":"Not Found"}'), /must hold a "contexts" array.*send the output of gh api/);
});

test("an answer that is not text is rejected", () => {
  assert.throws(() => liveChecks(WRONG), /`apiJson` must be text, got number/);
});

test("a context that is not text is rejected", () => {
  assert.throws(() => liveChecks(JSON.stringify({ contexts: [5] })), /`name` must be text, got number/);
});

test("the command line exits 1 and names the extra check, and exits 0 for equal sets", () => {
  const root = documentWith(NAMES.map((name) => `\`${name}\``));
  const same = runCommand(["--repo", root], NAMES);
  assert.equal(same.status, 0, same.stderr);
  const different = runCommand(["--repo", root], [...NAMES, "intruder"]);
  assert.equal(different.status, EXIT_PROBLEMS);
  assert.match(different.stderr, /"intruder"/);
});

test("the command line rejects a positional argument and an empty repository option", () => {
  const root = documentWith(NAMES.map((name) => `\`${name}\``));
  assert.match(runCommand(["--repo", root, "stray"], NAMES).stderr, /takes no positional argument/);
  assert.match(runCommand(["--repo", ""], NAMES).stderr, /repository option must name a folder/);
});
