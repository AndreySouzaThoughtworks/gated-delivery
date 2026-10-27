#!/usr/bin/env node
// Stop-hook verification gate: blocks turn-end while the repo's lint gate reports
// issues, but only when there are uncommitted changes. Plugin-safe (uses the
// decision:"block" JSON path, not exit 2) and self-capping (won't loop forever).
// Command: GATED_DELIVERY_VERIFY_CMD, else the `## Verification` Verify command in the nearest CLAUDE.md
// in a folder above the repo and inside the home folder, else "pnpm lint". The repo's own CLAUDE.md
// is never read: a cloned repo controls it, and this command runs unprompted at every turn end.
// Folders above or outside home are never read either: other users may write there.

import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readHookInput } from "./lib/read-hook-input.mjs";

const DEFAULT_VERIFY_CMD = "pnpm lint";
const WORKING_FOLDER = ".";
const DEFAULT_SESSION_ID = "default";
const COUNTER_EXTENSION = ".count";
const MAX_CONSECUTIVE_BLOCKS = Number(process.env.GATED_DELIVERY_VERIFY_MAX_BLOCKS ?? 3);
const TEN_MINUTES_MS = 10 * 60 * 1000;
const requestedTimeoutMs = Number(process.env.GATED_DELIVERY_VERIFY_TIMEOUT_MS);
// Node reads 0 as "no timeout" and NaN as no limit at all, so only a positive number may replace the cap.
const VERIFY_TIMEOUT_MS = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0 ? requestedTimeoutMs : TEN_MINUTES_MS;

// shortcut: `@path` imports inside CLAUDE.md are not followed; put `## Verification` in the CLAUDE.md itself.
const repoRoot = () => {
  console.assert(existsSync(WORKING_FOLDER), `the working folder must exist to locate the repository, got ${WORKING_FOLDER}`);
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    root = process.cwd();
  }
  console.assert(root.length > 0, `the repository root must not be empty, got length ${root.length}`);
  return root;
};

const homeFolder = () => {
  const home = process.env.HOME || homedir();
  console.assert(home.length > 0, `a home folder must be known to bound the CLAUDE.md search, got length ${home.length}`);
  let resolved;
  try {
    resolved = realpathSync(home);
  } catch {
    resolved = resolve(home);
  }
  console.assert(isAbsolute(resolved), `the home folder must resolve to an absolute path, got ${resolved}`);
  return resolved;
};

// A folder inside any work tree belongs to a repository someone else may control (an outer repo
// around a vendored one or a submodule), so only plain folders outside every repo are trusted.
const insideGitWorkTree = (dir) => {
  console.assert(typeof dir === "string" && dir.length > 0, `a folder path is needed to ask git about it, got ${typeof dir} of length ${dir?.length}`);
  let inside;
  try {
    inside = execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
  } catch {
    inside = false;
  }
  console.assert(typeof inside === "boolean", `the work tree answer must be yes or no, got ${inside}`);
  return inside;
};

const verifyCmdIn = (dir) => {
  console.assert(typeof dir === "string" && dir.length > 0, `a folder path is needed to read its CLAUDE.md, got ${typeof dir} of length ${dir?.length}`);
  let cmd;
  try {
    const file = join(dir, "CLAUDE.md");
    if (!insideGitWorkTree(dir) && !lstatSync(file).isSymbolicLink()) {
      const section = readFileSync(file, "utf8")
        .split(/^## /m)
        .find((part) => part.startsWith("Verification"));
      cmd = section?.match(/\*\*Verify command:\*\*\s*`([^`]+)`/)?.[1];
    }
  } catch {
    cmd = undefined;
  }
  console.assert(cmd === undefined || cmd.length > 0, `a found Verify command must not be empty, got ${cmd}`);
  return cmd;
};

const verifyCmdFromInstructions = () => {
  const home = homeFolder();
  console.assert(isAbsolute(home), `the search must start from an absolute home folder, got ${home}`);
  const insideHome = (dir) => {
    console.assert(home.length > 0, `the home folder must be known to test containment, got length ${home.length}`);
    const inside = dir === home || dir.startsWith(home + sep);
    console.assert(!inside || dir.length >= home.length, `a folder inside home cannot be shorter than home, got ${dir.length} against ${home.length}`);
    return inside;
  };
  let found;
  for (let dir = dirname(repoRoot()); insideHome(dir); dir = dirname(dir)) {
    found = verifyCmdIn(dir);
    if (found || dir === home) break;
  }
  console.assert(found === undefined || found.length > 0, `a found Verify command must not be empty, got ${found}`);
  return found;
};

const VERIFY_CMD = process.env.GATED_DELIVERY_VERIFY_CMD ?? verifyCmdFromInstructions() ?? DEFAULT_VERIFY_CMD;
const VERIFY_OUTPUT_TAIL = 1500;
// Sentinel in the counter file: this session gave up on the gate. Negative, so no block count reaches it.
const RELEASED = -1;
const COUNTER_DIR = join(tmpdir(), "gated-delivery-verify-stop");
// The machine-wide lock /slice verify runs hold. The hook waits only briefly: a stop must not stall
// behind another run, and the lock wrapper's own long default would outlast VERIFY_TIMEOUT_MS.
const LOCK_WRAPPER = join(dirname(fileURLToPath(import.meta.url)), "../skills/slice/scripts/verify-lock.sh");
const LOCK_WAIT_S = "5";
const LOCK_BUSY_EXIT = 75;
const LOCK_BUSY_MESSAGE = "still held after";
const LOCK_PATH_LABEL = "the verify lock";
const NO_SUCH_PROCESS = "ESRCH";

const allow = () => {
  console.assert(typeof process.exit === "function", `allowing ends the hook through process.exit, got ${typeof process.exit}`);
  console.assert(process.exitCode === undefined || process.exitCode === 0, `allowing must not follow a failure exit code, got ${process.exitCode}`);
  process.exit(0);
};
const allowSkipped = (reason) => {
  console.assert(typeof reason === "string" && reason.length > 0, `a skipped verify must say why, got ${typeof reason} of length ${reason?.length}`);
  const message = JSON.stringify({ systemMessage: `verify-on-stop skipped: ${reason}` });
  console.assert(message.includes(reason), `the skip reason must reach the message, got ${message} for ${reason}`);
  process.stdout.write(message);
  process.exit(0);
};
const block = (reason) => {
  console.assert(typeof reason === "string" && reason.length > 0, `a block must say why, got ${typeof reason} of length ${reason?.length}`);
  const decision = JSON.stringify({ decision: "block", reason });
  console.assert(decision.includes('"block"'), `the payload must carry the block decision, got ${decision}`);
  process.stdout.write(decision);
  process.exit(0);
};

const counterFile = (sessionId) => {
  console.assert(sessionId === undefined || typeof sessionId === "string", `a session id is text when present, got ${typeof sessionId}`);
  const file = join(COUNTER_DIR, `${(sessionId ?? DEFAULT_SESSION_ID).replace(/[^A-Za-z0-9_-]/g, "_")}${COUNTER_EXTENSION}`);
  console.assert(dirname(file) === COUNTER_DIR, `a session id must not escape the counter folder, got ${file}`);
  return file;
};

const readCounter = (sessionId) => {
  console.assert(sessionId === undefined || typeof sessionId === "string", `a session id is text when present, got ${typeof sessionId}`);
  let count;
  try {
    count = Number(readFileSync(counterFile(sessionId), "utf8")) || 0;
  } catch {
    count = 0;
  }
  console.assert(Number.isFinite(count), `a stored count must be a finite number, got ${count}`);
  return count;
};
const writeCounter = (sessionId, value) => {
  console.assert(sessionId === undefined || typeof sessionId === "string", `a session id is text when present, got ${typeof sessionId}`);
  console.assert(Number.isInteger(value), `a counter value must be a whole number, got ${value}`);
  mkdirSync(COUNTER_DIR, { recursive: true });
  writeFileSync(counterFile(sessionId), String(value));
  console.assert(existsSync(counterFile(sessionId)), `the counter file must exist after writing it, value ${value}`);
};
const bumpCounter = (sessionId) => {
  console.assert(sessionId === undefined || typeof sessionId === "string", `a session id is text when present, got ${typeof sessionId}`);
  const current = readCounter(sessionId);
  const next = current + 1;
  writeCounter(sessionId, next);
  console.assert(next > current, `bumping must raise the count, got ${next} after ${current}`);
  return next;
};
const resetCounter = (sessionId) => {
  console.assert(sessionId === undefined || typeof sessionId === "string", `a session id is text when present, got ${typeof sessionId}`);
  try {
    const file = counterFile(sessionId);
    rmSync(file);
    console.assert(!existsSync(file), `a reset counter file must be gone, got ${file}`);
  } catch {
    /* already gone */
  }
};

const untrackedFiles = () => {
  console.assert(existsSync(WORKING_FOLDER), `the working folder must exist to list untracked files, got ${WORKING_FOLDER}`);
  const files = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  console.assert(files.every((file) => file.length > 0), `listed paths must not be blank, got ${files.length} paths`);
  return files;
};

const hasUncommittedChanges = () => {
  console.assert(existsSync(WORKING_FOLDER), `the working folder must exist to ask git about changes, got ${WORKING_FOLDER}`);
  let changed;
  try {
    execSync("git diff --quiet && git diff --cached --quiet", { stdio: "ignore" });
    changed = untrackedFiles().length > 0;
  } catch {
    changed = true;
  }
  console.assert(typeof changed === "boolean", `the change answer must be yes or no, got ${changed}`);
  return changed;
};

// Extensions a JS/TS repo's lint gate plausibly covers — deliberately generous, including the ones
// only a prettier-in-eslint setup touches. Skipping is a decision NOT to verify, so this errs toward
// running: the win is the asset-only turn (a screenshot, a binary fixture), not a clever prediction
// of what eslint was configured to read.
const LINTABLE = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".md", ".mdx", ".yaml", ".yml", ".css", ".scss", ".less", ".html", ".vue", ".svelte",
]);

/**
 * Top-level directories the repo's own lint script names — typically `{src,apps,libs,test}/**`. Read from the script rather than configured here: the plugin stays
 * self-contained, and the repo already states its own scope.
 *
 * Empty means "couldn't tell" (`turbo run lint`, `nx run-many -t lint`, a nested `packages/x/src/**`
 * glob), and empty means RUN — guessing narrower would silently shrink the gate.
 */
const lintRoots = () => {
  const pkgPath = resolve(process.cwd(), "package.json");
  console.assert(isAbsolute(pkgPath), `package.json must be looked up by absolute path, got ${pkgPath}`);
  let found = new Set();
  if (existsSync(pkgPath)) {
    try {
      const script = JSON.parse(readFileSync(pkgPath, "utf8")).scripts?.[VERIFY_CMD.split(/\s+/).pop()];
      const roots = new Set();
      const globs = script?.matchAll(/(?:^|[\s"'(])(?:([\w.-]+)|\{([^}]+)\})\/\*\*/g) ?? [];
      for (const [, single, braced] of globs) {
        if (braced) braced.split(",").forEach((r) => roots.add(r.trim()));
        else roots.add(single);
      }
      found = roots;
    } catch {
      found = new Set();
    }
  }
  console.assert(found instanceof Set, `the lint roots must be a set, got ${found}`);
  return found;
};

/**
 * Nothing changed that the gate could have an opinion about. Two independent reasons: the file types
 * are ones no linter reads, or every changed path lies outside the roots the lint script itself
 * names. Either way the run can only report failures this turn did not cause.
 */
const nothingLintableChanged = () => {
  console.assert(existsSync(WORKING_FOLDER), `the working folder must exist to list changed paths, got ${WORKING_FOLDER}`);
  let nothingLintable = false;
  try {
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .concat(untrackedFiles());
    // Anything at the repo root means RUN, before any other test. That is where the files deciding
    // what lint reports live — `eslint.config.mjs`, `tsconfig.json`, `package.json`, and the
    // extensionless `.eslintrc` / `.prettierrc` / `.editorconfig`, which carry no extension to match
    // and no directory to match either. Both filters below would wave them through.
    const touchesRepoRoot = changed.some((f) => !f.includes("/"));
    if (changed.length > 0 && !touchesRepoRoot) {
      if (!changed.some((f) => LINTABLE.has(extname(f)))) {
        nothingLintable = true;
      } else {
        const roots = lintRoots();
        nothingLintable = roots.size > 0 && !changed.some((f) => roots.has(f.split("/")[0]));
      }
    }
  } catch {
    nothingLintable = false;
  }
  console.assert(typeof nothingLintable === "boolean", `the lintable answer must be yes or no, got ${nothingLintable}`);
  return nothingLintable;
};

const verifyScriptIsAbsent = () => {
  const pkgPath = resolve(process.cwd(), "package.json");
  console.assert(isAbsolute(pkgPath), `package.json must be looked up by absolute path, got ${pkgPath}`);
  const looksLikePnpmScript = /^pnpm(\s+run)?\s/.test(VERIFY_CMD);
  let absent;
  if (!existsSync(pkgPath)) {
    absent = true;
  } else if (!looksLikePnpmScript) {
    absent = false;
  } else {
    const scriptName = VERIFY_CMD.split(/\s+/).pop();
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    absent = !pkg.scripts || !pkg.scripts[scriptName];
  }
  console.assert(typeof absent === "boolean", `the script-absent answer must be yes or no, got ${absent}`);
  return absent;
};

// The verify command runs in its own process group so a timeout can stop everything it started;
// killing only the shell leaves linters and test workers running behind the next turn.
const spawnVerify = () => {
  console.assert(VERIFY_CMD.length > 0, `there must be a command to run, got length ${VERIFY_CMD.length}`);
  const options = { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"] };
  const child = existsSync(LOCK_WRAPPER)
    ? spawn(LOCK_WRAPPER, [VERIFY_CMD], { ...options, env: { ...process.env, GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S: LOCK_WAIT_S } })
    : spawn(VERIFY_CMD, { ...options, shell: true });
  console.assert(child.stdout !== null && child.stderr !== null, `the verify output must be piped to be captured, got ${child.stdout} and ${child.stderr}`);
  return child;
};

const runVerify = () =>
  new Promise((done) => {
    console.assert(VERIFY_TIMEOUT_MS > 0, `the verify run needs a positive time limit, got ${VERIFY_TIMEOUT_MS}`);
    const child = spawnVerify();
    console.assert(typeof child.on === "function", `the verify run must be an observable process, got ${typeof child.on}`);
    let output = "";
    let timedOut = false;
    const keepTail = (chunk) => {
      console.assert(chunk !== undefined && chunk !== null, `a captured chunk must carry data, got ${chunk}`);
      output = (output + chunk).slice(-VERIFY_OUTPUT_TAIL);
      console.assert(output.length <= VERIFY_OUTPUT_TAIL, `the kept output must stay within the tail size, got ${output.length} against ${VERIFY_OUTPUT_TAIL}`);
    };
    child.stdout.on("data", keepTail);
    child.stderr.on("data", keepTail);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== NO_SUCH_PROCESS) keepTail(`\ncould not stop the verify command: ${error.message}`);
      }
    }, VERIFY_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ passed: false, timedOut, lockBusy: false, output: String(error.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const lockBusy = code === LOCK_BUSY_EXIT && output.includes(LOCK_BUSY_MESSAGE);
      done({ passed: code === 0 && !timedOut, timedOut, lockBusy, output });
    });
  });

const main = async () => {
  const input = readHookInput();
  console.assert(typeof input === "object" && input !== null, `the hook input must be an object, got ${typeof input}`);
  const sessionId = typeof input.session_id === "string" ? input.session_id : undefined;
  console.assert(sessionId === undefined || typeof sessionId === "string", `a session id is text when present, got ${typeof sessionId}`);

  // Released stays released for the session — read BEFORE the early exits, because those reset the
  // counter and a clean or asset-only turn would otherwise wipe the sentinel and restart the
  // nagging. Resetting on release was the original bug: a gate that cannot be made green went
  // block-block-block-release forever, paying for a full lint run each time.
  const released = readCounter(sessionId) === RELEASED;

  if (!hasUncommittedChanges() || verifyScriptIsAbsent() || nothingLintableChanged()) {
    if (!released) resetCounter(sessionId);
    allow();
  }

  if (released) allow();

  const { passed, timedOut, lockBusy, output } = await runVerify();
  if (lockBusy) allowSkipped(`another verify run holds ${LOCK_PATH_LABEL}; run the verify command once it finishes`);
  if (passed) {
    resetCounter(sessionId);
    allow();
  }
  const blocks = bumpCounter(sessionId);
  if (blocks > MAX_CONSECUTIVE_BLOCKS) {
    writeCounter(sessionId, RELEASED);
    allow();
  }
  block(
    `Verification gate (\`${VERIFY_CMD}\`) ` +
      (timedOut
        ? `timed out after ${VERIFY_TIMEOUT_MS} ms — make it finish before ending the turn `
        : "reported issues — fix them before ending the turn ") +
      `(block ${blocks}/${MAX_CONSECUTIVE_BLOCKS}; the gate auto-releases after that). ` +
      `Show the passing output as evidence once fixed.\n\n${output.slice(-VERIFY_OUTPUT_TAIL)}`,
  );
};

await main();
