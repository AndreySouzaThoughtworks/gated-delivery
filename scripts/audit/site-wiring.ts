import assert from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AUDIT_WORKFLOW, jobBlocks } from "./ci-parity.ts";

export const SITE_SOURCES_DIRECTORY = "docs-site-src";
export const SITE_BUILD_SCRIPT = "scripts/site/build.ts";
export const SITE_BUILD_COMMAND = "node scripts/site/build.ts --check";
const CONSISTENCY_COMMAND = "node scripts/audit/consistency.ts";

export const siteWiringProblems = (root: string) => {
  assert(existsSync(root), `the repository root ${root} must exist to check the site wiring, got none; pass the repository root.`);
  assert(statSync(root).isDirectory(), `the repository root ${root} must be a directory, got a file; pass the repository root.`);
  if (!existsSync(join(root, SITE_SOURCES_DIRECTORY))) return [];
  const problems: string[] = [];
  if (!existsSync(join(root, SITE_BUILD_SCRIPT))) {
    problems.push(`${SITE_BUILD_SCRIPT} is missing, but ${SITE_SOURCES_DIRECTORY}/ holds the site sources. Rule: the sources always have a generator. Fix: restore the script, or remove ${SITE_SOURCES_DIRECTORY}/.`);
  }
  const workflowPath = join(root, AUDIT_WORKFLOW);
  if (!existsSync(workflowPath)) {
    problems.push(`${AUDIT_WORKFLOW} is missing, so no CI step builds the site. Rule: CI builds the site on every pull request. Fix: restore the workflow with the step "${SITE_BUILD_COMMAND}".`);
    return problems;
  }
  const consistencyJob = [...jobBlocks(readFileSync(workflowPath, "utf8")).values()].find((block) => block.includes(CONSISTENCY_COMMAND));
  if (!consistencyJob?.includes(SITE_BUILD_COMMAND)) {
    problems.push(`${AUDIT_WORKFLOW} has no "${SITE_BUILD_COMMAND}" step in the consistency job. Rule: CI builds the site on every pull request, in the job that branch protection already requires. Fix: add a step that runs it after the script tests.`);
  }
  return problems;
};

const EXIT_PROBLEMS = 1;

const main = () => {
  const { values, positionals } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } }, allowPositionals: true });
  assert(positionals.length === 0, `the check takes no positional argument, got ${JSON.stringify(positionals)}; pass --repo <directory>`);
  assert(values.repo !== "", `the repository option must name a folder, got ${JSON.stringify(values.repo)}; pass --repo <directory>`);
  const problems = siteWiringProblems(resolve(values.repo));
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(EXIT_PROBLEMS);
  }
  console.log(`OK: the site has its build script and its CI step`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
