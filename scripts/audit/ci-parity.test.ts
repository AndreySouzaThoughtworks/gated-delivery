import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";
import { AUDIT_WORKFLOW, LIVE_OPT_IN_FILE, jobBlocks, liveOptInProblems, workflowParityProblems } from "./ci-parity.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX_JOB =
  "name: audit\njobs:\n  consistency:\n    name: ${{ matrix.name }}\n    strategy:\n      matrix:\n        include:\n          - name: consistency\n            node-version: 22\n          - name: node 26\n            node-version: 26\n    steps:\n      - run: node scripts/audit/consistency.ts\n";
const HAND_COPY = "  node-26:\n    name: node 26\n    steps:\n      - run: node scripts/audit/consistency.ts\n";
const LIVE_TEST = `#!/usr/bin/env bash\nsource "$(dirname "$0")/${LIVE_OPT_IN_FILE}"\nclaude -p ping\n`;
const UNGUARDED_LIVE_TEST = "#!/usr/bin/env bash\nclaude -p ping\n";
const GUARD_AFTER_SESSION = `#!/usr/bin/env bash\nclaude -p ping\nsource "$(dirname "$0")/${LIVE_OPT_IN_FILE}"\n`;

const repoWithTests = (files: Record<string, string>) => {
  assert(Object.keys(files).every((name) => name.endsWith(".test.sh")), `every test file ends in .test.sh, got ${Object.keys(files)}`);
  const dir = validRepo();
  assert(dir.length > 0, `validRepo must return a directory, got ${JSON.stringify(dir)}`);
  write(dir, `tests/${LIVE_OPT_IN_FILE}`, "exit 64\n");
  for (const [name, body] of Object.entries(files)) write(dir, `tests/${name}`, body);
  return dir;
};

test("the real audit workflow has one matrix job named for both required checks, and the real tests carry the guard", () => {
  assert.deepEqual(workflowParityProblems(readFileSync(join(ROOT, AUDIT_WORKFLOW), "utf8")), []);
  assert.deepEqual(liveOptInProblems(ROOT), []);
});

test("the parity and opt-in rules refuse input that is not text, an empty workflow, or a missing root", () => {
  assert.throws(() => workflowParityProblems(7 as unknown as string), /the workflow is text, got number/);
  assert.throws(() => workflowParityProblems("  \n"), /must not be empty/);
  assert.throws(() => liveOptInProblems(7 as unknown as string), /the repo root is a path, got number/);
  assert.throws(() => liveOptInProblems("/nonexistent/gated-delivery-root"), /the repo root must exist/);
});

test("jobBlocks splits a workflow by job id", () => {
  assert.deepEqual([...jobBlocks(`${MATRIX_JOB}${HAND_COPY}`).keys()], ["consistency", "node-26"]);
  assert.throws(() => jobBlocks("name: audit\n"), /must hold a "jobs:" section/);
  assert.throws(() => jobBlocks("jobs:\n"), /must hold at least one job/);
});

test("check 29 rejects a second job that repeats the consistency guard, naming both jobs and the fix", () => {
  const { code, out } = runGuardWithWorkflow(`${MATRIX_JOB}${HAND_COPY}`);
  assert.equal(code, 1);
  assert.match(out, /audit\.yml: 2 jobs run node scripts\/audit\/consistency\.ts \("consistency", "node-26"\)\. Rule: one job runs it on every Node version through a matrix.*Fix: keep one job/);
});

test("check 29 rejects a matrix that lost a required check name or the name line", () => {
  const renamed = MATRIX_JOB.replace("- name: node 26", "- name: node 24");
  assert.match(workflowParityProblems(renamed).join("\n"), /no entry named "node 26" \(found \["consistency","node 24"\]\)\. Rule: branch protection requires/);
  const unnamed = MATRIX_JOB.replace("    name: ${{ matrix.name }}\n", "");
  assert.match(workflowParityProblems(unnamed).join("\n"), /job "consistency" must set `name: \$\{\{ matrix\.name \}\}`/);
});

test("check 29 accepts the matrix job", () => {
  const { code, out } = runGuardWithWorkflow(MATRIX_JOB);
  assert.equal(code, 0, out);
});

test("check 30 accepts a live test that sources the guard before its first claude call", () => {
  const { code, out } = runGuard(repoWithTests({ "live.test.sh": LIVE_TEST }));
  assert.equal(code, 0, out);
});

test("check 30 rejects a live test with no guard, and one that sources it after the session starts", () => {
  assert.deepEqual(liveOptInProblems(repoWithTests({ "bare.test.sh": UNGUARDED_LIVE_TEST })).length, 1);
  const { code, out } = runGuard(repoWithTests({ "late.test.sh": GUARD_AFTER_SESSION }));
  assert.equal(code, 1);
  assert.match(out, /tests\/late\.test\.sh: line 2 launches claude -p without the opt-in guard before it\. Rule: .* unless GATED_DELIVERY_ALLOW_LIVE_CLAUDE=1\. Fix: add `source/);
});

test("check 30 exempts only the named profile-isolation test, and reports a missing guard file", () => {
  assert.deepEqual(liveOptInProblems(repoWithTests({ "profile-isolation.test.sh": UNGUARDED_LIVE_TEST })), []);
  const dir = repoWithTests({});
  write(dir, "tests/other.test.sh", "echo hi\n");
  assert.deepEqual(liveOptInProblems(dir), []);
  const missingGuard = validRepo();
  write(missingGuard, "tests/other.test.sh", "echo hi\n");
  assert.match(liveOptInProblems(missingGuard).join("\n"), /tests\/require-live-opt-in\.sh is missing\. Rule: live tests source it/);
});

function runGuardWithWorkflow(workflow: string) {
  assert(workflow.includes("jobs:"), `a workflow holds a jobs: section, got ${workflow.length} characters without one`);
  const dir = validRepo();
  write(dir, AUDIT_WORKFLOW, workflow);
  const result = runGuard(dir);
  assert(result.out.length > 0, `the guard prints a report, got nothing for ${dir}`);
  return result;
}
