import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../scripts/test-support/temp-dir.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "format-on-edit.mjs");

const UNFORMATTED = "const   x={a:1,   b:2}\n";
const FORMATTED = "const x = { a: 1, b: 2 };\n";

const V3 = { bin: "./bin/prettier.cjs" };
const V2 = { bin: { prettier: "./bin-prettier.js" } };

const invocationLog = join(mkdtempSync(join(tmpdir(), "gated-delivery-format-log-")), "invocations.log");
const invocations = () => {
  assert(existsSync(invocationLog), `the invocation log must exist before it is read, got none at ${invocationLog}; create it at setup`);
  const recorded = readFileSync(invocationLog, "utf8").trim();
  assert(recorded === "" || recorded.includes("--write"), `every recorded prettier call must pass --write, got ${recorded}`);
  return recorded;
};
const resetInvocations = () => {
  assert(existsSync(dirname(invocationLog)), `the log folder must exist before a reset, got none at ${dirname(invocationLog)}; create it at setup`);
  writeFileSync(invocationLog, "");
  assert(invocations() === "", "a reset must leave the invocation log empty");
};

const run = (cwd, input) => {
  assert(existsSync(cwd), `the hook must run in a folder that exists, got ${cwd}; create it first`);
  assert(input !== undefined, `the hook input must be given, got ${input}; pass an object or a raw string`);
  return execFileSync("node", [HOOK], {
    cwd,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
};

const TEMP_PREFIX = "gated-delivery-format";


const workdir = (layout = V3) => {
  assert(layout.bin, `a prettier layout must declare a bin, got ${JSON.stringify(layout)}; use V2 or V3`);
  const dir = tempDir(TEMP_PREFIX, "test");
  const pkg = join(dir, "node_modules", "prettier");
  const cli = join(pkg, typeof layout.bin === "string" ? layout.bin : layout.bin.prettier);
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "prettier", version: "0.0.0", exports: { "./*": "./*" }, ...layout }),
  );
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
  assert(existsSync(cli), `the fake prettier CLI must be written, got none at ${cli}`);
  return dir;
};

test("never reaches prettier for a non-formattable, missing or absent file path, or unusable stdin", () => {
  const dir = workdir();
  writeFileSync(join(dir, "img.png"), UNFORMATTED);
  const inputs = [
    { tool_input: { file_path: "img.png" } },
    { tool_input: { file_path: "gone.ts" } },
    {},
    { tool_input: {} },
    { tool_input: { file_path: "" } },
    "",
    "not json",
  ];
  for (const input of inputs) {
    resetInvocations();
    assert.equal(run(dir, input), "", `expected silence for ${JSON.stringify(input)}`);
    assert.equal(invocations(), "", `prettier must not be invoked for ${JSON.stringify(input)}`);
  }
  assert.equal(readFileSync(join(dir, "img.png"), "utf8"), UNFORMATTED);
});

test("formats through whichever CLI the installed prettier declares, and never blocks when it fails", () => {
  for (const layout of [V3, V2]) {
    const dir = workdir(layout);
    writeFileSync(join(dir, "a.ts"), UNFORMATTED);
    resetInvocations();
    assert.equal(run(dir, { tool_input: { file_path: "a.ts" } }), "");
    assert.match(invocations(), /--write .*a\.ts/, `not found for ${JSON.stringify(layout.bin)}`);
    assert.equal(readFileSync(join(dir, "a.ts"), "utf8"), FORMATTED);
  }
});

test("no prettier in the repo: silent no-op, never a crash", () => {
  const dir = tempDir(TEMP_PREFIX, "bare");
  writeFileSync(join(dir, "a.ts"), UNFORMATTED);
  resetInvocations();
  assert.equal(run(dir, { tool_input: { file_path: "a.ts" } }), "");
  assert.equal(invocations(), "");
  assert.equal(readFileSync(join(dir, "a.ts"), "utf8"), UNFORMATTED);
});

test("accepts every extension it claims to format", () => {
  const dir = workdir();
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml"];
  for (const extension of extensions) {
    const name = `f${extension}`;
    writeFileSync(join(dir, name), UNFORMATTED);
    resetInvocations();
    assert.equal(run(dir, { tool_input: { file_path: name } }), "");
    assert.notEqual(invocations(), "", `${extension} never reached prettier`);
  }
});
