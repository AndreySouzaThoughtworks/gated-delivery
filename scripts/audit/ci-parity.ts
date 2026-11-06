import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const AUDIT_WORKFLOW = ".github/workflows/audit.yml";
export const REQUIRED_MATRIX_NAMES = ["consistency", "node 26"];
export const LIVE_OPT_IN_FILE = "require-live-opt-in.sh";
export const LIVE_OPT_IN_VARIABLE = "GATED_DELIVERY_ALLOW_LIVE_CLAUDE";
export const OPT_IN_EXEMPT_TESTS = ["tests/profile-isolation.test.sh"];

const TESTS_DIRECTORY = "tests";
const CONSISTENCY_COMMAND = "node scripts/audit/consistency.ts";
const JOBS_HEADER = "jobs:";
const JOB_HEADER = /^ {2}([\w-]+):\s*$/;
const MATRIX_JOB_NAME = "name: ${{ matrix.name }}";
const MATRIX_ENTRIES = /include:\n([\s\S]*?)\n\s+steps:/;
const MATRIX_ENTRY_NAME = /^\s+- name: (.+?)\s*$/;
const LIVE_SESSION = /\bclaude -p\b/;
const NOT_FOUND = -1;

export const jobBlocks = (workflowText: string) => {
  const lines = workflowText.split("\n");
  const start = lines.indexOf(JOBS_HEADER);
  assert(start !== NOT_FOUND, `${AUDIT_WORKFLOW} must hold a "${JOBS_HEADER}" section, got ${lines.length} lines without one`);
  const blocks = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(start + 1)) {
    const header = JOB_HEADER.exec(line);
    if (header) {
      current = [];
      blocks.set(header[1], current);
    }
    current?.push(line);
  }
  assert(blocks.size > 0, `${AUDIT_WORKFLOW} must hold at least one job, got none`);
  return new Map([...blocks].map(([id, body]) => [id, body.join("\n")]));
};

export const workflowParityProblems = (workflowText: string) => {
  assert(typeof workflowText === "string", `the workflow is text, got ${typeof workflowText}`);
  assert(workflowText.trim() !== "", `${AUDIT_WORKFLOW} must not be empty, got ${workflowText.length} characters`);
  const consistencyJobs = [...jobBlocks(workflowText)].filter(([, block]) => block.includes(CONSISTENCY_COMMAND));
  if (consistencyJobs.length !== 1) {
    const ids = consistencyJobs.map(([id]) => `"${id}"`).join(", ") || "none";
    return [`${AUDIT_WORKFLOW}: ${consistencyJobs.length} jobs run ${CONSISTENCY_COMMAND} (${ids}). Rule: one job runs it on every Node version through a matrix, so the copies cannot drift. Fix: keep one job and give each Node version a matrix entry.`];
  }
  const [[id, block]] = consistencyJobs;
  const problems: string[] = [];
  if (!block.includes(MATRIX_JOB_NAME)) problems.push(`${AUDIT_WORKFLOW}: job "${id}" must set \`${MATRIX_JOB_NAME}\`. Rule: each matrix entry reports under the check name that branch protection requires. Fix: restore that line.`);
  const entries = MATRIX_ENTRIES.exec(block)?.[1] ?? "";
  const names = entries.split("\n").flatMap((line) => MATRIX_ENTRY_NAME.exec(line)?.[1] ?? []);
  for (const required of REQUIRED_MATRIX_NAMES) {
    if (!names.includes(required)) problems.push(`${AUDIT_WORKFLOW}: the matrix of job "${id}" has no entry named "${required}" (found ${JSON.stringify(names)}). Rule: branch protection requires a check with that name. Fix: restore the entry, or change branch protection first.`);
  }
  return problems;
};

export const liveOptInProblems = (root: string) => {
  assert(typeof root === "string", `the repo root is a path, got ${typeof root}`);
  assert(existsSync(root), `the repo root must exist, got ${root}`);
  const testsPath = join(root, TESTS_DIRECTORY);
  if (!existsSync(testsPath)) return [];
  const problems: string[] = [];
  if (!existsSync(join(testsPath, LIVE_OPT_IN_FILE))) problems.push(`${TESTS_DIRECTORY}/${LIVE_OPT_IN_FILE} is missing. Rule: live tests source it to refuse an accidental run. Fix: restore it.`);
  for (const name of readdirSync(testsPath).filter((file) => file.endsWith(".test.sh")).sort()) {
    const path = `${TESTS_DIRECTORY}/${name}`;
    const lines = readFileSync(join(root, path), "utf8").split("\n");
    const firstSession = lines.findIndex((line) => LIVE_SESSION.test(line));
    if (firstSession === NOT_FOUND || OPT_IN_EXEMPT_TESTS.includes(path)) continue;
    const guard = lines.findIndex((line) => line.includes(LIVE_OPT_IN_FILE));
    if (guard === NOT_FOUND || guard > firstSession) {
      problems.push(`${path}: line ${firstSession + 1} launches claude -p without the opt-in guard before it. Rule: a test that starts a real session on the subscription refuses to run unless ${LIVE_OPT_IN_VARIABLE}=1. Fix: add \`source "$(dirname "$0")/${LIVE_OPT_IN_FILE}"\` above the first claude call.`);
    }
  }
  return problems;
};
