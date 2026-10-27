// Behaviour check for the Bash guard. Run: node --test plugin/hooks/
// Spawns the real hook and feeds it the real stdin contract, so it tests what the harness sees.
// The hook only inspects a string — it never executes a command — so no row here deletes anything.
// The groups marked as former bypasses were live defects, found by probing rather than by reading.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "guard-bash.mjs");

const DECISIONS = ["allow", "deny"];

const spawnHook = (input) => {
  assert(typeof input === "string", `the hook reads stdin as text, got ${typeof input}`);
  const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
  assert(typeof out === "string", `the hook writes text to stdout, got ${typeof out}`);
  return out;
};

const decide = (command) => {
  assert(typeof command === "string", `a command is text, got ${typeof command}`);
  const out = spawnHook(JSON.stringify({ tool_input: { command } }));
  const decision = out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
  assert(DECISIONS.includes(decision), `the hook decided ${decision}, expected one of ${DECISIONS}`);
  return decision;
};

const DENIED = [
  "rm -rf /",
  "rm -fr /",
  "rm -rf ~",
  "rm -rf $HOME",
  "rm -rf /*",
  "sudo rm -rf /",
  // Former bypass: a trailing slash or a quote used to defeat the guard entirely.
  "rm -rf ~/",
  "rm -rf $HOME/",
  'rm -rf "$HOME"',
  "rm -rf '$HOME'",
  // Former bypass: the flag class was lowercase-only and wanted one combined flag word, so an uppercase R,
  // split flags and the long options all slipped through.
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
  // Former bypass: narrowing the boundary to fix the branch-name false positives opened a bypass — a
  // fully-qualified ref is preceded by `/`, so it slipped past a `(\s|:)`-only boundary.
  "git push --force origin refs/heads/main",
  "git push --force origin refs/heads/master",
  "git push --force origin HEAD:refs/heads/main",
  // Former bypass: quotes sit against the ref name, so they closed the boundary the same way `/` did.
  "git push --force origin 'main'",
  'git push --force origin "main"',
  "git push --force origin main:main",
  "git push --force -- origin main",
  // Former bypass: `+ref` force-pushes with no --force flag at all, so every flag-based pattern was blind to
  // it. The original guard missed these too.
  "git push origin +main",
  "git push origin +master",
  "git push origin +refs/heads/main",
  "git push origin +HEAD:main",
  // Denied on purpose: a lease protects other people's commits, it does not stop main being
  // rewritten.
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
  // Former false positive: `\b(main|master)\b` matched inside a branch name, so any branch containing "main" was
  // un-force-pushable.
  "git push --force origin fix/main-menu",
  "git push --force origin feature-main-thing",
  "git push --force origin maintenance",
  "git push --force-with-lease origin fix/main-menu",
  // Slash-prefixed but not the protected ref: the trailing boundary is what separates these from
  // `refs/heads/main`.
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
