import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_FILE, GAIN_TOLERANCE, LISTING_ENTRY, budgetProblems, estimateTokens, measureBudgets, readBaseline } from "./token-budget/budget.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "token-budget.ts");
const CHARACTERS_PER_TOKEN = 4;
const SKILL_PATH = "plugin/skills/alpha/SKILL.md";
const GROWN_BODY_CHARACTERS = 400;

const write = (dir: string, path: string, body: string) => {
  assert(typeof body === "string", `${path} needs text content, got ${typeof body}`);
  assert(!path.startsWith("/"), `${path} must be relative to ${dir}`);
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
};

const scratchRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "token-budget-test-"));
  write(dir, SKILL_PATH, "---\nname: alpha\ndescription: does alpha\n---\n\nbody\n");
  write(dir, "plugin/skills/alpha/templates/t.md", "template text");
  write(dir, "plugin/skills/alpha/evals.md", "not measured");
  write(dir, "plugin/skills/alpha/examples/e.md", "not measured either");
  write(dir, "plugin/agents/bot.md", "---\nname: bot\ndescription: a bot\n---\n");
  write(dir, "plugin/commands/go.md", "---\ndescription: goes\n---\n");
  write(dir, "plugin/references/r.md", "reference text");
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  assert(readFileSync(join(dir, SKILL_PATH), "utf8").startsWith("---"), "the fixture skill needs frontmatter");
  return dir;
};

const runScript = (dir: string, args: string[] = []) => {
  assert(dir.startsWith(tmpdir()), `the script runs on a throwaway repo, got ${dir}`);
  const result = spawnSync("node", [SCRIPT, "--repo", dir, ...args], { encoding: "utf8" });
  assert(result.status !== null, `the script must exit on its own, got signal ${result.signal}`);
  return result;
};

test("estimateTokens rounds characters over four up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("a".repeat(CHARACTERS_PER_TOKEN)), 1);
  assert.equal(estimateTokens("a".repeat(CHARACTERS_PER_TOKEN + 1)), 2);
});

test("measureBudgets labels skills, resources, agents, commands and references, and sums the listing", () => {
  const measured = measureBudgets(scratchRepo());
  const groups = Object.fromEntries(measured.map(({ path, group }) => [path, group]));
  assert.deepEqual(groups, {
    [SKILL_PATH]: "skill",
    "plugin/skills/alpha/templates/t.md": "skill-resource",
    "plugin/agents/bot.md": "agent",
    "plugin/commands/go.md": "command",
    "plugin/references/r.md": "reference",
    [LISTING_ENTRY]: "listing",
  });
  const listing = measured.find(({ path }) => path === LISTING_ENTRY);
  assert.equal(listing?.tokens, estimateTokens("alpha: does alpha\nbot: a bot\nplugin/commands/go.md: goes"));
});

test("measureBudgets finds nothing but the empty listing in a repo without a plugin", () => {
  const measured = measureBudgets(mkdtempSync(join(tmpdir(), "token-budget-empty-")));
  assert.deepEqual(measured.map(({ path }) => path), [LISTING_ENTRY]);
});

test("budgetProblems accepts equality and a gain inside the tolerance and names each other case", () => {
  const measured = [{ group: "skill", path: "a.md", tokens: 1000 }];
  assert.deepEqual(budgetProblems(measured, { "a.md": 1000 }), []);
  assert.deepEqual(budgetProblems(measured, { "a.md": 1000 + Math.floor(1000 * GAIN_TOLERANCE) }), []);
  assert.match(budgetProblems(measured, { "a.md": 999 })[0], /a\.md grew to 1000 estimated tokens, over its budget of 999/);
  assert.match(budgetProblems(measured, { "a.md": 1100 })[0], /a\.md shrank to 1000 .*lock in the gain: run node scripts\/audit\/token-budget\.ts --update-baseline/);
  assert.match(budgetProblems(measured, {})[0], /a\.md is a new instruction file: add its budget/);
  assert.match(budgetProblems(measured, { "a.md": 1000, "b.md": 5 })[0], /budgets b\.md, which no longer exists/);
});

test("the script updates the baseline, then passes, then fails on growth", () => {
  const dir = scratchRepo();
  const updated = runScript(dir, ["--update-baseline"]);
  assert.equal(updated.status, 0, updated.stderr);
  const budgets = JSON.parse(readFileSync(join(dir, BASELINE_FILE), "utf8")).budgets;
  assert.equal(budgets[SKILL_PATH], estimateTokens(readFileSync(join(dir, SKILL_PATH), "utf8")));

  const unchanged = runScript(dir);
  assert.equal(unchanged.status, 0, unchanged.stderr);

  write(dir, SKILL_PATH, `${readFileSync(join(dir, SKILL_PATH), "utf8")}${"x".repeat(GROWN_BODY_CHARACTERS)}`);
  const grown = runScript(dir);
  assert.equal(grown.status, 1);
  assert.match(grown.stderr, /SKILL\.md grew to/);
});

test("the script fails without a baseline and prints its table largest first", () => {
  const dir = scratchRepo();
  write(dir, "plugin/references/big.md", "y".repeat(GROWN_BODY_CHARACTERS));
  const missing = runScript(dir);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /evals\/token-budget\.json is missing/);
  const rows = missing.stdout.split("\n").filter((line) => line.startsWith("reference"));
  assert.match(rows[0], /big\.md/);
  assert.match(missing.stdout, /ESTIMATED tokens/);
});

test("measureBudgets rejects a repo root that does not exist", () => {
  assert.throws(() => measureBudgets(join(tmpdir(), "token-budget-no-such-repo")), /must exist to measure its instruction files/);
});

test("readBaseline returns null without a file and rejects a file with no budgets table", () => {
  const dir = scratchRepo();
  assert.equal(readBaseline(dir), null);
  write(dir, BASELINE_FILE, JSON.stringify({ estimator: "x" }));
  assert.throws(() => readBaseline(dir), /must hold a "budgets" object/);
  write(dir, BASELINE_FILE, JSON.stringify({ budgets: { "a.md": 3 } }));
  assert.deepEqual(readBaseline(dir), { "a.md": 3 });
});
