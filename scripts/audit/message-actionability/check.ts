import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_FILE, UPDATE_COMMAND, compareToMessageBaseline, findingsOf, growthProblem, parseMessageBaseline } from "./baseline.ts";
import type { Source } from "./baseline.ts";

const SCANNED_PATH = /^(?:plugin\/(?:scripts|hooks)\/|plugin\/skills\/[^/]+\/scripts\/|scripts\/(?:audit|eval)\/)/;
const SOURCE_FILE = /\.(?:mjs|ts)$/;
const EXCLUDED_PATH = /\.test\.|\/fixtures\/|\/test-support\//;

export const scannedSources = (root: string): Source[] => {
  assert(typeof root === "string" && root !== "", `the \`root\` must be a directory path, got ${JSON.stringify(root)}; pass the repository root.`);
  assert(existsSync(join(root, ".git")), `${root} must be a git checkout, but has no .git; pass the repository root.`);
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0");
  return tracked
    .filter((path) => SCANNED_PATH.test(path) && SOURCE_FILE.test(path) && !EXCLUDED_PATH.test(path) && existsSync(join(root, path)))
    .map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
};

export const baselineProblems = (root: string, baseRef: string | null) => {
  assert(baseRef === null || baseRef !== "", `the \`baseRef\` must be null or a ref name, got ${JSON.stringify(baseRef)}; pass one such as origin/main.`);
  assert(typeof root === "string" && root !== "", `the \`root\` must be a directory path, got ${JSON.stringify(root)}; pass the repository root.`);
  const baselinePath = join(root, BASELINE_FILE);
  if (!existsSync(baselinePath)) return [`${BASELINE_FILE} is missing from ${root}; run ${UPDATE_COMMAND}.`];
  const baseline = parseMessageBaseline(readFileSync(baselinePath, "utf8"), BASELINE_FILE);
  const { added, removable } = compareToMessageBaseline(findingsOf(scannedSources(root)), baseline);
  const problems = [
    ...added.map(({ path, message }) => `${path} must not hold the non-actionable message ${JSON.stringify(message)}; rewrite it to name the value, state the rule and give a fix after ";".`),
    ...removable.map(({ path, message }) => `${BASELINE_FILE} lists a stale message ${JSON.stringify(message)} of ${path}; run ${UPDATE_COMMAND}.`),
  ];
  if (baseRef === null) return problems;
  let baseText: string;
  try {
    baseText = execFileSync("git", ["show", `${baseRef}:./${BASELINE_FILE}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return problems;
  }
  const grown = growthProblem(baseline.length, parseMessageBaseline(baseText, `${BASELINE_FILE} at ${baseRef}`).length, baseRef);
  return grown === null ? problems : [...problems, grown];
};
