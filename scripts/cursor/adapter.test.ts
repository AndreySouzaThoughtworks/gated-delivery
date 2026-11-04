import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEditedFile } from "./adapter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "guard-shell.mjs");
const FORMAT = join(HERE, "format-edit.mjs");
const EXIT_OK = 0;
const EXIT_BLOCK = 2;
const ESCAPE_VARIABLE = "GATED_DELIVERY_GUARD";
const FORMATTED_MARKER = "formatted.marker";

const run = (script: string, input: string, options: { cwd?: string; env?: Record<string, string> } = {}) => {
  assert(typeof input === "string", `the hook input must be text, got ${typeof input}`);
  const result = spawnSync(process.execPath, [script], {
    input,
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, [ESCAPE_VARIABLE]: "", ...options.env },
  });
  assert(result.status !== null, `the hook must exit on its own, got signal ${result.signal}`);
  return result;
};

const cursorShellPayload = (command: unknown) => {
  const payload = JSON.stringify({ command, cwd: "/tmp", sandbox: false, hook_event_name: "beforeShellExecution" });
  assert(payload.includes("beforeShellExecution"), `the payload must name its event, got ${payload}`);
  assert(JSON.parse(payload).command === command,`the payload must carry the command ${JSON.stringify(command)}, got ${payload}`);
  return payload;
};

test("a catastrophic command is denied with Cursor's deny JSON and exit 0", () => {
  const { status, stdout } = run(GUARD, cursorShellPayload("rm -rf /"));
  assert.equal(status, EXIT_OK);
  const answer = JSON.parse(stdout);
  assert.equal(answer.permission, "deny");
  assert.match(answer.user_message, /recursive force-delete/);
  assert.match(answer.agent_message, /recursive force-delete/);
});

test("a force-push to main is denied", () => {
  const { stdout } = run(GUARD, cursorShellPayload("git push --force origin main"));
  assert.equal(JSON.parse(stdout).permission, "deny");
});

test("a harmless command is allowed, so the deny cases are not a blanket refusal", () => {
  const { status, stdout, stderr } = run(GUARD, cursorShellPayload("git push origin feat/x:refs/heads/feat/x"));
  assert.equal(status, EXIT_OK);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { permission: "allow" });
});

test("malformed JSON fails closed: exit 2 and a deny", () => {
  const { status, stdout, stderr } = run(GUARD, "{not json");
  assert.equal(status, EXIT_BLOCK);
  assert.equal(JSON.parse(stdout).permission, "deny");
  assert.match(stderr, /could not check/);
});

test("empty stdin fails closed", () => {
  const { status, stdout } = run(GUARD, "");
  assert.equal(status, EXIT_BLOCK);
  assert.equal(JSON.parse(stdout).permission, "deny");
});

test("a payload with no command, or a non-string command, fails closed", () => {
  for (const payload of [JSON.stringify({ cwd: "/tmp" }), cursorShellPayload(42), cursorShellPayload(null)]) {
    const { status, stdout } = run(GUARD, payload);
    assert.equal(status, EXIT_BLOCK, `payload ${payload} must be blocked, got exit ${status}`);
    assert.equal(JSON.parse(stdout).permission, "deny");
  }
});

test("a payload that parses to JSON but not to an object fails closed", () => {
  for (const payload of ["null", "42", "[]", '"text"']) {
    const { status, stdout } = run(GUARD, payload);
    assert.equal(status, EXIT_BLOCK, `payload ${payload} must be blocked, got exit ${status}`);
    assert.equal(JSON.parse(stdout).permission, "deny");
  }
});

test("a format hook that cannot start is reported, not swallowed", () => {
  const missingDirectory = join(tmpdir(), "cursor-format-test-missing-directory");
  assert.throws(() => formatEditedFile(JSON.stringify({ file_path: "a.ts" }), missingDirectory), /the format hook must start/);
});

test("the documented escape variable turns the guard off", () => {
  const { status, stdout } = run(GUARD, cursorShellPayload("rm -rf /"), { env: { [ESCAPE_VARIABLE]: "off" } });
  assert.equal(status, EXIT_OK);
  assert.deepEqual(JSON.parse(stdout), { permission: "allow" });
});

const repoWithFakePrettier = () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-format-test-"));
  assert(existsSync(dir), `mkdtemp must create ${dir}`);
  const prettier = join(dir, "node_modules", "prettier");
  mkdirSync(prettier, { recursive: true });
  writeFileSync(join(prettier, "package.json"), JSON.stringify({ name: "prettier", version: "3.0.0", bin: "cli.cjs" }));
  writeFileSync(join(prettier, "cli.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(join(dir, FORMATTED_MARKER))}, process.argv.slice(2).join(" "));\n`);
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "a.ts"), "const a=1\n");
  writeFileSync(join(dir, "a.bin"), "x");
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  return dir;
};

test("an edited formattable file reaches prettier with its absolute path", () => {
  const dir = repoWithFakePrettier();
  const file = join(dir, "a.ts");
  const { status } = run(FORMAT, JSON.stringify({ file_path: file, edits: [] }), { cwd: dir });
  assert.equal(status, EXIT_OK);
  assert(existsSync(join(dir, FORMATTED_MARKER)), `prettier must have run for ${file}`);
});

test("a non-formattable file, a missing path and malformed input never reach prettier and never fail", () => {
  const dir = repoWithFakePrettier();
  for (const input of [JSON.stringify({ file_path: join(dir, "a.bin") }), JSON.stringify({}), "{not json", ""]) {
    const { status } = run(FORMAT, input, { cwd: dir });
    assert.equal(status, EXIT_OK, `input ${input} must exit ${EXIT_OK}, got ${status}`);
  }
  const marker = join(dir, FORMATTED_MARKER);
  assert(!existsSync(marker), `prettier must not have run for any of these inputs, yet ${marker} exists`);
});
