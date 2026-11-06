import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { write, validRepo, runGuard, STRICT_TSC_FLAGS } from "../test-support/consistency-fixtures.test.support.ts";

test("a plugin file, tests included, that imports TypeScript is reported", () => {
  const importers: Record<string, string> = {
    "plugin/hooks/h.test.mjs": 'import { tempDir } from "../../scripts/test-support/temp-dir.ts";\n',
    "plugin/hooks/h.mjs": 'const helper = await import("./helper.mts");\n',
    "plugin/hooks/h.cjs": 'const helper = require("./helper.cts");\n',
  };
  for (const [file, body] of Object.entries(importers)) {
    const dir = validRepo();
    write(dir, file, body);
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, `${file} imports TypeScript, expected the guard to fail, got ${code}: ${out}`);
    assert.match(out, new RegExp(`${file.replace(/\./g, "\\.")} must not import TypeScript`));
  }
});

test("a plugin file that imports .mjs or only mentions .ts text stays silent", () => {
  const dir = validRepo();
  write(dir, "plugin/hooks/h.test.mjs", 'import { tempDir } from "../../scripts/test-support/temp-dir.mjs";\nconst name = "a.ts";\n');
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /must not import TypeScript/);
});

test("check numbers that repeat or skip one are reported, a contiguous run and lettered sub-checks pass", () => {
  const dir = validRepo();
  write(dir, "scripts/audit/consistency.ts", "// --- 1. A ---\n// --- 2. B ---\n// --- 2a. B sub-check ---\n// --- 3. C ---\n");
  const clean = runGuard(dir);
  assert.equal(clean.code, 0, clean.out);

  write(dir, "scripts/audit/consistency.ts", "// --- 1. A ---\n// --- 2. B ---\n// --- 2. C ---\n// --- 3. D ---\n");
  const duplicate = runGuard(dir);
  assert.equal(duplicate.code, 1, duplicate.out);
  assert.match(duplicate.out, /numbers 2 checks 2\. Hint:/);

  write(dir, "scripts/audit/consistency.ts", "// --- 1. A ---\n// --- 2. B ---\n// --- 4. D ---\n");
  const gap = runGuard(dir);
  assert.equal(gap.code, 1, gap.out);
  assert.match(gap.out, /has no check 3 but numbers up to 4\. Hint:/);

  write(dir, "scripts/audit/consistency.ts", "// --- 2. B ---\n// --- 3. C ---\n");
  const missingFirst = runGuard(dir);
  assert.equal(missingFirst.code, 1, missingFirst.out);
  assert.match(missingFirst.out, /has no check 1 but numbers up to 3/);
});

const CURSOR_HOOKS = ".cursor/hooks.json";
const cursorHooks = (hook: { command: string; failClosed?: boolean }) => {
  assert(hook.command.length > 0, `a hook needs a command, got ${JSON.stringify(hook)}`);
  const config = JSON.stringify({ version: 1, hooks: { beforeShellExecution: [hook] } });
  assert(config.includes(hook.command), `the config must carry the command ${hook.command}, got ${config}`);
  return config;
};

test("a Cursor config that points at real files and fails closed passes; a missing script, an open guard or a stray rule fails", () => {
  const dir = validRepo();
  write(dir, "AGENTS.md", "Rules. See `zanity.toml` and `scripts/cursor/guard.mjs`.\n");
  write(dir, "scripts/cursor/guard.mjs", "process.exit(0);\n");
  write(dir, CURSOR_HOOKS, cursorHooks({ command: "node scripts/cursor/guard.mjs", failClosed: true }));
  write(dir, ".cursor/rules/repo.mdc", "---\nalwaysApply: true\n---\nFollow AGENTS.md.\n");
  const clean = runGuard(dir);
  assert.equal(clean.code, 0, clean.out);

  write(dir, CURSOR_HOOKS, cursorHooks({ command: "node scripts/cursor/gone.mjs", failClosed: true }));
  const missing = runGuard(dir);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /beforeShellExecution runs scripts\/cursor\/gone\.mjs, which does not exist/);

  write(dir, CURSOR_HOOKS, cursorHooks({ command: "node scripts/cursor/guard.mjs" }));
  const open = runGuard(dir);
  assert.equal(open.code, 1);
  assert.match(open.out, /must set "failClosed": true/);

  write(dir, CURSOR_HOOKS, cursorHooks({ command: "node scripts/cursor/guard.mjs", failClosed: true }));
  write(dir, ".cursor/rules/stray.md", "ignored by Cursor\n");
  write(dir, ".cursor/rules/loose.mdc", "---\nalwaysApply: true\n---\nProse that duplicates the rules.\n");
  const stray = runGuard(dir);
  assert.equal(stray.code, 1);
  assert.match(stray.out, /stray\.md is not \.mdc/);
  assert.match(stray.out, /loose\.mdc does not point at AGENTS\.md/);

  write(dir, "AGENTS.md", "See `docs/gone.md`.\n");
  const dangling = runGuard(dir);
  assert.match(dangling.out, /AGENTS\.md names docs\/gone\.md, which does not exist/);
});

test("tsc must keep the flags that find dead and unchecked code", () => {
  const accepted = validRepo();
  assert.equal(runGuard(accepted).code, 0, "the strict tsconfig must pass");
  for (const flag of Object.keys(STRICT_TSC_FLAGS)) {
    const dir = validRepo();
    write(dir, "tsconfig.json", JSON.stringify({ compilerOptions: { ...STRICT_TSC_FLAGS, [flag]: false } }));
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, `${flag} turned off must fail the guard, got ${code}: ${out}`);
    assert.match(out, new RegExp(`compilerOptions\\.${flag} to true, got false`));
  }
  const missing = validRepo();
  write(missing, "tsconfig.json", JSON.stringify({ compilerOptions: {} }));
  assert.match(runGuard(missing).out, /compilerOptions\.noUnusedLocals to true, got undefined/);
});

test("the repo must carry a license that the README links", () => {
  assert.equal(runGuard(validRepo()).code, 0, "a license file linked from the README must pass");
  const blank = validRepo();
  write(blank, "LICENSE", "  \n");
  assert.match(runGuard(blank).out, /LICENSE is missing or empty/);
  const missing = validRepo();
  rmSync(join(missing, "LICENSE"));
  assert.match(runGuard(missing).out, /LICENSE is missing or empty/);
  const unlinked = validRepo();
  write(unlinked, "README.md", "The plugin — 1 skills, 1 agents, 1 hooks.\n");
  assert.match(runGuard(unlinked).out, /README\.md does not link LICENSE/);
});
