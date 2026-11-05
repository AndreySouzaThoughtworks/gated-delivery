import { test } from "node:test";
import assert from "node:assert/strict";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";
import { BASELINE_FILE, measureBudgets } from "./token-budget/budget.ts";

const TOKEN_BUDGET_SCRIPT = "scripts/audit/token-budget.ts";
const ALPHA_SKILL = "plugin/skills/alpha/SKILL.md";
const FILLER_CHARACTERS = 4000;
const TOLERABLE_GAIN = 2;
const EXCESSIVE_GAIN = 40;

const budgetedRepo = (adjustAlphaBudget = 0) => {
  assert(Number.isInteger(adjustAlphaBudget), `the budget adjustment counts whole tokens, got ${adjustAlphaBudget}`);
  const dir = validRepo();
  write(dir, TOKEN_BUDGET_SCRIPT, "");
  write(dir, ALPHA_SKILL, `---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\n${"a".repeat(FILLER_CHARACTERS)}\n`);
  const budgets = Object.fromEntries(measureBudgets(dir).map(({ path, tokens }) => [path, tokens + (path === ALPHA_SKILL ? adjustAlphaBudget : 0)]));
  write(dir, BASELINE_FILE, JSON.stringify({ budgets }));
  assert(Object.hasOwn(budgets, ALPHA_SKILL), `the baseline must budget ${ALPHA_SKILL}`);
  return { dir, budgets };
};

test("check 28 accepts files at their token budget and a gain inside the tolerance", () => {
  for (const adjustment of [0, TOLERABLE_GAIN]) {
    const { code, out } = runGuard(budgetedRepo(adjustment).dir);
    assert.equal(code, 0, out);
  }
});

test("check 28 rejects an instruction file that grew past its token budget", () => {
  const { dir } = budgetedRepo(-1);
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /plugin\/skills\/alpha\/SKILL\.md grew to \d+ estimated tokens, over its budget of \d+\. Hint: trim the text, or raise the budget in evals\/token-budget\.json in a PR that says why/);
});

test("check 28 rejects an instruction file with no budget entry", () => {
  const { dir, budgets } = budgetedRepo();
  write(dir, "plugin/agents/newcomer.md", "---\nname: newcomer\ndescription: x\n---\n");
  write(dir, BASELINE_FILE, JSON.stringify({ budgets }));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /plugin\/agents\/newcomer\.md is a new instruction file: add its budget/);
});

test("check 28 rejects a budget entry whose file is gone", () => {
  const { dir, budgets } = budgetedRepo();
  write(dir, BASELINE_FILE, JSON.stringify({ budgets: { ...budgets, "plugin/skills/gone/SKILL.md": 10 } }));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /budgets plugin\/skills\/gone\/SKILL\.md, which no longer exists/);
});

test("check 28 rejects a gain beyond the tolerance until the baseline is updated", () => {
  const { code, out } = runGuard(budgetedRepo(EXCESSIVE_GAIN).dir);
  assert.equal(code, 1);
  assert.match(out, /alpha\/SKILL\.md shrank to \d+ estimated tokens.*lock in the gain: run node scripts\/audit\/token-budget\.ts --update-baseline/);
});

test("check 28 reports a missing baseline when the budget script exists", () => {
  const dir = validRepo();
  write(dir, TOKEN_BUDGET_SCRIPT, "");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1);
  assert.match(out, /evals\/token-budget\.json is missing/);
});
