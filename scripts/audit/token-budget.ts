#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BASELINE_FILE, UPDATE_COMMAND, budgetProblems, measureBudgets, readBaseline } from "./token-budget/budget.ts";

const ESTIMATOR_NOTE = "ESTIMATED tokens: characters divided by 4, rounded up; not a tokenizer count";
const GROUP_COLUMN_WIDTH = 16;
const PATH_COLUMN_WIDTH = 62;
const TOKEN_COLUMN_WIDTH = 7;
const JSON_INDENT = 2;

const { values } = parseArgs({ options: { repo: { type: "string", default: process.cwd() }, "update-baseline": { type: "boolean", default: false } } });
const repo = resolve(values.repo);
const measured = measureBudgets(repo).sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));
const groupTotals = [...new Set(measured.map((entry) => entry.group))].sort().map((group): [string, string, number] => ["total", group, measured.filter((entry) => entry.group === group).reduce((sum, entry) => sum + entry.tokens, 0)]);
const table = [...measured.map((entry): [string, string, number] => [entry.group, entry.path, entry.tokens]), ...groupTotals];

console.log(ESTIMATOR_NOTE);
for (const [group, path, tokens] of table) console.log(`${group.padEnd(GROUP_COLUMN_WIDTH)}${path.padEnd(PATH_COLUMN_WIDTH)}${String(tokens).padStart(TOKEN_COLUMN_WIDTH)}`);

if (values["update-baseline"]) {
  const budgets = Object.fromEntries(measured.map(({ path, tokens }): [string, number] => [path, tokens]).sort(([a], [b]) => a.localeCompare(b)));
  mkdirSync(dirname(join(repo, BASELINE_FILE)), { recursive: true });
  writeFileSync(join(repo, BASELINE_FILE), `${JSON.stringify({ estimator: ESTIMATOR_NOTE, budgets }, null, JSON_INDENT)}\n`);
  console.log(`wrote ${BASELINE_FILE}`);
} else {
  const baseline = readBaseline(repo);
  const problems = baseline === null ? [`${BASELINE_FILE} is missing. Hint: run ${UPDATE_COMMAND}.`] : budgetProblems(measured, baseline);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("OK: every instruction file is within its token budget");
}
