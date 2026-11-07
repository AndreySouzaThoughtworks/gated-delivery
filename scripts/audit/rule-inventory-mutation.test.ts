import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULELESS_INVENTORY_LINE_LIMIT } from "./rule-inventory.ts";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "rule-inventory-mutation.ts");
const SKILL = "skills/s/SKILL.md";
const INVENTORY = "inventory.json";
const NEVER_MERGE = { id: "s.no-merge", anchor: "Never merge PRs", kind: "never", why: "a person merges" };
const STOP_ON_DIRTY = { id: "s.stop-dirty", anchor: "STOP on a dirty tree", kind: "stop", why: "dirty trees stop" };

const scratchRepo = (skillText: string, rules: object[]) => {
  assert(typeof skillText === "string", `the skill needs text, got ${typeof skillText}`);
  assert(Array.isArray(rules), `the inventory needs a rule array, got ${typeof rules}`);
  const dir = mkdtempSync(join(tmpdir(), "rule-inventory-mutation-test-"));
  mkdirSync(join(dir, dirname(SKILL)), { recursive: true });
  writeFileSync(join(dir, SKILL), skillText);
  writeFileSync(join(dir, INVENTORY), JSON.stringify({ file: SKILL, rules, exempt: [] }));
  return dir;
};
const runTool = (dir: string, args: string[]) => {
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  const result = spawnSync("node", [TOOL, ...args], { cwd: dir, encoding: "utf8" });
  assert(result.status !== null, `the tool must exit, got signal ${result.signal}`);
  return { code: result.status, out: result.stdout + result.stderr };
};

test("every rule whose anchor sits on one line is killed, scored 100%, and the unprotected share is reported", () => {
  const dir = scratchRepo("Never merge PRs.\nSTOP on a dirty tree.\nsome prose\n", [NEVER_MERGE, STOP_ON_DIRTY]);
  const { code, out } = runTool(dir, [INVENTORY]);
  assert.equal(code, 0, out);
  assert.match(out, /mutation score: 2\/2 \(100\.0%\)/);
  assert.match(out, /unprotected share: 33\.3% \(1 of 3 non-blank lines/);
  assert.doesNotMatch(out, /SURVIVED/);
});

test("a rule whose anchor also sits on a line another rule guards survives deleting one copy, and the tool exits 1", () => {
  const dir = scratchRepo("Never merge PRs.\nNever merge PRs without STOP on a dirty tree.\n", [NEVER_MERGE, STOP_ON_DIRTY]);
  const { code, out } = runTool(dir, [INVENTORY]);
  assert.equal(code, 1, out);
  assert.match(out, /SURVIVED s\.no-merge \(skills\/s\/SKILL\.md:1\)/);
  assert.match(out, /SURVIVED s\.no-merge \(skills\/s\/SKILL\.md:2\)/);
  assert.match(out, /killed {3}s\.stop-dirty/);
  assert.match(out, /mutation score: 1\/3 \(33\.3%\)/);
  assert.match(out, /weak anchor s\.no-merge: occurs on 2 lines/);
});

test("an inventory that already fails is refused instead of scored", () => {
  const dir = scratchRepo("Never merge PRs.\n", [{ ...NEVER_MERGE, anchor: "Auto-merge PRs" }]);
  const { code, out } = runTool(dir, [INVENTORY]);
  assert.equal(code, 1, out);
  assert.match(out, /fails before any mutation/);
  assert.doesNotMatch(out, /mutation score/);
});

test("running without an inventory path prints usage and exits 2", () => {
  const { code, out } = runTool(scratchRepo("x\n", []), []);
  assert.equal(code, 2, out);
  assert.match(out, /usage: node scripts\/audit\/rule-inventory-mutation\.ts <inventory\.json>/);
});

test("a ruleless inventory over a long file is refused instead of scored 0/0", () => {
  const longSkill = Array.from({ length: RULELESS_INVENTORY_LINE_LIMIT + 1 }, (_, index) => `line ${index}`).join("\n");
  const { code, out } = runTool(scratchRepo(longSkill, []), [INVENTORY]);
  assert.equal(code, 1, out);
  assert.match(out, /no rules guard 31 lines/);
  assert.doesNotMatch(out, /mutation score/);
});
