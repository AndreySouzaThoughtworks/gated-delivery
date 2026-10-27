// Behaviour check for the Stop-hook verification gate. Run: node --test plugin/hooks/
// This hook BLOCKS turn-end, so its control flow is the highest-consequence untested code in the
// plugin. Each test builds a throwaway git repo under the OS temp dir; nothing touches this repo.
//
// GATED_DELIVERY_VERIFY_CMD is driven with a plain `sh` command rather than a pnpm script: the hook only
// consults package.json for pnpm-shaped commands (verifyScriptIsAbsent), so a shell command
// exercises the real verify → block → counter path without needing pnpm or a lint setup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "verify-on-stop.mjs");

const ORPHAN_SETTLE_MS = 3000;

const git = (cwd, args) => {
  assert(existsSync(cwd), `git needs an existing folder, got ${cwd}`);
  assert(Array.isArray(args) && args.length > 0, `git needs arguments, got ${args}`);
  const output = execFileSync("git", args, { cwd, stdio: "ignore" });
  assert(output === null, `git must run silently in ${cwd}, got ${output}`);
  return output;
};

const writeIn = (dir, name, body) => {
  assert(existsSync(dir), `the folder ${dir} must exist before writing ${name}`);
  assert(name.length > 0 && typeof body === "string", `a file needs a name and text, got ${name} and ${typeof body}`);
  const file = join(dir, name);
  writeFileSync(file, body);
  assert(readFileSync(file, "utf8") === body, `${file} must hold what was written`);
  return file;
};

/**
 * Throwaway git repo with one commit. `dirty` leaves an uncommitted change behind.
 * `pkg: false` omits package.json, which the hook treats as "not my kind of repo" — see the
 * dedicated test for that path.
 */
const makeRepo = ({ dirty, pkg = true, lint = "true" }) => {
  assert(typeof dirty === "boolean", `dirty must say whether to leave a change, got ${dirty}`);
  assert(lint.length > 0, `a fixture lint script must not be empty, got ${lint}`);
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-verify-test-"));
  // `--template=` opts out of the user's global init.templateDir. Without it, git copies in the
  // machine's pre-commit/pre-push hooks (signing, gitleaks) and they reject the commit below.
  git(dir, ["init", "-q", "--template="]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "file.ts"), "const one = 1;\n");
  if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint } }));
  git(dir, ["add", "."]);
  git(dir, ["commit", "-qm", "init"]);
  if (dirty) writeFileSync(join(dir, "file.ts"), "const two = 2;\n");
  assert(existsSync(join(dir, ".git")), `the fixture repo at ${dir} must be a git repo`);
  assert(readFileSync(join(dir, "file.ts"), "utf8").includes("two") === dirty, `file.ts in ${dir} must be changed exactly when dirty is ${dirty}`);
  return dir;
};

const freshLockFile = () => {
  assert(existsSync(tmpdir()), `the OS temp folder must exist, got ${tmpdir()}`);
  const lockFile = join(mkdtempSync(join(tmpdir(), "gated-delivery-verify-lock-")), "verify.lock");
  assert(existsSync(dirname(lockFile)), `the lock folder for ${lockFile} must exist`);
  assert(!existsSync(lockFile), `a fresh lock file must not exist yet, got ${lockFile}`);
  return lockFile;
};

const run = (cwd, { verifyCmd, maxBlocks, sessionId, rawInput, env = {}, hook = HOOK } = {}) => {
  assert(existsSync(cwd), `the hook needs an existing working folder, got ${cwd}`);
  const out = execFileSync("node", [hook], {
    cwd,
    encoding: "utf8",
    // The hook persists a block counter in tmpdir keyed by session_id, and those files outlive the
    // run. A pid is not enough — pids get reused, and a recycled one inherits the old count and
    // turns `block 1/3` into `block 2/3`. A uuid cannot collide.
    input: rawInput ?? JSON.stringify({ session_id: sessionId ?? `t-${randomUUID()}` }),
    env: {
      ...process.env,
      // Each run gets its own lock, so the suite never waits on — or blocks — this machine's real verify runs.
      GATED_DELIVERY_VERIFY_LOCK: freshLockFile(),
      ...(verifyCmd ? { GATED_DELIVERY_VERIFY_CMD: verifyCmd } : {}),
      ...(maxBlocks ? { GATED_DELIVERY_VERIFY_MAX_BLOCKS: String(maxBlocks) } : {}),
      ...env,
    },
  });
  const result = out ? JSON.parse(out) : null; // null = allowed (empty stdout)
  assert(result === null || typeof result === "object", `the hook must answer with nothing or an object, got ${out}`);
  return result;
};

test("allows a clean tree without running the verify command", () => {
  // A failing command proves the tree check short-circuits before the command runs.
  assert.equal(run(makeRepo({ dirty: false }), { verifyCmd: "sh -c 'exit 1'" }), null);
});

test("allows when the verify command passes", () => {
  assert.equal(run(makeRepo({ dirty: true }), { verifyCmd: "sh -c 'exit 0'" }), null);
});

test("blocks when there are uncommitted changes and verify fails", () => {
  // The marker lives in a SCRIPT, not in the command string. The reason interpolates VERIFY_CMD
  // verbatim, so any marker written inline would match the echoed command rather than its captured
  // output — an assertion that passes even if the hook stops forwarding output at all.
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "fail.sh", "echo CAPTURED_STDOUT_MARKER\nexit 1\n");
  const result = run(dir, { verifyCmd: "sh fail.sh" });
  assert.equal(result?.decision, "block");
  assert.match(result.reason, /Verification gate/);
  assert.match(result.reason, /block 1\/3/);
  assert.doesNotMatch(
    "sh fail.sh",
    /CAPTURED_STDOUT_MARKER/,
    "guard: the marker must not appear in the command text, or the next assertion is vacuous",
  );
  assert.match(
    result.reason,
    /CAPTURED_STDOUT_MARKER/,
    "the failing command's captured output must reach the reason",
  );
});

const VERIFICATION_SECTION = (cmd) => {
  assert(cmd.length > 0, `a Verify command must not be empty, got ${cmd}`);
  const section = `# Client\n\n## Verification\n\n- **Verify command:** \`${cmd}\`\n\n## Other\n`;
  assert(section.includes(cmd), `the section must carry ${cmd}`);
  return section;
};

test("never runs a Verify command from the repo's own CLAUDE.md", () => {
  // A cloned repo controls its own CLAUDE.md; running its command would execute untrusted code
  // at every turn end, outside Claude Code's permission prompts.
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "pwn.sh", "touch PWNED\n");
  writeIn(dir, "CLAUDE.md", VERIFICATION_SECTION("sh pwn.sh"));
  run(dir);
  assert.equal(existsSync(join(dir, "PWNED")), false, "the repo's CLAUDE.md command must not run");
});

test("finds the Verification section in a CLAUDE.md above the repo", () => {
  const parent = mkdtempSync(join(tmpdir(), "gated-delivery-verify-parent-"));
  const dir = join(parent, "repo");
  renameSync(makeRepo({ dirty: true }), dir);
  writeIn(dir, "fail.sh", "echo FROM_PARENT_MARKER\nexit 1\n");
  writeIn(parent, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  const result = run(dir, { env: { HOME: parent } });
  assert.match(result?.reason ?? "", /FROM_PARENT_MARKER/, "the parent CLAUDE.md command must have run");
});

test("never reads a CLAUDE.md committed in an outer repo around a nested repo", () => {
  // A vendored repo or submodule sits inside another repo; the folder above it is that outer,
  // untrusted repo, whose committed CLAUDE.md must not be executed.
  const home = mkdtempSync(join(tmpdir(), "gated-delivery-verify-nested-"));
  const outer = join(home, "outer");
  renameSync(makeRepo({ dirty: false }), outer);
  writeIn(outer, "pwn.sh", `touch "${join(outer, "PWNED")}"\n`);
  writeIn(outer, "CLAUDE.md", VERIFICATION_SECTION(`sh ${join(outer, "pwn.sh")}`));
  git(outer, ["add", "CLAUDE.md", "pwn.sh"]);
  git(outer, ["commit", "-qm", "untrusted instructions"]);
  const inner = join(outer, "vendor-lib");
  renameSync(makeRepo({ dirty: true }), inner);
  run(inner, { env: { HOME: home } });
  assert.equal(existsSync(join(outer, "PWNED")), false, "the outer repo's CLAUDE.md command must not run");
});

test("never follows a CLAUDE.md that is a symlink", () => {
  const parent = mkdtempSync(join(tmpdir(), "gated-delivery-verify-symlink-"));
  const dir = join(parent, "repo");
  renameSync(makeRepo({ dirty: true }), dir);
  const elsewhere = mkdtempSync(join(tmpdir(), "gated-delivery-verify-elsewhere-"));
  writeIn(elsewhere, "pwn.sh", `touch "${join(elsewhere, "PWNED")}"\n`);
  writeIn(elsewhere, "CLAUDE.md", VERIFICATION_SECTION(`sh ${join(elsewhere, "pwn.sh")}`));
  symlinkSync(join(elsewhere, "CLAUDE.md"), join(parent, "CLAUDE.md"));
  run(dir, { env: { HOME: parent } });
  assert.equal(existsSync(join(elsewhere, "PWNED")), false, "a symlinked CLAUDE.md must not be followed");
});

test("never reads a CLAUDE.md above the home folder", () => {
  // Folders above home (or shared ones like /tmp) may be writable by other users.
  const outer = mkdtempSync(join(tmpdir(), "gated-delivery-verify-outer-"));
  const home = join(outer, "home");
  mkdirSync(home);
  const dir = join(home, "repo");
  renameSync(makeRepo({ dirty: true }), dir);
  writeIn(dir, "fail.sh", "echo ABOVE_HOME_MARKER\nexit 1\n");
  writeIn(outer, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  const result = run(dir, { env: { HOME: home } });
  assert.doesNotMatch(result?.reason ?? "", /ABOVE_HOME_MARKER/, "a CLAUDE.md above home must not be read");
});

test("reads no CLAUDE.md at all for a repo outside the home folder", () => {
  const parent = mkdtempSync(join(tmpdir(), "gated-delivery-verify-outside-"));
  const dir = join(parent, "repo");
  renameSync(makeRepo({ dirty: true }), dir);
  writeIn(dir, "fail.sh", "echo OUTSIDE_HOME_MARKER\nexit 1\n");
  writeIn(parent, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  const result = run(dir, { env: { HOME: mkdtempSync(join(tmpdir(), "gated-delivery-verify-otherhome-")) } });
  assert.doesNotMatch(result?.reason ?? "", /OUTSIDE_HOME_MARKER/, "no CLAUDE.md outside home may be read");
});

test("blocks with a timeout reason when the verify command hangs", () => {
  const dir = makeRepo({ dirty: true });
  const result = run(dir, { verifyCmd: "sleep 3", env: { GATED_DELIVERY_VERIFY_TIMEOUT_MS: "200" } });
  assert.equal(result?.decision, "block");
  assert.match(result.reason, /timed out/);
});

test("a verify command that reads stdin gets end-of-input instead of hanging", () => {
  const dir = makeRepo({ dirty: true });
  assert.equal(run(dir, { verifyCmd: "cat >/dev/null && exit 0", env: { GATED_DELIVERY_VERIFY_TIMEOUT_MS: "2000" } }), null);
});

test("a timeout also stops processes the verify command started", async () => {
  // Killing only the shell leaves its children running, so a timed-out lint keeps working behind
  // the next turn's run.
  const dir = makeRepo({ dirty: true });
  const orphanMarker = join(dir, "ORPHAN");
  run(dir, {
    verifyCmd: `sh -c '(sleep 2; touch "${orphanMarker}") & sleep 5'`,
    env: { GATED_DELIVERY_VERIFY_TIMEOUT_MS: "300" },
  });
  await delay(ORPHAN_SETTLE_MS);
  assert.equal(existsSync(orphanMarker), false, "the verify command's child must be stopped with it");
});

/** Another process holding the verify lock, the way a background /slice verify does. */
const holdLock = (lockFile) => {
  assert(existsSync(dirname(lockFile)), `the lock folder for ${lockFile} must exist`);
  return new Promise((ready, failed) => {
    const holder = spawn("perl", [
      "-e",
      'use Fcntl qw(:flock); open(my $fh, ">>", $ARGV[0]) or die; flock($fh, LOCK_EX) or die; $| = 1; print "held\\n"; sleep 60',
      lockFile,
    ]);
    assert(holder.stdout !== null, `the lock holder for ${lockFile} must pipe its output`);
    holder.stdout.once("data", () => ready(holder));
    holder.once("error", failed);
  });
};

const withLockHeld = async (lockFile, action) => {
  assert(lockFile.length > 0, `a held lock needs a lock file, got ${lockFile}`);
  assert(typeof action === "function", `the action under the held lock must be a function, got ${typeof action}`);
  const holder = await holdLock(lockFile);
  try {
    assert(holder.pid > 0, `the lock holder for ${lockFile} must be a running process, got pid ${holder.pid}`);
    return await action();
  } finally {
    holder.kill();
    assert(holder.killed, `the lock holder for ${lockFile} must be stopped`);
  }
};

const LOCK_PROBE = (lockFile) => {
  assert(lockFile.length > 0, `the probe needs a lock file, got ${lockFile}`);
  const probe = `perl -e 'use Fcntl qw(:flock); open(my $fh, ">>", $ARGV[0]) or die; exit(flock($fh, LOCK_EX | LOCK_NB) ? 0 : 1)' "${lockFile}"`;
  assert(probe.includes(lockFile), `the probe must name ${lockFile}`);
  return probe;
};

test("allows without running the verify command while another run holds the verify lock", async () => {
  // A background /slice verify and this hook would otherwise fight over ports and containers.
  const lockFile = freshLockFile();
  const holder = await holdLock(lockFile);
  try {
    const dir = makeRepo({ dirty: true });
    writeIn(dir, "fail.sh", "touch RAN\nexit 1\n");
    const opts = { verifyCmd: "sh fail.sh", maxBlocks: 1, sessionId: `busy-${randomUUID()}`, env: { GATED_DELIVERY_VERIFY_LOCK: lockFile } };
    const busy = run(dir, opts);
    assert.equal(busy?.decision, undefined, "a held lock must allow the stop");
    assert.match(busy?.systemMessage ?? "", /skipped/, "a skipped verify must say so, never pass silently");
    assert.equal(existsSync(join(dir, "RAN")), false, "the verify command must not run while the lock is held");
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
  assert.equal(existsSync(join(dir, "RAN")), true, "the verify command must run when the lock is free");
  assert.equal(existsSync(join(dir, "LOCKED")), true, "the verify command must run under the lock");
});

test("runs unlocked when the lock wrapper is missing", async () => {
  const hookDir = mkdtempSync(join(tmpdir(), "gated-delivery-verify-nowrapper-"));
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
    assert.equal(existsSync(join(dir, "RAN")), true, "without the wrapper the command runs as before");
  });
});

test("GATED_DELIVERY_VERIFY_CMD overrides the CLAUDE.md Verify command", () => {
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "fail.sh", "exit 1\n");
  writeIn(dir, "CLAUDE.md", VERIFICATION_SECTION("sh fail.sh"));
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 0'" }), null);
});

test("self-caps: releases the gate after MAX_CONSECUTIVE_BLOCKS", () => {
  const dir = makeRepo({ dirty: true });
  const opts = { verifyCmd: "sh -c 'exit 1'", maxBlocks: 2, sessionId: `cap-${randomUUID()}` };
  assert.equal(run(dir, opts)?.decision, "block", "1st blocks");
  assert.equal(run(dir, opts)?.decision, "block", "2nd blocks");
  assert.equal(run(dir, opts), null, "3rd exceeds the cap and must allow, not loop forever");
});

test("the release is sticky: the gate stays down for the rest of the session", () => {
  // It used to reset the counter on release, so the very next turn started counting from zero and
  // the gate went block-block-block-release, block-block-block-release, forever. On a repo with
  // pre-existing lint debt that is every turn, plus a full lint run each time.
  const dir = makeRepo({ dirty: true });
  const opts = { verifyCmd: "sh -c 'exit 1'", maxBlocks: 1, sessionId: `sticky-${randomUUID()}` };
  assert.equal(run(dir, opts)?.decision, "block", "1st blocks");
  assert.equal(run(dir, opts), null, "cap exceeded — releases");
  assert.equal(run(dir, opts), null, "and stays released, rather than starting the loop again");

  // A clean or asset-only turn in between must not wipe the sentinel: those paths reset the counter,
  // and resetting a RELEASED session dropped it straight back into the block-block-block loop.
  assert.equal(run(makeRepo({ dirty: false }), opts), null, "a clean turn allows");
  assert.equal(run(dir, opts), null, "and the earlier release still holds");
});

/**
 * Commits an asset, then modifies it — a TRACKED dirty file the linter has no opinion about.
 * It lives in a subdirectory on purpose: anything at the repo root is in scope by definition
 * (that's where lint's own config lives), so a root-level fixture would never exercise this path.
 */
const dirtyAsset = (dir) => {
  assert(existsSync(dir), `the repo to dirty must exist, got ${dir}`);
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "shot.png"), "not really a png\n");
  git(dir, ["add", "assets/shot.png"]);
  git(dir, ["commit", "-qm", "asset"]);
  writeFileSync(join(dir, "assets", "shot.png"), "still not a png\n");
  assert(existsSync(join(dir, "assets", "shot.png")), `the dirty asset must exist under ${dir}`);
};

test("skips the run when nothing lint-able changed", () => {
  // A turn that only touched a screenshot shouldn't pay for a full lint pass.
  const dir = makeRepo({ dirty: false });
  dirtyAsset(dir);
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 1'" }), null);
});

test("runs when the only change is a new untracked lint-able file", () => {
  // Test-first work adds files before it modifies any; a gate that ignores untracked files never
  // verifies a turn that only wrote a new test.
  const dir = makeRepo({ dirty: false });
  writeIn(dir, "new.test.ts", "test('x', () => {});\n");
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 1'" })?.decision, "block");
});

test("a new untracked asset alone still skips the run", () => {
  const dir = makeRepo({ dirty: false });
  mkdirSync(join(dir, "docs"));
  writeIn(join(dir, "docs"), "screenshot.png", "png");
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 1'" }), null);
});

test("git-ignored files do not count as changes", () => {
  const dir = makeRepo({ dirty: false });
  writeIn(dir, ".gitignore", "build/\n");
  git(dir, ["add", ".gitignore"]);
  git(dir, ["commit", "-qm", "ignore build"]);
  mkdirSync(join(dir, "build"));
  writeIn(join(dir, "build"), "out.js", "x\n");
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 1'" }), null);
});

/** Commits `file` under `dir`, then modifies it — a tracked dirty file at a known path. */
const dirtyFile = (dir, file, body = "x\n") => {
  assert(existsSync(dir), `the repo to dirty must exist, got ${dir}`);
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeIn(dir, file, body);
  git(dir, ["add", file]);
  git(dir, ["commit", "-qm", `add ${file}`]);
  writeIn(dir, file, `${body}// changed\n`);
  assert(existsSync(join(dir, file)), `${file} must exist under ${dir} after dirtying it`);
};

test("skips when the change is outside the roots the repo's lint script names", () => {
  // A typical service lints `{src,apps,libs,test}/**/*.ts`. A doc edit is not in that set, so a full
  // eslint pass over the repo cannot fail for anything this turn did — running it is pure cost.
  // Driven through `pnpm lint` on purpose: the scope is read from the SCRIPT the verify command
  // names, so a bare `sh -c` command would never reach that lookup and the test would pass blind.
  const dir = makeRepo({ dirty: false, lint: 'eslint "{src,apps,libs,test}/**/*.ts"' });
  dirtyFile(dir, "docs/notes.md", "# hello\n");
  assert.equal(run(dir, { verifyCmd: "pnpm lint" }), null);
});

test("runs when the change is inside those roots", () => {
  const dir = makeRepo({ dirty: false, lint: 'eslint "{src,apps,libs,test}/**/*.ts"' });
  dirtyFile(dir, "src/a.ts", "const a = 1;\n");
  // No eslint installed in the fixture, so the script fails — which is the point: inside the roots
  // the gate actually runs the command.
  assert.equal(run(dir, { verifyCmd: "pnpm lint" })?.decision, "block");
});

test("a root-level config edit is in scope, whatever the roots say", () => {
  // `eslint.config.mjs`, `.eslintrc.*`, `package.json` and `tsconfig.json` sit at the root, so they
  // match no lint root — and they are exactly the files that change what lint reports.
  // `.prettierrc` and `.eslintrc` carry NO extension, so the extension filter drops them too — a
  // narrower rule keyed on file type would skip the gate on the very edits that change its verdict.
  for (const config of ["eslint.config.mjs", "tsconfig.json", ".prettierrc", ".eslintrc"]) {
    const dir = makeRepo({ dirty: false, lint: 'eslint "{src,apps,libs,test}/**/*.ts"' });
    dirtyFile(dir, config, "{}\n");
    assert.equal(run(dir, { verifyCmd: "pnpm lint" })?.decision, "block", `${config} must be in scope`);
  }
});

test("a lint script naming no roots falls back to the extension filter", () => {
  // `turbo run lint --continue` and `nx run-many -t lint` name no paths. Guessing would narrow the
  // gate silently, so an unreadable script means: run it.
  const dir = makeRepo({ dirty: false, lint: "turbo run lint --continue" });
  dirtyFile(dir, "docs/notes.md", "# hello\n");
  assert.equal(run(dir, { verifyCmd: "pnpm lint" })?.decision, "block");
});

test("still runs when a lint-able file changed alongside an asset", () => {
  const dir = makeRepo({ dirty: true });
  dirtyAsset(dir);
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 1'" })?.decision, "block");
});

test("no-ops when the repo has no lint script", () => {
  const dir = makeRepo({ dirty: true });
  writeIn(dir, "package.json", JSON.stringify({ scripts: {} }));
  assert.equal(run(dir), null, "default `pnpm lint` with no such script must stand down");
});

test("no package.json stands the gate down even with an explicit non-pnpm override", () => {
  // Pins current behaviour: verifyScriptIsAbsent() early-returns true on a missing package.json
  // BEFORE it checks whether the command is pnpm-shaped, so GATED_DELIVERY_VERIFY_CMD is not consulted here.
  // Defensible (no package.json = not a JS repo) but it does mean the override is silently
  // ignored. Change this test deliberately if that call is ever revisited.
  const dir = makeRepo({ dirty: true, pkg: false });
  assert.equal(run(dir, { verifyCmd: "sh -c 'exit 1'" }), null);
});

test("fails open on unusable stdin", () => {
  const dir = makeRepo({ dirty: true });
  for (const input of ["", "not json", "null", "42", "[]", '{"session_id":42}']) {
    const result = run(dir, { rawInput: input, verifyCmd: "sh -c 'exit 0'" });
    assert.equal(result, null, `expected allow for stdin: ${input || "<empty>"}`);
  }
});
