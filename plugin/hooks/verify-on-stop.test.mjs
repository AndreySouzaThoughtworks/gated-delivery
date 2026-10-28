import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "verify-on-stop.mjs");

const ORPHAN_SETTLE_MS = 3000;
const FAILING_COMMAND = "sh -c 'exit 1'";
const PASSING_COMMAND = "sh -c 'exit 0'";
const SRC_LINT_SCRIPT = 'eslint "{src,apps,libs,test}/**/*.ts"';

const tempDir = (label) => mkdtempSync(join(tmpdir(), `gated-delivery-verify-${label}-`));

const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: "ignore" });

const writeIn = (dir, name, body) => writeFileSync(join(dir, name), body);

const makeRepo = ({ dirty, pkg = true, lint = "true" }) => {
  const dir = tempDir("test");
  git(dir, ["init", "-q", "--template="]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeIn(dir, "file.ts", "const one = 1;\n");
  if (pkg) writeIn(dir, "package.json", JSON.stringify({ scripts: { lint } }));
  git(dir, ["add", "."]);
  git(dir, ["commit", "-qm", "init"]);
  if (dirty) writeIn(dir, "file.ts", "const two = 2;\n");
  return dir;
};

const repoUnder = (parent, name, options) => {
  const dir = join(parent, name);
  renameSync(makeRepo(options), dir);
  return dir;
};

const freshLockFile = () => join(tempDir("lock"), "verify.lock");

const run = (cwd, { verifyCmd, maxBlocks, sessionId, rawInput, env = {}, hook = HOOK } = {}) => {
  const out = execFileSync("node", [hook], {
    cwd,
    encoding: "utf8",
    input: rawInput ?? JSON.stringify({ session_id: sessionId ?? `t-${randomUUID()}` }),
    env: {
      ...process.env,
      GATED_DELIVERY_VERIFY_LOCK: freshLockFile(),
      ...(verifyCmd ? { GATED_DELIVERY_VERIFY_CMD: verifyCmd } : {}),
      ...(maxBlocks ? { GATED_DELIVERY_VERIFY_MAX_BLOCKS: String(maxBlocks) } : {}),
      ...env,
    },
  });
  return out ? JSON.parse(out) : null;
};

const VERIFICATION_SECTION = (cmd) => `# Client\n\n## Verification\n\n- **Verify command:** \`${cmd}\`\n\n## Other\n`;

const holdLock = (lockFile) =>
  new Promise((ready, failed) => {
    const holder = spawn("perl", [
      "-e",
      'use Fcntl qw(:flock); open(my $fh, ">>", $ARGV[0]) or die; flock($fh, LOCK_EX) or die; $| = 1; print "held\\n"; sleep 60',
      lockFile,
    ]);
    holder.stdout.once("data", () => ready(holder));
    holder.once("error", failed);
  });

const withLockHeld = async (lockFile, action) => {
  const holder = await holdLock(lockFile);
  return Promise.resolve().then(action).finally(() => holder.kill());
};

const LOCK_PROBE = (lockFile) =>
  `perl -e 'use Fcntl qw(:flock); open(my $fh, ">>", $ARGV[0]) or die; exit(flock($fh, LOCK_EX | LOCK_NB) ? 0 : 1)' "${lockFile}"`;

const dirtyFile = (dir, file, body = "x\n") => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeIn(dir, file, body);
  git(dir, ["add", file]);
  git(dir, ["commit", "-qm", `add ${file}`]);
  writeIn(dir, file, `${body}// changed\n`);
};

const dirtyAsset = (dir) => dirtyFile(dir, "assets/shot.png", "not really a png\n");

test("allows a clean tree without running the verify command", () => {
  assert.equal(run(makeRepo({ dirty: false }), { verifyCmd: FAILING_COMMAND }), null);
});

test("allows when the verify command passes", () => {
  assert.equal(run(makeRepo({ dirty: true }), { verifyCmd: PASSING_COMMAND }), null);
});

test("blocks when there are uncommitted changes and verify fails", () => {
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "fail.sh", "echo CAPTURED_STDOUT_MARKER\nexit 1\n");
  const result = run(dir, { verifyCmd: "sh fail.sh" });
  assert.equal(result?.decision, "block");
  assert.match(result.reason, /Verification gate/);
  assert.match(result.reason, /block 1\/3/);
  assert.match(result.reason, /CAPTURED_STDOUT_MARKER/);
});

test("never runs a Verify command from the repo's own CLAUDE.md", () => {
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "pwn.sh", "touch PWNED\n");
  writeIn(dir, "CLAUDE.md", VERIFICATION_SECTION("sh pwn.sh"));
  run(dir);
  assert.equal(existsSync(join(dir, "PWNED")), false);
});

test("finds the Verification section in a CLAUDE.md above the repo", () => {
  const parent = tempDir("parent");
  const dir = repoUnder(parent, "repo", { dirty: true });
  writeIn(dir, "fail.sh", "echo FROM_PARENT_MARKER\nexit 1\n");
  writeIn(parent, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  const result = run(dir, { env: { HOME: parent } });
  assert.match(result?.reason ?? "", /FROM_PARENT_MARKER/);
});

test("never reads a CLAUDE.md committed in an outer repo around a nested repo", () => {
  const home = tempDir("nested");
  const outer = repoUnder(home, "outer", { dirty: false });
  writeIn(outer, "pwn.sh", `touch "${join(outer, "PWNED")}"\n`);
  writeIn(outer, "CLAUDE.md", VERIFICATION_SECTION(`sh ${join(outer, "pwn.sh")}`));
  git(outer, ["add", "CLAUDE.md", "pwn.sh"]);
  git(outer, ["commit", "-qm", "untrusted instructions"]);
  const inner = repoUnder(outer, "vendor-lib", { dirty: true });
  run(inner, { env: { HOME: home } });
  assert.equal(existsSync(join(outer, "PWNED")), false);
});

test("never follows a CLAUDE.md that is a symlink", () => {
  const parent = tempDir("symlink");
  const dir = repoUnder(parent, "repo", { dirty: true });
  const elsewhere = tempDir("elsewhere");
  writeIn(elsewhere, "pwn.sh", `touch "${join(elsewhere, "PWNED")}"\n`);
  writeIn(elsewhere, "CLAUDE.md", VERIFICATION_SECTION(`sh ${join(elsewhere, "pwn.sh")}`));
  symlinkSync(join(elsewhere, "CLAUDE.md"), join(parent, "CLAUDE.md"));
  run(dir, { env: { HOME: parent } });
  assert.equal(existsSync(join(elsewhere, "PWNED")), false);
});

test("never reads a CLAUDE.md above the home folder", () => {
  const outer = tempDir("outer");
  const home = join(outer, "home");
  mkdirSync(home);
  const dir = repoUnder(home, "repo", { dirty: true });
  writeIn(dir, "fail.sh", "echo ABOVE_HOME_MARKER\nexit 1\n");
  writeIn(outer, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  const result = run(dir, { env: { HOME: home } });
  assert.doesNotMatch(result?.reason ?? "", /ABOVE_HOME_MARKER/);
});

test("reads no CLAUDE.md at all for a repo outside the home folder", () => {
  const parent = tempDir("outside");
  const dir = repoUnder(parent, "repo", { dirty: true });
  writeIn(dir, "fail.sh", "echo OUTSIDE_HOME_MARKER\nexit 1\n");
  writeIn(parent, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  const result = run(dir, { env: { HOME: tempDir("otherhome") } });
  assert.doesNotMatch(result?.reason ?? "", /OUTSIDE_HOME_MARKER/);
});

test("blocks with a timeout reason when the verify command hangs", () => {
  const result = run(makeRepo({ dirty: true }), { verifyCmd: "sleep 3", env: { GATED_DELIVERY_VERIFY_TIMEOUT_MS: "200" } });
  assert.equal(result?.decision, "block");
  assert.match(result.reason, /timed out/);
});

test("a verify command that reads stdin gets end-of-input instead of hanging", () => {
  const result = run(makeRepo({ dirty: true }), { verifyCmd: "cat >/dev/null && exit 0", env: { GATED_DELIVERY_VERIFY_TIMEOUT_MS: "2000" } });
  assert.equal(result, null);
});

test("a timeout also stops processes the verify command started", async () => {
  const dir = makeRepo({ dirty: true });
  const orphanMarker = join(dir, "ORPHAN");
  run(dir, {
    verifyCmd: `sh -c '(sleep 2; touch "${orphanMarker}") & sleep 5'`,
    env: { GATED_DELIVERY_VERIFY_TIMEOUT_MS: "300" },
  });
  await delay(ORPHAN_SETTLE_MS);
  assert.equal(existsSync(orphanMarker), false);
});

test("allows without running the verify command while another run holds the verify lock", async () => {
  const lockFile = freshLockFile();
  const holder = await holdLock(lockFile);
  try {
    const dir = makeRepo({ dirty: true });
    writeIn(dir, "fail.sh", "touch RAN\nexit 1\n");
    const opts = { verifyCmd: "sh fail.sh", maxBlocks: 1, sessionId: `busy-${randomUUID()}`, env: { GATED_DELIVERY_VERIFY_LOCK: lockFile } };
    const busy = run(dir, opts);
    assert.equal(busy?.decision, undefined);
    assert.match(busy?.systemMessage ?? "", /skipped/);
    assert.equal(existsSync(join(dir, "RAN")), false);
    holder.kill();
    await new Promise((done) => holder.once("close", done));
    assert.equal(run(dir, opts)?.decision, "block", "a busy lock must not have counted as a block");
  } finally {
    holder.kill();
  }
});

test("runs the verify command while holding the verify lock, and a failure still blocks", () => {
  const dir = makeRepo({ dirty: true });
  const lockFile = freshLockFile();
  writeIn(dir, "fail.sh", `touch RAN\n${LOCK_PROBE(lockFile)} || touch LOCKED\nexit 1\n`);
  const result = run(dir, { verifyCmd: "sh fail.sh", env: { GATED_DELIVERY_VERIFY_LOCK: lockFile } });
  assert.equal(result?.decision, "block");
  assert.equal(existsSync(join(dir, "RAN")), true);
  assert.equal(existsSync(join(dir, "LOCKED")), true);
});

test("runs unlocked when the lock wrapper is missing", async () => {
  const hookDir = tempDir("nowrapper");
  const hook = join(hookDir, "verify-on-stop.mjs");
  copyFileSync(HOOK, hook);
  mkdirSync(join(hookDir, "lib"));
  copyFileSync(join(dirname(HOOK), "lib", "read-hook-input.mjs"), join(hookDir, "lib", "read-hook-input.mjs"));
  const lockFile = freshLockFile();
  await withLockHeld(lockFile, () => {
    const dir = makeRepo({ dirty: true });
    writeIn(dir, "fail.sh", "touch RAN\nexit 1\n");
    const result = run(dir, { hook, verifyCmd: "sh fail.sh", env: { GATED_DELIVERY_VERIFY_LOCK: lockFile } });
    assert.equal(result?.decision, "block");
    assert.equal(existsSync(join(dir, "RAN")), true);
  });
});

test("GATED_DELIVERY_VERIFY_CMD overrides the CLAUDE.md Verify command", () => {
  const parent = tempDir("override");
  const dir = repoUnder(parent, "repo", { dirty: true });
  writeIn(dir, "fail.sh", "exit 1\n");
  writeIn(parent, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  assert.equal(run(dir, { verifyCmd: PASSING_COMMAND, env: { HOME: parent } }), null);
});

test("self-caps: releases the gate after MAX_CONSECUTIVE_BLOCKS", () => {
  const dir = makeRepo({ dirty: true });
  const opts = { verifyCmd: FAILING_COMMAND, maxBlocks: 2, sessionId: `cap-${randomUUID()}` };
  assert.equal(run(dir, opts)?.decision, "block", "1st blocks");
  assert.equal(run(dir, opts)?.decision, "block", "2nd blocks");
  assert.equal(run(dir, opts), null, "3rd exceeds the cap and must allow");
});

test("the release is sticky: the gate stays down for the rest of the session", () => {
  const dir = makeRepo({ dirty: true });
  const opts = { verifyCmd: FAILING_COMMAND, maxBlocks: 1, sessionId: `sticky-${randomUUID()}` };
  assert.equal(run(dir, opts)?.decision, "block", "1st blocks");
  assert.equal(run(dir, opts), null, "cap exceeded, releases");
  assert.equal(run(dir, opts), null, "stays released");
  assert.equal(run(makeRepo({ dirty: false }), opts), null, "a clean turn allows");
  assert.equal(run(dir, opts), null, "a clean turn does not wipe the release");
});

test("skips the run when nothing lint-able changed", () => {
  const dir = makeRepo({ dirty: false });
  dirtyAsset(dir);
  assert.equal(run(dir, { verifyCmd: FAILING_COMMAND }), null);
});

test("runs when the only change is a new untracked lint-able file", () => {
  const dir = makeRepo({ dirty: false });
  writeIn(dir, "new.test.ts", "test('x', () => {});\n");
  assert.equal(run(dir, { verifyCmd: FAILING_COMMAND })?.decision, "block");
});

test("a new untracked asset alone still skips the run", () => {
  const dir = makeRepo({ dirty: false });
  mkdirSync(join(dir, "docs"));
  writeIn(join(dir, "docs"), "screenshot.png", "png");
  assert.equal(run(dir, { verifyCmd: FAILING_COMMAND }), null);
});

test("git-ignored files do not count as changes", () => {
  const dir = makeRepo({ dirty: false });
  writeIn(dir, ".gitignore", "build/\n");
  git(dir, ["add", ".gitignore"]);
  git(dir, ["commit", "-qm", "ignore build"]);
  mkdirSync(join(dir, "build"));
  writeIn(join(dir, "build"), "out.js", "x\n");
  assert.equal(run(dir, { verifyCmd: FAILING_COMMAND }), null);
});

test("skips when the change is outside the roots the repo's lint script names", () => {
  const dir = makeRepo({ dirty: false, lint: SRC_LINT_SCRIPT });
  dirtyFile(dir, "docs/notes.md", "# hello\n");
  assert.equal(run(dir, { verifyCmd: "pnpm lint" }), null);
});

test("runs when the change is inside those roots", () => {
  const dir = makeRepo({ dirty: false, lint: SRC_LINT_SCRIPT });
  dirtyFile(dir, "src/a.ts", "const a = 1;\n");
  assert.equal(run(dir, { verifyCmd: "pnpm lint" })?.decision, "block");
});

test("a root-level config edit is in scope, whatever the roots say", () => {
  for (const config of ["eslint.config.mjs", "tsconfig.json", ".prettierrc", ".eslintrc"]) {
    const dir = makeRepo({ dirty: false, lint: SRC_LINT_SCRIPT });
    dirtyFile(dir, config, "{}\n");
    assert.equal(run(dir, { verifyCmd: "pnpm lint" })?.decision, "block", `${config} must be in scope`);
  }
});

test("a lint script naming no roots falls back to the extension filter", () => {
  const dir = makeRepo({ dirty: false, lint: "turbo run lint --continue" });
  dirtyFile(dir, "docs/notes.md", "# hello\n");
  assert.equal(run(dir, { verifyCmd: "pnpm lint" })?.decision, "block");
});

test("still runs when a lint-able file changed alongside an asset", () => {
  const dir = makeRepo({ dirty: true });
  dirtyAsset(dir);
  assert.equal(run(dir, { verifyCmd: FAILING_COMMAND })?.decision, "block");
});

test("no-ops when the repo has no lint script", () => {
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "package.json", JSON.stringify({ scripts: {} }));
  assert.equal(run(dir), null);
});

test("no package.json stands the gate down even with an explicit non-pnpm override", () => {
  const dir = makeRepo({ dirty: true, pkg: false });
  assert.equal(run(dir, { verifyCmd: FAILING_COMMAND }), null);
});

test("fails open on unusable stdin", () => {
  const dir = makeRepo({ dirty: true });
  for (const input of ["", "not json", "null", "42", "[]", '{"session_id":42}']) {
    assert.equal(run(dir, { rawInput: input, verifyCmd: PASSING_COMMAND }), null, `expected allow for stdin: ${input || "<empty>"}`);
  }
});
