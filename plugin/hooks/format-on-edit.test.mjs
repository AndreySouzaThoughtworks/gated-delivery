import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "format-on-edit.mjs");

const UNFORMATTED = "const   x={a:1,   b:2}\n";
const FORMATTED = "const x = { a: 1, b: 2 };\n";

const V3 = { bin: "./bin/prettier.cjs" };
const V2 = { bin: { prettier: "./bin-prettier.js" } };

const invocationLog = join(mkdtempSync(join(tmpdir(), "gated-delivery-format-log-")), "invocations.log");
const invocations = () => readFileSync(invocationLog, "utf8").trim();
const resetInvocations = () => writeFileSync(invocationLog, "");

const run = (cwd, input) =>
  execFileSync("node", [HOOK], {
    cwd,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });

const tempDir = (label) => mkdtempSync(join(tmpdir(), `gated-delivery-format-${label}-`));

const workdir = (layout = V3) => {
  const dir = tempDir("test");
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
  return dir;
};

const editOf = (file_path) => ({ tool_input: { file_path } });

test("never reaches prettier for a non-formattable, missing or absent file path, or unusable stdin", () => {
  const dir = workdir();
  writeFileSync(join(dir, "img.png"), UNFORMATTED);
  const inputs = [
    editOf("img.png"),
    editOf("gone.ts"),
    {},
    { tool_input: {} },
    editOf(""),
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
    assert.equal(run(dir, editOf("a.ts")), "");
    assert.match(invocations(), /--write .*a\.ts/, `not found for ${JSON.stringify(layout.bin)}`);
    assert.equal(readFileSync(join(dir, "a.ts"), "utf8"), FORMATTED);
  }
});

test("no prettier in the repo: silent no-op, never a crash", () => {
  const dir = tempDir("bare");
  writeFileSync(join(dir, "a.ts"), UNFORMATTED);
  resetInvocations();
  assert.equal(run(dir, editOf("a.ts")), "");
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
    assert.equal(run(dir, editOf(name)), "");
    assert.notEqual(invocations(), "", `${extension} never reached prettier`);
  }
});
