import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintSpec } from "../skills/spec/scripts/spec-lint.mjs";
import { missingFileProblems, specProblems, worktreeProblems } from "./executor-preflight.mjs";
import { assertActionable, assertErrorIsActionable, runScript } from "./run-cli.test.support.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "executor-preflight.mjs");
const VALID_SPEC = readFileSync(join(HERE, "..", "..", "scripts", "audit", "fixtures", "valid-spec.md"), "utf8");
const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const EXISTING_FILE_BULLET = "- `src/orders/order.ts` — builds the order — guarded by `test/orders/order.spec.ts`";
const OPEN_DECISION_BULLET = "- Decision: reject at submit or at load — chosen: both, because AC[1] and AC[2] each need one; consequence: two checks to keep in step.";
const FIRST_SLICE = 1;
const GIT_IDENTITY = ["-c", "user.name=preflight", "-c", "user.email=preflight@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

const runGit = (repo, args) => {
  assert(isAbsolute(repo), `runGit needs an absolute repository path, got ${JSON.stringify(repo)}`);
  assert(args.length > 0, `runGit needs a git command for ${repo}, got ${args.length} arguments`);
  const result = spawnSync("git", [...GIT_IDENTITY, "-C", repo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} must succeed, got ${result.stderr}`);
  return result.stdout.trim();
};

const newWorktree = () => { // zanity: ignore[assertion-density] -- single-invariant: a fixture builder whose git calls throw on failure, so a clean status is its one checkable postcondition
  const repo = mkdtempSync(join(tmpdir(), "executor-preflight-"));
  runGit(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "src", "orders"), { recursive: true });
  writeFileSync(join(repo, "src", "orders", "order.ts"), "export const order = 1;\n");
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-q", "-m", "chore: start"]);
  const pending = runGit(repo, ["status", "--porcelain"]);
  assert.equal(pending, "", `a fresh worktree must be clean, got ${pending}`);
  return repo;
};

const specWith = (replacements) => {
  assert(Array.isArray(replacements), `replacements must be a list, got ${typeof replacements}`);
  const raw = replacements.reduce((text, [from, to]) => {
    assert(text.includes(from), `the fixture must contain ${from}`);
    return text.replace(from, to);
  }, VALID_SPEC);
  assert.notEqual(raw, VALID_SPEC);
  return raw;
};

const rulesOf = (result) => {
  assert(Array.isArray(result.problems), `a result needs a problems list, got ${JSON.stringify(result)}`);
  for (const { detail } of result.problems) assertActionable(detail);
  const rules = result.problems.map(({ rule }) => rule);
  assert(rules.every((rule) => rule !== ""), `every problem must name a rule, got ${JSON.stringify(rules)}`);
  return rules;
};

const check = (raw, options = {}) => {
  assert(typeof raw === "string", `a spec must be text, got ${typeof raw}`);
  const result = specProblems(raw, { slice: FIRST_SLICE, base: newWorktree(), ...options });
  assert(Array.isArray(result.skip), `a result needs a skip list, got ${JSON.stringify(result)}`);
  return result;
};

test("the fixture is a lint-clean spec", () => {
  assert.deepEqual(lintSpec(VALID_SPEC), []);
});

test("accepts a valid spec for its slice", () => {
  assert.deepEqual(check(VALID_SPEC, { base: newWorktree() }), { problems: [], skip: [] });
});

test("rejects an unresolved open decision with options", () => {
  const raw = specWith([[OPEN_DECISION_BULLET, "- **Options:** reject at submit, or reject at load."]]);
  assert.deepEqual(rulesOf(check(raw)), ["unresolved-open-decision"]);
});

test("rejects an unresolved open decision that needs user input", () => {
  const raw = specWith([[OPEN_DECISION_BULLET, "- Recommendation: needs user input."]]);
  assert.deepEqual(rulesOf(check(raw)), ["unresolved-open-decision"]);
});

test("agrees with spec-lint on what an unresolved open decision is", () => {
  const resolved = specWith([[OPEN_DECISION_BULLET, "- Decision: reject at submit, because it is cheaper."]]);
  const unresolved = specWith([[OPEN_DECISION_BULLET, "- **Options:** A or B."]]);
  const lintFlagsResolved = lintSpec(resolved).some((problem) => /unresolved entry/.test(problem));
  const lintFlagsUnresolved = lintSpec(unresolved).some((problem) => /unresolved entry/.test(problem));
  assert.equal(lintFlagsResolved, rulesOf(check(resolved)).includes("unresolved-open-decision"), "preflight and spec-lint must agree on a resolved decision");
  assert.equal(lintFlagsUnresolved, rulesOf(check(unresolved)).includes("unresolved-open-decision"), "preflight and spec-lint must agree on an unresolved decision");
  assert.equal(lintFlagsUnresolved, true, "spec-lint must flag the unresolved decision, or the comparison proves nothing");
});

test("rejects an empty acceptance criteria section", () => {
  const section = VALID_SPEC.slice(VALID_SPEC.indexOf("## Acceptance criteria"), VALID_SPEC.indexOf("## Interface"));
  const raw = specWith([[section, "## Acceptance criteria\n\n"]]);
  assert(rulesOf(check(raw)).includes("empty-acceptance-criteria"), "an empty acceptance criteria section must be rejected");
});

test("rejects a Relevant files path that does not exist and names it", () => {
  const raw = specWith([[EXISTING_FILE_BULLET, "- `src/orders/gone.ts` — builds the order — guarded by `pnpm test`"]]);
  const result = check(raw);
  assert.deepEqual(rulesOf(result), ["missing-relevant-file"]);
  assert.match(result.problems[0].detail, /src\/orders\/gone\.ts/);
  assertActionable(result.problems[0].detail);
});

test("accepts a Relevant files bullet that names a file the ticket adds", () => {
  const raw = specWith([[EXISTING_FILE_BULLET, `${EXISTING_FILE_BULLET}\n- \`src/orders/line-validator.ts\` — new file this ticket adds — guarded by \`pnpm test\``]]);
  assert.deepEqual(check(raw).problems, []);
});

test("accepts a Relevant files glob and a line-numbered path", () => {
  const raw = specWith([[EXISTING_FILE_BULLET, "- `src/orders/**/*.ts` — the order modules — guarded by `pnpm test`\n- `src/orders/order.ts:12` — the builder — guarded by `pnpm test`"]]);
  assert.deepEqual(check(raw).problems, []);
});

test("ignores backticked commands that are not paths in Relevant files", () => {
  const raw = specWith([[EXISTING_FILE_BULLET, `${EXISTING_FILE_BULLET}\n- \`pnpm test\` — the check — guarded by itself`]]);
  assert.deepEqual(check(raw).problems, []);
});

test("missingFileProblems rejects a non-text section and a relative base", () => {
  assert.throws(() => missingFileProblems(undefined, newWorktree()), /must be text/);
  assert.throws(() => missingFileProblems("", "relative/base"), /must be absolute/);
  assertErrorIsActionable(() => missingFileProblems(undefined, newWorktree()));
  assertErrorIsActionable(() => missingFileProblems("", "relative/base"));
});

test("rejects an AC outside the slice and names both", () => {
  const result = check(VALID_SPEC, { acs: [1, 2] });
  assert.deepEqual(rulesOf(result), ["ac-outside-slice"]);
  assert.match(result.problems[0].detail, /AC\[2\] is not assigned to Slice 1/);
  assertActionable(result.problems[0].detail);
});

test("lists cross-repo ACs to skip instead of rejecting them", () => {
  assert.deepEqual(check(VALID_SPEC, { acs: [1, 3] }), { problems: [], skip: [3] });
});

test("rejects a slice the Rollout does not hold", () => {
  assert.deepEqual(rulesOf(check(VALID_SPEC, { slice: 9 })), ["slice-not-found"]);
});

test("rejects a slice that is not a positive integer", () => {
  assert.throws(() => check(VALID_SPEC, { slice: 0 }), /positive integer/);
  assertErrorIsActionable(() => check(VALID_SPEC, { slice: 0 }));
});

test("accepts a clean worktree", () => {
  assert.deepEqual(worktreeProblems(newWorktree()), []);
});

test("rejects a dirty worktree with an untracked file and with an edited file", () => {
  const untracked = newWorktree();
  writeFileSync(join(untracked, "scratch.txt"), "x\n");
  assert.deepEqual(worktreeProblems(untracked).map(({ rule }) => rule), ["worktree-dirty"]);
  assertActionable(worktreeProblems(untracked)[0].detail);
  const edited = newWorktree();
  writeFileSync(join(edited, "src", "orders", "order.ts"), "changed\n");
  assert.deepEqual(worktreeProblems(edited).map(({ rule }) => rule), ["worktree-dirty"]);
});

test("rejects a directory that is not a git worktree and a missing directory", () => {
  const plain = mkdtempSync(join(tmpdir(), "executor-preflight-plain-"));
  assert.deepEqual(worktreeProblems(plain).map(({ rule }) => rule), ["worktree-not-a-git-worktree"]);
  assertActionable(worktreeProblems(plain)[0].detail);
  assert.deepEqual(worktreeProblems(join(plain, "missing")).map(({ rule }) => rule), ["worktree-not-a-git-worktree"]);
  assert.throws(() => worktreeProblems(""), /must name a directory/);
  assertErrorIsActionable(() => worktreeProblems(""));
});


const writeSpec = (raw) => {
  assert(typeof raw === "string", `a spec must be text, got ${typeof raw}`);
  const path = join(mkdtempSync(join(tmpdir(), "executor-preflight-spec-")), "spec.md");
  writeFileSync(path, raw);
  const written = readFileSync(path, "utf8");
  assert.equal(written, raw, "the spec file must hold the text it was given");
  assert(path.endsWith("spec.md"), `the spec file must be named spec.md, got ${path}`);
  return path;
};

test("exits 0 with ok true for a valid spec in a clean worktree", () => {
  const result = runScript(SCRIPT, ["--spec", writeSpec(VALID_SPEC), "--slice", "1", "--acs", "1,3", "--worktree", newWorktree()]);
  assert.equal(result.status, EXIT_OK);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, problems: [], skip: [3] });
});

test("exits 1 and reports problems from the spec and the worktree together", () => {
  const worktree = newWorktree();
  writeFileSync(join(worktree, "scratch.txt"), "x\n");
  const raw = specWith([[OPEN_DECISION_BULLET, "- **Options:** A or B."]]);
  const result = runScript(SCRIPT, ["--spec", writeSpec(raw), "--slice", "1", "--worktree", worktree]);
  assert.equal(result.status, EXIT_PROBLEMS);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems.map(({ rule }) => rule), ["unresolved-open-decision", "worktree-dirty"]);
});

test("exits 2 on missing arguments, a bad slice, a bad AC list and an unreadable spec", () => {
  const spec = writeSpec(VALID_SPEC);
  assert.equal(runScript(SCRIPT, ["--slice", "1"]).status, EXIT_USAGE);
  assert.equal(runScript(SCRIPT, ["--spec", spec]).status, EXIT_USAGE);
  assert.equal(runScript(SCRIPT, ["--spec", spec, "--slice", "0"]).status, EXIT_USAGE);
  assert.equal(runScript(SCRIPT, ["--spec", spec, "--slice", "1", "--acs", "1,x"]).status, EXIT_USAGE);
  assert.equal(runScript(SCRIPT, ["--spec", `${spec}.missing`, "--slice", "1"]).status, EXIT_USAGE);
  for (const args of [["--slice", "1"], ["--spec", spec], ["--spec", spec, "--slice", "0"], ["--spec", spec, "--slice", "1", "--acs", "1,x"]]) {
    assertActionable(runScript(SCRIPT, args).stderr.split("\n")[0].replace(/^executor-preflight: /, ""));
  }
});
