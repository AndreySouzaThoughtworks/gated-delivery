#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inventoryProblems } from "./rule-inventory.ts";
import type { Inventory } from "./rule-inventory.ts";

const EXIT_SURVIVOR_OR_BAD_INVENTORY = 1;
const EXIT_USAGE = 2;
const PERCENT = 100;

const inventoryPath = process.argv[2];
if (!inventoryPath) {
  console.error("usage: node scripts/audit/rule-inventory-mutation.ts <inventory.json>");
  process.exit(EXIT_USAGE);
}

const root = process.cwd();
const inventory: Inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const sources = [inventory.file, ...(inventory.files ?? [])];
const scratch = mkdtempSync(join(tmpdir(), "rule-inventory-mutation-"));
for (const source of sources) {
  mkdirSync(dirname(join(scratch, source)), { recursive: true });
  cpSync(join(root, source), join(scratch, source));
}

const baseline = inventoryProblems(scratch, inventoryPath, inventory);
if (baseline.length) {
  for (const problem of baseline) console.error(`  ERROR ${problem}`);
  console.error("the inventory fails before any mutation; a score would credit collateral failures. Fix it first.");
  rmSync(scratch, { recursive: true, force: true });
  process.exit(EXIT_SURVIVOR_OR_BAD_INVENTORY);
}

const originals = new Map(sources.map((source) => [source, readFileSync(join(scratch, source), "utf8")]));
const mutants: { id: string; source: string; line: number; killed: boolean }[] = [];
for (const rule of inventory.rules) {
  for (const [source, original] of originals) {
    const lines = original.split("\n");
    lines.forEach((text, index) => {
      if (!text.includes(rule.anchor)) return;
      writeFileSync(join(scratch, source), lines.filter((_, other) => other !== index).join("\n"));
      mutants.push({ id: rule.id, source, line: index + 1, killed: inventoryProblems(scratch, inventoryPath, inventory).some((problem) => problem.includes(`anchor "${rule.anchor}" is in none`)) });
      writeFileSync(join(scratch, source), original);
    });
  }
}
rmSync(scratch, { recursive: true, force: true });

for (const mutant of mutants) console.log(`  ${mutant.killed ? "killed  " : "SURVIVED"} ${mutant.id} (${mutant.source}:${mutant.line})`);
const killedCount = mutants.filter((mutant) => mutant.killed).length;
console.log(`mutation score: ${killedCount}/${mutants.length} (${(PERCENT * killedCount / Math.max(1, mutants.length)).toFixed(1)}%)`);

const anchorsOf = inventory.rules.map(({ anchor }) => anchor);
const nonBlankLines = [...originals.values()].flatMap((text) => text.split("\n")).filter((line) => line.trim() !== "");
const unprotected = nonBlankLines.filter((line) => !anchorsOf.some((anchor) => line.includes(anchor)));
console.log(`unprotected share: ${(PERCENT * unprotected.length / Math.max(1, nonBlankLines.length)).toFixed(1)}% (${unprotected.length} of ${nonBlankLines.length} non-blank lines hold no rule anchor)`);

for (const rule of inventory.rules) {
  const occurrences = mutants.filter((mutant) => mutant.id === rule.id).length;
  if (occurrences > 1) console.log(`  weak anchor ${rule.id}: occurs on ${occurrences} lines`);
}
if (killedCount < mutants.length) process.exit(EXIT_SURVIVOR_OR_BAD_INVENTORY);
