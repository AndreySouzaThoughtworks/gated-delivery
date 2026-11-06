import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE_FILE, BASELINE_RULE, baselineText } from "./baseline.ts";
import { baselineProblems, scannedSources } from "./check.ts";
import { assertActionable, assertErrorIsActionable } from "../../test-support/actionable.test.support.ts";
import { gitRepo } from "../../test-support/git-fixture.test.support.ts";

const BAD_MESSAGE = "something went wrong here";
const SOURCE = `assert(ok, "${BAD_MESSAGE}");\n`;
const GOOD_SOURCE = 'assert(ok, "the file must exist, got ${file}; create it.");\n';
const baselineOf = (paths: string[]) => {
  assert(Array.isArray(paths), `the baseline paths must be a list, got ${typeof paths}`);
  assert(paths.every((path) => path.endsWith(".mjs")), `the baseline paths must name .mjs files, got ${JSON.stringify(paths)}`);
  return baselineText(paths.map((path) => ({ path, rule: BASELINE_RULE, message: BAD_MESSAGE })));
};

const git = (cwd: string, args: string[]) => {
  assert(cwd !== "", `git needs a working directory, got ${JSON.stringify(cwd)}`);
  assert(args.length > 0, `git needs a subcommand, got ${args.length} arguments`);
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
};

test("scannedSources reads shipped scripts and dev scripts but not tests, fixtures, support files or other folders", () => {
  const repo = gitRepo(
    {
      "plugin/scripts/a.mjs": SOURCE,
      "plugin/skills/spec/scripts/b.mjs": SOURCE,
      "scripts/audit/c.ts": SOURCE,
      "scripts/eval/d.ts": SOURCE,
      "plugin/scripts/a.test.mjs": SOURCE,
      "plugin/scripts/fixtures/e.mjs": SOURCE,
      "scripts/test-support/f.mjs": SOURCE,
      "scripts/other/g.ts": SOURCE,
      "plugin/scripts/notes.md": SOURCE,
    },
    "message-actionability-sources-",
  );
  assert.deepEqual(scannedSources(repo).map(({ path }) => path).sort(), ["plugin/scripts/a.mjs", "plugin/skills/spec/scripts/b.mjs", "scripts/audit/c.ts", "scripts/eval/d.ts"]);
});

test("scannedSources refuses a directory that is not a git checkout and a blank root", () => {
  assert.throws(() => scannedSources(mkdtempSync(join(tmpdir(), "message-actionability-plain-"))), /must be a git checkout, but has no \.git/);
  assert.throws(() => scannedSources(""), /the `root` must be a directory path/);
  assertErrorIsActionable(() => scannedSources(""));
});

test("baselineProblems refuses a blank base ref and a blank root", () => {
  assert.throws(() => baselineProblems("/repo", ""), /the `baseRef` must be null or a ref name/);
  assert.throws(() => baselineProblems("", null), /the `root` must be a directory path/);
  assertErrorIsActionable(() => baselineProblems("/repo", ""));
  assertErrorIsActionable(() => baselineProblems("", null));
});

test("a baseline that holds every non-actionable message and nothing else has no problem", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": SOURCE, [BASELINE_FILE]: baselineOf(["plugin/scripts/a.mjs"]) }, "message-actionability-clean-");
  assert.deepEqual(baselineProblems(repo, null), []);
});

test("a missing baseline is reported with the command that writes it", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": SOURCE }, "message-actionability-missing-");
  const [problem] = baselineProblems(repo, null);
  assert.match(problem, /message-actionability-baseline\.json is missing/);
  assertActionable(problem);
});

test("a new non-actionable message is reported with its file and the message", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": SOURCE, [BASELINE_FILE]: baselineOf([]) }, "message-actionability-added-");
  const [problem, ...rest] = baselineProblems(repo, null);
  assert.deepEqual(rest, []);
  assert.match(problem, /plugin\/scripts\/a\.mjs must not hold the non-actionable message "something went wrong here"/);
  assertActionable(problem);
});

test("a baseline entry whose message is now actionable is reported as stale", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": GOOD_SOURCE, [BASELINE_FILE]: baselineOf(["plugin/scripts/a.mjs"]) }, "message-actionability-stale-");
  const [problem, ...rest] = baselineProblems(repo, null);
  assert.deepEqual(rest, []);
  assert.match(problem, /lists a stale message "something went wrong here" of plugin\/scripts\/a\.mjs/);
  assertActionable(problem);
});

test("a baseline that grew against the base ref is reported, and one that held is not", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": SOURCE, [BASELINE_FILE]: baselineOf(["plugin/scripts/a.mjs"]) }, "message-actionability-growth-");
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["tag", "base"]);
  assert.deepEqual(baselineProblems(repo, "base"), []);
  writeFileSync(join(repo, "plugin/scripts/b.mjs"), SOURCE);
  writeFileSync(join(repo, BASELINE_FILE), baselineOf(["plugin/scripts/a.mjs", "plugin/scripts/b.mjs"]));
  git(repo, ["add", "-A"]);
  const problems = baselineProblems(repo, "base");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must not grow, but went from 1 to 2 entries against base/);
});

test("a baseline file that did not exist at the base ref cannot have grown", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": "export const one = 1;\n" }, "message-actionability-new-");
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["tag", "base"]);
  writeFileSync(join(repo, BASELINE_FILE), baselineOf([]));
  assert.deepEqual(baselineProblems(repo, "base"), []);
});
