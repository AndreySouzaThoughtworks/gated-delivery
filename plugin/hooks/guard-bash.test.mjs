import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "guard-bash.mjs");

const spawnHook = (input) => execFileSync("node", [HOOK], { input, encoding: "utf8" });

const decide = (command) => {
  const out = spawnHook(JSON.stringify({ tool_input: { command } }));
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
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
    assert.equal(decide(command), "deny", `expected deny: ${command}`);
  }
});

test("allows everything else", () => {
  for (const command of ALLOWED) {
    assert.equal(decide(command), "allow", `expected allow: ${command}`);
  }
});

test("fails open on unusable input", () => {
  for (const input of ["", "not json", "{}", '{"tool_input":{}}']) {
    const out = spawnHook(input);
    assert.equal(out, "", `expected allow (empty stdout) for: ${input || "<empty>"}`);
  }
});
