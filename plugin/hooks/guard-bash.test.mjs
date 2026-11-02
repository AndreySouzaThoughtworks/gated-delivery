import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { evaluate } from "./lib/guard-core.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "guard-bash.mjs");

const PERMISSION_FIELD = '"permissionDecision"';
const DECISIONS = ["allow", "deny"];

const ESCAPE_VARIABLE = "GATED_DELIVERY_GUARD";
const EXIT_OK = 0;
const EXIT_BLOCK = 2;

const runHook = (input, env = {}) => {
  assert(input !== undefined, `the hook input must be given, got ${input}; pass a raw string`);
  const result = spawnSync("node", [HOOK], { input, encoding: "utf8", env: { ...process.env, [ESCAPE_VARIABLE]: "", ...env } });
  assert(result.status !== null, `the hook must exit on its own, got signal ${result.signal}`);
  return result;
};

const spawnHook = (input) => {
  const { status, stdout, stderr } = runHook(input);
  assert(status === EXIT_OK && stderr === "", `the hook must exit ${EXIT_OK} with empty stderr, got ${status} and ${stderr}`);
  assert(stdout === "" || stdout.includes(PERMISSION_FIELD), `the hook must stay silent or name a permission decision, got ${stdout}`);
  return stdout;
};

const decisionFor = (command) => {
  assert(command.length > 0, `a command under test must not be blank, got ${JSON.stringify(command)}; name the command`);
  const out = spawnHook(JSON.stringify({ tool_input: { command } }));
  const decision = out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
  assert(DECISIONS.includes(decision), `the decision for ${command} must be one of ${DECISIONS}, got ${decision}`);
  return decision;
};

const DENIED = [
  "rm -rf /",
  "rm -fr /",
  "rm -rf ~",
  "rm -rf $HOME",
  "rm -rf /*",
  "sudo rm -rf /",
  "rm -rf ~/",
  "rm -rf $HOME/",
  'rm -rf "$HOME"',
  "rm -rf '$HOME'",
  "rm -Rf /",
  "rm -fR /",
  "rm -r -f /",
  "rm -R -f ~",
  "rm --recursive --force /",
  "rm --force --recursive $HOME",
  "rm -r --force /",
  "git push --force origin main",
  "git push -f origin master",
  "git push origin main --force",
  "git push --force origin HEAD:main",
  "git push --force origin refs/heads/main",
  "git push --force origin refs/heads/master",
  "git push --force origin HEAD:refs/heads/main",
  "git push --force origin 'main'",
  'git push --force origin "main"',
  "git push --force origin main:main",
  "git push --force -- origin main",
  "git push origin +main",
  "git push origin +master",
  "git push origin +refs/heads/main",
  "git push origin +HEAD:main",
  "git push --force-with-lease origin main",
  ":(){ :|:& };:",
];

const ALLOWED = [
  "rm -rf ./build",
  "rm -rf node_modules",
  "rm -r -f ./build",
  "rm --recursive --force node_modules",
  "rm -R ./tmp",
  "rm -f /tmp/x.log",
  "ls -la /",
  "git push origin main",
  "git push --force origin my-feature",
  "git push --force origin fix/main-menu",
  "git push --force origin feature-main-thing",
  "git push --force origin maintenance",
  "git push --force-with-lease origin fix/main-menu",
  "git push --force origin release/main-line",
  "git push --force origin refs/heads/fix/main-menu",
  "git push origin +my-feature",
  "git push origin +fix/main-menu",
];

test("denies catastrophic commands", () => {
  for (const command of DENIED) {
    assert.equal(decisionFor(command), "deny", `expected deny: ${command}`);
  }
});

test("allows everything else", () => {
  for (const command of ALLOWED) {
    assert.equal(decisionFor(command), "allow", `expected allow: ${command}`);
  }
});

const REJECTED_INPUTS = ["not json", "", "null", "{}", '{"tool_input":{}}', '{"tool_input":{"command":5}}'];

test("closes the gate on unusable input", () => {
  for (const input of REJECTED_INPUTS) {
    const { status, stdout, stderr } = runHook(input);
    const label = input || "<empty>";
    assert.equal(status, EXIT_BLOCK, `expected exit ${EXIT_BLOCK} for: ${label}`);
    assert.equal(stdout, "", `expected empty stdout for: ${label}`);
    assert.ok(stderr.includes(ESCAPE_VARIABLE), `expected stderr to name ${ESCAPE_VARIABLE} for: ${label}, got ${stderr}`);
  }
});

test("closes the gate when deciding throws", () => {
  const { status, stdout, stderr } = evaluate(() => '{"tool_input":{"command":"ls"}}', {}, () => {
    throw new Error("decider exploded");
  });
  assert.equal(status, EXIT_BLOCK);
  assert.equal(stdout, "");
  assert.ok(stderr.includes("decider exploded") && stderr.includes(ESCAPE_VARIABLE), `got ${stderr}`);
});

test("closes the gate when reading stdin throws", () => {
  const unreadable = evaluate(() => {
    throw new Error("stdin unreadable");
  }, {});
  assert.equal(unreadable.status, EXIT_BLOCK);
});

test("escape hatch allows everything, even a bad payload", () => {
  const dangerous = JSON.stringify({ tool_input: { command: "rm -rf /" } });
  for (const input of [...REJECTED_INPUTS, dangerous]) {
    const { status, stdout } = runHook(input, { [ESCAPE_VARIABLE]: "off" });
    assert.equal(status, EXIT_OK, `expected allow for: ${input || "<empty>"}`);
    assert.equal(stdout, "", `expected empty stdout for: ${input || "<empty>"}`);
  }
});

test("a command prefix cannot use the escape hatch", () => {
  assert.equal(decisionFor("GATED_DELIVERY_GUARD=off rm -rf /"), "deny");
});

test("closes the gate on unusable input when the hook is launched through a symlink", () => {
  const linked = join(mkdtempSync(join(tmpdir(), "guard-bash-link-")), "guard-bash.mjs");
  symlinkSync(HOOK, linked);
  const { status, stdout, stderr } = spawnSync("node", [linked], { input: "not json", encoding: "utf8", env: { ...process.env, GATED_DELIVERY_GUARD: "" } });
  assert.equal(status, 2, `a hook started through a symlink must still close the gate, got status ${status} and stderr ${stderr}`);
  assert.equal(stdout, "", `a closed gate keeps stdout empty, got ${stdout}`);
  assert.match(stderr, /GATED_DELIVERY_GUARD/, "the message must name the escape hatch");
});
