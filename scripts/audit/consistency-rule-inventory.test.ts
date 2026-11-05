import { test } from "node:test";
import assert from "node:assert/strict";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";

const INVENTORIED_SKILL = "plugin/skills/alpha/SKILL.md";
const INVENTORY_PATH = "evals/rules/skill-alpha.json";
const RULE_LINE = "Never merge a pull request.";
const MARKER_ONLY_LINE = "Always say so.";
const SKILL_FRONTMATTER = "---\nname: alpha\ndescription: x\n---\n\n";
const NO_MERGE_RULE = { id: "alpha.no-merge", anchor: "Never merge", kind: "never", why: "a person merges" };

const withInventory = (inventory: object, skillBody = `${RULE_LINE}\n`) => {
  assert(typeof inventory === "object" && inventory !== null, `the inventory must be an object, got ${typeof inventory}`);
  assert(skillBody.length > 0, `the skill body must not be empty, got ${skillBody.length} characters`);
  const dir = validRepo();
  write(dir, INVENTORIED_SKILL, SKILL_FRONTMATTER + skillBody);
  write(dir, INVENTORY_PATH, JSON.stringify(inventory));
  return dir;
};
const inventoryOf = (overrides: object = {}) => {
  const inventory = { file: INVENTORIED_SKILL, rules: [NO_MERGE_RULE], exempt: [], ...overrides };
  assert(typeof inventory.file === "string", `an inventory names its file, got ${typeof inventory.file}`);
  assert(Array.isArray(inventory.rules), `an inventory lists rules, got ${typeof inventory.rules}`);
  return inventory;
};

test("a consistent rule inventory passes, and an exempt entry covers a marker line that is no rule", () => {
  const consistent = runGuard(withInventory(inventoryOf()));
  assert.equal(consistent.code, 0, consistent.out);
  assert.doesNotMatch(consistent.out, /WARN|ERROR/);
  const exempted = withInventory(inventoryOf({ exempt: [{ anchor: "say so", reason: "restates the merge rule" }] }), `${RULE_LINE}\n${MARKER_ONLY_LINE}\n`);
  assert.equal(runGuard(exempted).code, 0);
});

test("a rule anchor that is no longer in the file is reported", () => {
  const dir = withInventory(inventoryOf({ rules: [{ ...NO_MERGE_RULE, anchor: "Auto-merge PRs" }] }));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /anchor "Auto-merge PRs" is in none of plugin\/skills\/alpha\/SKILL\.md/);
});

test("an exempt anchor that is no longer in the file is reported", () => {
  const dir = withInventory(inventoryOf({ exempt: [{ anchor: "gone phrase", reason: "restates the merge rule" }] }));
  assert.match(runGuard(dir).out, /anchor "gone phrase" is in none of/);
});

test("a marker line that no rule or exempt anchor covers is reported with file, line and hint", () => {
  const { code, out } = runGuard(withInventory(inventoryOf(), `${RULE_LINE}\n${MARKER_ONLY_LINE}\n`));
  assert.equal(code, 1, out);
  assert.match(out, /plugin\/skills\/alpha\/SKILL\.md:7 Always say so\./);
  assert.match(out, /add a rule with an anchor or an exempt entry with a reason/);
});

test("a marker line in an extra file of the inventory must be covered too", () => {
  const dir = withInventory(inventoryOf({ files: ["plugin/skills/alpha/references/more.md"] }));
  write(dir, "plugin/skills/alpha/references/more.md", "Never skip a gate.\n");
  assert.match(runGuard(dir).out, /references\/more\.md:1 Never skip a gate\./);
  const covered = withInventory(inventoryOf({ files: ["plugin/skills/alpha/references/more.md"], rules: [NO_MERGE_RULE, { ...NO_MERGE_RULE, id: "alpha.no-skip", anchor: "skip a gate" }] }));
  write(covered, "plugin/skills/alpha/references/more.md", "Never skip a gate.\n");
  assert.equal(runGuard(covered).code, 0);
});

test("a duplicate rule id is reported", () => {
  const dir = withInventory(inventoryOf({ rules: [NO_MERGE_RULE, { ...NO_MERGE_RULE, anchor: "pull request" }] }));
  assert.match(runGuard(dir).out, /rule id alpha\.no-merge is used twice/);
});

test("an exempt entry with a blank reason is reported", () => {
  const dir = withInventory(inventoryOf({ exempt: [{ anchor: "say so", reason: "  " }] }), `${RULE_LINE}\n${MARKER_ONLY_LINE}\n`);
  assert.match(runGuard(dir).out, /exempt entry "say so" has a blank reason/);
});

test("an inventory whose file does not exist is reported", () => {
  const dir = withInventory(inventoryOf({ file: "plugin/skills/alpha/MISSING.md" }));
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /plugin\/skills\/alpha\/MISSING\.md does not exist/);
});

test("a blank anchor, an unknown kind and unreadable JSON are reported", () => {
  const blankAnchor = runGuard(withInventory(inventoryOf({ rules: [{ ...NO_MERGE_RULE, anchor: " " }] })));
  assert.match(blankAnchor.out, /blank anchor, which matches every line/);
  const unknownKind = runGuard(withInventory(inventoryOf({ rules: [{ ...NO_MERGE_RULE, kind: "wish" }] })));
  assert.match(unknownKind.out, /rule alpha\.no-merge has kind "wish"/);
  const unreadable = validRepo();
  write(unreadable, INVENTORY_PATH, "{ not json");
  assert.match(runGuard(unreadable).out, /skill-alpha\.json is not a usable inventory/);
});

test("an inventory missing its file, rules or exempt key is reported by name", () => {
  const { file, rules, exempt } = inventoryOf();
  const cases = [
    { inventory: { rules, exempt }, expected: /must name the instruction file in "file"/ },
    { inventory: { file, exempt }, expected: /must list its "rules" as an array/ },
    { inventory: { file, rules }, expected: /must list its "exempt" entries as an array/ },
  ];
  for (const { inventory, expected } of cases) {
    const { code, out } = runGuard(withInventory(inventory));
    assert.equal(code, 1, out);
    assert.match(out, expected);
  }
});

test("a file with marker lines and no inventory warns with its marker count, and a non-inventory json file is ignored", () => {
  const dir = validRepo();
  write(dir, INVENTORIED_SKILL, `${SKILL_FRONTMATTER}${RULE_LINE}\n${MARKER_ONLY_LINE}\n`);
  write(dir, "evals/rules/notes.txt", "ignored");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.match(out, /WARN {2}no rule inventory for plugin\/skills\/alpha\/SKILL\.md: 2 marker lines/);
});

test("a section headed with NOT counts every line under it as a marker line", () => {
  const body = `${RULE_LINE}\n\n## What it does NOT do\n\n- Auto-merge PRs.\n\n## Next\n\nplain\n`;
  const dir = withInventory(inventoryOf(), body);
  assert.match(runGuard(dir).out, /SKILL\.md:10 - Auto-merge PRs\./);
  assert.doesNotMatch(runGuard(dir).out, /SKILL\.md:14 plain/);
});
