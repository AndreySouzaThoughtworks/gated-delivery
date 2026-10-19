// Behaviour check for the PostToolUse formatter. Run: node --test plugin/hooks/
// Every test works in a throwaway temp dir; nothing touches this repo.
//
// COVERAGE BOUNDARY: real prettier's own formatting is NOT exercised — that is prettier's test
// suite, and this repo carries no package.json to install one from. What IS covered is the whole
// contract that belongs to the hook: every guard clause, the CLI it resolves, the flag it passes,
// and the invariants that matter operationally — never block an edit, never throw, never touch a
// file it was not handed. Verified by deleting each guard in a copy: every deletion fails a test.
//
// Each work dir gets a fake `prettier` package that records its arguments AND honours `--write`,
// rather than inheriting whatever the machine has installed — otherwise these tests pass here and
// fail on any box with a resolvable prettier, for a hook that behaved correctly. Honouring the flag
// is what makes the end-state assertion mean something: dropping `--write` leaves real prettier
// printing to stdout and changing nothing, which an argument log alone cannot distinguish.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "format-on-edit.mjs");

const logDir = mkdtempSync(join(tmpdir(), "gated-delivery-format-log-"));
const invocationLog = join(logDir, "invocations.log");
writeFileSync(invocationLog, "");

/** Invocations recorded since the last reset. */
const invocations = () => readFileSync(invocationLog, "utf8").trim();
const resetInvocations = () => writeFileSync(invocationLog, "");

const run = (cwd, input) =>
  execFileSync("node", [HOOK], {
    cwd,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });

// Where each major version of prettier puts its CLI, as declared in its own package.json.
const V3 = { bin: "./bin/prettier.cjs" };
const V2 = { bin: { prettier: "./bin-prettier.js" } };

/**
 * A work dir holding a fake `prettier` package that records its arguments and then fails.
 *
 * Recording is the point. A fake that only fails makes "the guard skipped it" and "the hook ran it
 * and the toolchain refused" produce identical observable output — so asserting on the file's end
 * state passes even with the guards deleted. Asserting on the log distinguishes them.
 */
const workdir = (layout = V3) => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-format-test-"));
  const pkg = join(dir, "node_modules", "prettier");
  const rel = typeof layout.bin === "string" ? layout.bin : layout.bin.prettier;
  const cli = join(pkg, rel);
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "prettier", version: "0.0.0", exports: { "./*": "./*" }, ...layout }),
  );
  // The fake honours `--write` the way prettier does: without it prettier prints to stdout and
  // leaves the file alone. Recording the arguments alone could not tell those apart — a hook that
  // dropped the flag would still "invoke prettier" while silently formatting nothing.
  writeFileSync(
    cli,
    [
      `const fs = require("node:fs");`,
      `const args = process.argv.slice(2);`,
      `fs.appendFileSync(${JSON.stringify(invocationLog)}, args.join(" ") + "\\n");`,
      `if (args.includes("--write")) fs.writeFileSync(args[args.length - 1], ${JSON.stringify(FORMATTED)});`,
      `process.exit(1);`,
    ].join("\n"),
  );
  return dir;
};

// Deliberately badly formatted, so a real prettier run would visibly change it. FORMATTED is what
// the fake CLI writes back when it is given `--write`.
const UNFORMATTED = "const   x={a:1,   b:2}\n";
const FORMATTED = "const x = { a: 1, b: 2 };\n";

test("extension guard: never reaches prettier for a non-formattable file", () => {
  const dir = workdir();
  writeFileSync(join(dir, "img.png"), UNFORMATTED);
  resetInvocations();
  assert.equal(run(dir, { tool_input: { file_path: "img.png" } }), "");
  assert.equal(invocations(), "", "prettier must not be invoked for .png");
  assert.equal(readFileSync(join(dir, "img.png"), "utf8"), UNFORMATTED);
});

test("existence guard: never reaches prettier for a missing file", () => {
  resetInvocations();
  assert.equal(run(workdir(), { tool_input: { file_path: "gone.ts" } }), "");
  assert.equal(invocations(), "", "prettier must not be invoked for a path that doesn't exist");
});

test("input guard: never reaches prettier without a file_path", () => {
  for (const input of [{}, { tool_input: {} }, { tool_input: { file_path: "" } }]) {
    resetInvocations();
    assert.equal(run(workdir(), input), "", `expected silence for ${JSON.stringify(input)}`);
    assert.equal(invocations(), "", `prettier must not be invoked for ${JSON.stringify(input)}`);
  }
});

test("does reach prettier for a formattable file, and never blocks when it fails", () => {
  // The positive half of the guard tests above: without this, deleting a guard would be invisible
  // because "skipped" and "attempted" would both show an empty log.
  //
  // The file assertion is the part that matters: the fake only rewrites when `--write` is present,
  // so a hook that invoked prettier WITHOUT the flag — printing to stdout, changing nothing, the way
  // real prettier behaves — would satisfy the log assertion and fail here.
  const dir = workdir();
  writeFileSync(join(dir, "a.ts"), UNFORMATTED);
  resetInvocations();
  assert.equal(run(dir, { tool_input: { file_path: "a.ts" } }), "", "must exit 0 despite the failure");
  assert.match(invocations(), /--write .*a\.ts/, "prettier must be invoked for .ts");
  assert.equal(readFileSync(join(dir, "a.ts"), "utf8"), FORMATTED, "the edited file must be rewritten");
});

test("finds the CLI wherever the installed prettier declares it", () => {
  // Prettier 2 ships `bin-prettier.js` at the package root, 3 ships `bin/prettier.cjs`. Hard-coding
  // either path silently stops formatting every repo on the other major.
  for (const layout of [V3, V2]) {
    const dir = workdir(layout);
    writeFileSync(join(dir, "a.ts"), UNFORMATTED);
    resetInvocations();
    assert.equal(run(dir, { tool_input: { file_path: "a.ts" } }), "");
    assert.match(invocations(), /--write .*a\.ts/, `not found for ${JSON.stringify(layout.bin)}`);
  }
});

test("no prettier in the repo: silent no-op, never a crash", () => {
  // A repo without prettier is the common case for a plugin installed everywhere. Resolution fails,
  // and the hook must exit 0 having run nothing at all.
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-format-bare-"));
  writeFileSync(join(dir, "a.ts"), UNFORMATTED);
  resetInvocations();
  assert.equal(run(dir, { tool_input: { file_path: "a.ts" } }), "");
  assert.equal(invocations(), "", "nothing must be spawned when prettier cannot be resolved");
  assert.equal(readFileSync(join(dir, "a.ts"), "utf8"), UNFORMATTED);
});

test("accepts every extension it claims to format without throwing", () => {
  const dir = workdir();
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml"];
  for (const ext of exts) {
    const name = `f${ext}`;
    writeFileSync(join(dir, name), ext === ".json" ? '{"a":1}' : UNFORMATTED);
    resetInvocations();
    assert.equal(run(dir, { tool_input: { file_path: name } }), "", `threw on ${ext}`);
    assert.notEqual(invocations(), "", `${ext} is claimed formattable but never reached prettier`);
  }
});

test("fails open on unusable stdin", () => {
  for (const input of ["", "not json"]) {
    resetInvocations();
    assert.equal(run(workdir(), input), "", `expected silence for stdin: ${input || "<empty>"}`);
    assert.equal(invocations(), "", "unparseable stdin must not reach prettier");
  }
});
