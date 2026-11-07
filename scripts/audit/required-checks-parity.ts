import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CHECKS_HEADING, CHECK_COLUMNS, DEVELOPMENT_FILE, tableUnder } from "../site/facts.ts";

const BACKTICK = /`/g;
const WHITESPACE = /\s+/g;
const EXIT_PROBLEMS = 1;
const ANSWER_EXCERPT_LENGTH = 200;

const normalized = (name: string) => {
  assert(typeof name === "string", `the \`name\` must be text, got ${typeof name}; pass a name as GitHub or the table gives it.`);
  const clean = name.replace(BACKTICK, "").replace(WHITESPACE, " ").trim();
  assert(clean !== "", `a check name must not be empty, got ${JSON.stringify(name)}; fix the table row or the branch protection entry.`);
  return clean;
};

export const documentedChecks = (root: string) => {
  assert(typeof root === "string", `the \`root\` must be a directory path, got ${JSON.stringify(root)}; pass the repository root.`);
  assert(root !== "", `the \`root\` must not be empty, got ${JSON.stringify(root)}; pass the repository root.`);
  return tableUnder(root, DEVELOPMENT_FILE, CHECKS_HEADING, CHECK_COLUMNS.length).map(([name]) => normalized(name));
};

export const liveChecks = (apiJson: string): string[] => {
  assert(typeof apiJson === "string", `the \`apiJson\` must be text, got ${typeof apiJson}; pass the output of the required_status_checks endpoint.`);
  const parsed = JSON.parse(apiJson);
  assert(Array.isArray(parsed.contexts), `the GitHub answer must hold a "contexts" array, got ${JSON.stringify(apiJson.slice(0, ANSWER_EXCERPT_LENGTH))}; send the output of gh api repos/<owner>/<name>/branches/main/protection/required_status_checks.`);
  return parsed.contexts.map(normalized);
};

export const requiredChecksProblems = (documented: string[], live: string[]) => {
  assert(documented.length > 0, `${DEVELOPMENT_FILE} section "${CHECKS_HEADING}" lists no check, got an empty list. Fix: restore the table of required checks.`);
  assert(Array.isArray(live), `the \`live\` must be a list of names, got ${typeof live}; pass the result of liveChecks.`);
  const documentedSet = new Set(documented);
  const liveSet = new Set(live);
  const extra = live.filter((name) => !documentedSet.has(name));
  const missing = documented.filter((name) => !liveSet.has(name));
  return [
    ...(extra.length > 0 ? [`GitHub requires ${extra.map((name) => `"${name}"`).join(", ")} on main, but ${DEVELOPMENT_FILE} section "${CHECKS_HEADING}" does not list it. Fix: add a row for each, or remove the check from the branch protection.`] : []),
    ...(missing.length > 0 ? [`${DEVELOPMENT_FILE} section "${CHECKS_HEADING}" lists ${missing.map((name) => `"${name}"`).join(", ")}, but GitHub does not require it on main. Fix: remove the row, or add the check to the branch protection.`] : []),
  ];
};

const main = () => {
  const { values, positionals } = parseArgs({ options: { repo: { type: "string", default: process.cwd() } }, allowPositionals: true });
  assert(positionals.length === 0, `the check takes no positional argument, got ${JSON.stringify(positionals)}; pass --repo <directory> and the GitHub answer on standard input.`);
  assert(values.repo !== "", `the repository option must name a folder, got ${JSON.stringify(values.repo)}; pass --repo <directory>`);
  const problems = requiredChecksProblems(documentedChecks(resolve(values.repo)), liveChecks(readFileSync(process.stdin.fd, "utf8")));
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(EXIT_PROBLEMS);
  }
  console.log("OK: the required checks in the documentation and on GitHub are the same set");
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
