import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEveryLineActionable } from "../test-support/actionable.test.support.ts";
import { gitRepo } from "../test-support/git-fixture.test.support.ts";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "message-actionability.ts");
const BASELINE = "message-actionability-baseline.json";
const BAD_SOURCE = 'assert(ok, "something went wrong here");\n';
const GOOD_SOURCE = 'assert(ok, "the file must exist, got ${file}; create it.");\n';
const EXIT_PROBLEMS = 1;

const runTool = (repo: string, args: string[] = []) => {
  assert(repo !== "", `the tool runs on a repository directory, got ${JSON.stringify(repo)}`);
  const result = spawnSync("node", [TOOL, "--repo", repo, ...args], { encoding: "utf8", env: { ...process.env, GATED_DELIVERY_BASE_REF: "" } });
  assert(result.status !== null, `the tool must exit on its own, got signal ${result.signal}`);
  return result;
};

test("--update-baseline writes every non-actionable message and the next run accepts them", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": `${BAD_SOURCE}${GOOD_SOURCE}` }, "message-actionability-cli-");
  const written = runTool(repo, ["--update-baseline"]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /wrote message-actionability-baseline\.json: 1 of 2 failure messages are not actionable/);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, BASELINE), "utf8")).findings.map(({ message }: { message: string }) => message), ["something went wrong here"]);
  const accepted = runTool(repo);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /baseline\.json matches them/);
});

test("a message added after the baseline fails the run with an actionable report", () => {
  const repo = gitRepo({ "plugin/scripts/a.mjs": GOOD_SOURCE }, "message-actionability-cli-");
  runTool(repo, ["--update-baseline"]);
  writeFileSync(join(repo, "plugin/scripts/a.mjs"), `${GOOD_SOURCE}${BAD_SOURCE}`);
  const failed = runTool(repo);
  assert.equal(failed.status, EXIT_PROBLEMS);
  assert.match(failed.stderr, /must not hold the non-actionable message "something went wrong here"/);
  assertEveryLineActionable(failed.stderr);
  assert.match(failed.stdout, /baseline\.json does not match them/);
});

test("a repository with no scanned source file is refused", () => {
  const repo = gitRepo({ "docs/readme.md": "text\n" }, "message-actionability-cli-");
  const result = runTool(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /holds no scanned source file/);
});
