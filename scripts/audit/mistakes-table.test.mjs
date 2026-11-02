import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOC = "docs/mistakes-to-rules.md";
const TABLE_HEADING = "## Mistakes caught by a rule";
const SECTION_END = "\n## ";
const HEADER_ROWS = 2;
const CELLS_PER_ROW = 4;
const RULE_CELL = 2;
const TEST_CELL = 3;
const BACKTICKED = /`([^`]+)`/g;
const TEST_REFERENCE = /`([^`]+)`\s*"([^"]+)"/g;
const GUARD_CHECK = /^check (\d+[a-z]?)$/;
const GUARD_FILE = "scripts/audit/consistency.mjs";
const ZANITY_CONFIG = "zanity.toml";
const TABLE_HEAD = `${TABLE_HEADING}\n\n| a | b | c | d |\n|---|---|---|---|\n`;
const REAL_TEST = '`scripts/audit/consistency.test.mjs` "rejects a reference that nothing reads"';
const REAL_RULE = "`check 8`";

const ruleProblems = (root, rule) => {
  assert(existsSync(root), `the repo root must exist, got ${root}`);
  assert(typeof rule === "string", `a rule cell must be text, got ${typeof rule}`);
  const problems = [];
  for (const [, token] of rule.matchAll(BACKTICKED)) {
    const guardCheck = token.match(GUARD_CHECK);
    if (guardCheck) {
      const header = new RegExp(`^// --- ${guardCheck[1]}\\. `, "m");
      if (!header.test(readFileSync(join(root, GUARD_FILE), "utf8"))) problems.push(`${token}: no section "${guardCheck[1]}." in ${GUARD_FILE}`);
    } else if (token.includes("/") || token.includes(".")) {
      if (!existsSync(join(root, token))) problems.push(`${token}: file does not exist`);
    } else if (!readFileSync(join(root, ZANITY_CONFIG), "utf8").includes(token)) {
      problems.push(`${token}: not a zanity rule named in ${ZANITY_CONFIG}`);
    }
  }
  assert(problems.every((problem) => problem.includes(": ")), `every problem must name its reference, got ${JSON.stringify(problems)}`);
  return problems;
};

const testProblems = (root, cell) => {
  assert(existsSync(root), `the repo root must exist, got ${root}`);
  assert(typeof cell === "string", `a test cell must be text, got ${typeof cell}`);
  const references = [...cell.matchAll(TEST_REFERENCE)];
  const problems = references.length === 0 ? [`no test named in "${cell}"`] : [];
  for (const [, file, title] of references) {
    if (!existsSync(join(root, file))) problems.push(`${file}: test file does not exist`);
    else if (!readFileSync(join(root, file), "utf8").includes(`"${title}"`)) problems.push(`${file}: no test titled "${title}"`);
  }
  assert(problems.every((problem) => problem.includes(": ") || problem.startsWith("no test named")), `every problem must name its file or the empty cell, got ${JSON.stringify(problems)}`);
  return problems;
};

const tableProblems = (root, markdown) => {
  assert(existsSync(root), `the repo root must exist, got ${root}`);
  const start = markdown.indexOf(TABLE_HEADING);
  assert(start >= 0, `${DOC} must hold the heading "${TABLE_HEADING}", got ${markdown.length} characters without it`);
  const section = markdown.slice(start + TABLE_HEADING.length).split(SECTION_END)[0];
  const rows = section.split("\n").filter((line) => line.startsWith("|")).slice(HEADER_ROWS);
  const problems = rows.length === 0 ? [`${DOC}: the table has no rows`] : [];
  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== CELLS_PER_ROW) problems.push(`row has ${cells.length} cells, not ${CELLS_PER_ROW}: ${row.slice(0, 60)}`);
    else problems.push(...ruleProblems(root, cells[RULE_CELL]), ...testProblems(root, cells[TEST_CELL]));
  }
  return problems;
};

test("every rule and test named in the mistakes table exists", () => {
  const problems = tableProblems(ROOT, readFileSync(join(ROOT, DOC), "utf8"));
  assert.deepStrictEqual(problems, [], `the table names things that do not exist: ${problems.join("; ")}`);
});

test("a row naming a missing script, guard check, zanity rule or test is rejected", () => {
  const bogus = {
    "a script that does not exist": ["`scripts/audit/nope.mjs`", REAL_TEST],
    "a guard check that does not exist": ["`check 99`", REAL_TEST],
    "a zanity rule that does not exist": ["`no-such-rule`", REAL_TEST],
    "a test title that does not exist": [REAL_RULE, '`scripts/audit/consistency.test.mjs` "no such test title"'],
    "a test file that does not exist": [REAL_RULE, '`scripts/audit/nope.test.mjs` "anything"'],
    "a row with no test": [REAL_RULE, "none"],
  };
  for (const [name, [rule, testCell]] of Object.entries(bogus)) {
    const problems = tableProblems(ROOT, `${TABLE_HEAD}| mistake | category | ${rule} | ${testCell} |\n`);
    assert(problems.length > 0, `${name} must be rejected, got ${problems.length} problems`);
  }
});

test("a row naming real references is accepted", () => {
  const rule = [REAL_RULE, "`assertion-density`", "`scripts/audit/suppressions.mjs`"].join(", ");
  const problems = tableProblems(ROOT, `${TABLE_HEAD}| mistake | category | ${rule} | ${REAL_TEST} |\n`);
  assert.deepStrictEqual(problems, [], `a real row was rejected: ${problems.join("; ")}`);
});
