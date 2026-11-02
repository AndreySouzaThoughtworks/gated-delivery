#!/usr/bin/env node
// Stop-hook verification gate: blocks turn-end while the repo's lint gate reports
// issues, but only when there are uncommitted changes. Plugin-safe (uses the
// decision:"block" JSON path, not exit 2) and self-capping (won't loop forever).
// Command: GATED_DELIVERY_VERIFY_CMD, else the `## Verification` Verify command in the nearest CLAUDE.md
// in a folder above the repo and inside the home folder, else the repo's first package.json script of
// check, lint, test run through pnpm ("pnpm lint" when none exists). The repo's own CLAUDE.md
// is never read: a cloned repo controls it, and this command runs unprompted at every turn end.
// Folders above or outside home are never read either: other users may write there.

import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readHookInput } from "./lib/read-hook-input.mjs";

const DEFAULT_SCRIPT_ORDER = ["check", "lint", "test"];
const NO_SCRIPT_FALLBACK = "lint";
const DEFAULT_RUNNER = "pnpm";
const WORKING_FOLDER = ".";
const DEFAULT_SESSION_ID = "default";
const COUNTER_EXTENSION = ".count";
const MAX_CONSECUTIVE_BLOCKS = Number(process.env.GATED_DELIVERY_VERIFY_MAX_BLOCKS ?? 3);
const TEN_MINUTES_MS = 10 * 60 * 1000;
const requestedTimeoutMs = Number(process.env.GATED_DELIVERY_VERIFY_TIMEOUT_MS);
// Node reads 0 as "no timeout" and NaN as no limit at all, so only a positive number may replace the cap.
const VERIFY_TIMEOUT_MS = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0 ? requestedTimeoutMs : TEN_MINUTES_MS;

// shortcut: `@path` imports inside CLAUDE.md are not followed; put `## Verification` in the CLAUDE.md itself.
// A folder inside any work tree belongs to a repository someone else may control (an outer repo
// around a vendored one or a submodule), so only plain folders outside every repo are trusted.
const verifyCmdFromInstructions = () => {
  const configuredHome = process.env.HOME || homedir();
  console.assert(isAbsolute(configuredHome), `the home folder must be an absolute path to bound the CLAUDE.md search, got ${configuredHome}`);
  let home;
  try {
    home = realpathSync(configuredHome);
  } catch {
    home = resolve(configuredHome);
  }
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    root = process.cwd();
  }
  let found;
  for (let dir = dirname(root); dir === home || dir.startsWith(home + sep); dir = dirname(dir)) {
    let insideWorkTree;
    try {
      insideWorkTree =
        execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
    } catch {
      insideWorkTree = false;
    }
    try {
      const file = join(dir, "CLAUDE.md");
      if (!insideWorkTree && !lstatSync(file).isSymbolicLink()) {
        const section = readFileSync(file, "utf8")
          .split(/^## /m)
          .find((part) => part.startsWith("Verification"));
        found = section?.match(/\*\*Verify command:\*\*\s*`([^`]+)`/)?.[1];
      }
    } catch {
      found = undefined;
    }
    if (found || dir === home) break;
  }
  console.assert(isAbsolute(home), `the folder bounding the CLAUDE.md search must be absolute, got ${home}`);
  console.assert(found === undefined || found.trim().length > 0, `a Verify command found in CLAUDE.md must not be blank, got ${JSON.stringify(found)}`);
  return found;
};

const defaultVerifyCmd = () => {
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).scripts;
  } catch {
    scripts = undefined;
  }
  const scriptName = DEFAULT_SCRIPT_ORDER.find((name) => scripts?.[name]) ?? NO_SCRIPT_FALLBACK;
  console.assert(
    scriptName === NO_SCRIPT_FALLBACK || Boolean(scripts?.[scriptName]),
    `the chosen script ${scriptName} must exist in package.json scripts ${JSON.stringify(Object.keys(scripts ?? {}))}`,
  );
  console.assert(
    DEFAULT_SCRIPT_ORDER.includes(scriptName),
    `the default script must be one of ${DEFAULT_SCRIPT_ORDER.join(", ")}, got ${scriptName}`,
  );
  return `${DEFAULT_RUNNER} ${scriptName}`;
};

const VERIFY_CMD = process.env.GATED_DELIVERY_VERIFY_CMD ?? verifyCmdFromInstructions() ?? defaultVerifyCmd();
console.assert(VERIFY_CMD.trim().length > 0, `the verify command must not be blank, got ${JSON.stringify(VERIFY_CMD)}`);
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

const EXIT_OK = 0;

const input = readHookInput();
const sessionId = typeof input.session_id === "string" ? input.session_id : undefined;
const COUNTER_FILE = join(COUNTER_DIR, `${(sessionId ?? DEFAULT_SESSION_ID).replace(/[^A-Za-z0-9_-]/g, "_")}${COUNTER_EXTENSION}`);

const readCounter = () => {
  let count;
  try {
    count = Number(readFileSync(COUNTER_FILE, "utf8")) || 0;
  } catch {
    count = 0;
  }
  console.assert(Number.isInteger(count), `a stored counter must be a whole number, got ${count}`);
  console.assert(count >= RELEASED, `a stored counter must not fall below the release sentinel ${RELEASED}, got ${count}`);
  return count;
};
const writeCounter = (value) => {
  console.assert(Number.isInteger(value), `a counter to store must be a whole number, got ${value}`);
  console.assert(value >= RELEASED, `a counter to store must not fall below the release sentinel ${RELEASED}, got ${value}`);
  mkdirSync(COUNTER_DIR, { recursive: true });
  writeFileSync(COUNTER_FILE, String(value));
};
const resetCounter = () => {
  console.assert(COUNTER_FILE.startsWith(COUNTER_DIR + sep), `only a file inside ${COUNTER_DIR} may be removed, got ${COUNTER_FILE}`);
  try {
    rmSync(COUNTER_FILE);
  } catch {
    /* already gone */
  }
  console.assert(!existsSync(COUNTER_FILE), `the counter file must be gone after a reset, got ${COUNTER_FILE}`);
};

const untrackedFiles = () => {
  const files = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
  console.assert(files.every((file) => !isAbsolute(file)), `untracked files must be listed relative to the repo, got ${files.find(isAbsolute)}`);
  console.assert(new Set(files).size === files.length, `each untracked file must be listed once, got ${files.length - new Set(files).size} repeats`);
  return files;
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
  let found = new Set();
  if (existsSync(pkgPath)) {
    try {
      const script = JSON.parse(readFileSync(pkgPath, "utf8")).scripts?.[VERIFY_CMD.split(/\s+/).pop()];
      console.assert(script === undefined || typeof script === "string", `a package script is a command line, got ${typeof script}`);
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
  console.assert([...found].every((root) => root.length > 0), "a lint root must not be blank, got an empty name; a blank root matches no changed file");
  return found;
};

/**
 * Nothing changed that the gate could have an opinion about. Two independent reasons: the file types
 * are ones no linter reads, or every changed path lies outside the roots the lint script itself
 * names. Either way the run can only report failures this turn did not cause.
 */
const nothingLintableChanged = () => {
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
    console.assert(!nothingLintable || changed.length > 0, `an empty change list must not count as nothing lintable, got nothingLintable=${nothingLintable} with ${changed.length} changed files`);
    console.assert(!(touchesRepoRoot && nothingLintable), `a change at the repo root must always run the gate, got touchesRepoRoot=${touchesRepoRoot} and nothingLintable=${nothingLintable}`);
  } catch {
    nothingLintable = false;
  }
  return nothingLintable;
};

const verifyScriptIsAbsent = () => {
  const pkgPath = resolve(process.cwd(), "package.json");
  const looksLikePnpmScript = /^pnpm(\s+run)?\s/.test(VERIFY_CMD);
  let absent;
  if (!existsSync(pkgPath)) {
    absent = true;
  } else if (!looksLikePnpmScript) {
    absent = false;
  } else {
    const scriptName = VERIFY_CMD.split(/\s+/).pop();
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    console.assert(typeof pkg === "object" && pkg !== null, `package.json must hold a JSON object, got ${pkg === null ? "null" : typeof pkg}`);
    absent = !pkg.scripts || !pkg.scripts[scriptName];
  }
  console.assert(!absent || !existsSync(pkgPath) || looksLikePnpmScript, `a script reads as absent only without a package.json or under pnpm, got ${VERIFY_CMD}`);
  return absent;
};

// The verify command runs in its own process group so a timeout can stop everything it started;
// killing only the shell leaves linters and test workers running behind the next turn.
const runVerify = () => {
  console.assert(VERIFY_CMD.trim().length > 0, `the verify command to run must not be blank, got ${JSON.stringify(VERIFY_CMD)}`);
  console.assert(VERIFY_TIMEOUT_MS > 0, `the verify timeout must be positive because 0 means no limit, got ${VERIFY_TIMEOUT_MS}`);
  return new Promise((done) => {
    const options = { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"] };
    const child = existsSync(LOCK_WRAPPER)
      ? spawn(LOCK_WRAPPER, [VERIFY_CMD], { ...options, env: { ...process.env, GATED_DELIVERY_VERIFY_LOCK_TIMEOUT_S: LOCK_WAIT_S } })
      : spawn(VERIFY_CMD, { ...options, shell: true });
    let output = "";
    let timedOut = false;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output = (output + chunk).slice(-VERIFY_OUTPUT_TAIL);
      });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== NO_SUCH_PROCESS) output = (output + `\ncould not stop the verify command: ${error.message}`).slice(-VERIFY_OUTPUT_TAIL);
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
};

const main = async () => {
  console.assert(Number.isFinite(MAX_CONSECUTIVE_BLOCKS), `GATED_DELIVERY_VERIFY_MAX_BLOCKS must be a number, got ${process.env.GATED_DELIVERY_VERIFY_MAX_BLOCKS}`);

  // Released stays released for the session — read BEFORE the early exits, because those reset the
  // counter and a clean or asset-only turn would otherwise wipe the sentinel and restart the
  // nagging. Resetting on release was the original bug: a gate that cannot be made green went
  // block-block-block-release forever, paying for a full lint run each time.
  const released = readCounter() === RELEASED;

  let changed;
  try {
    execSync("git diff --quiet && git diff --cached --quiet", { stdio: "ignore" });
    changed = untrackedFiles().length > 0;
  } catch {
    changed = true;
  }
  if (!changed || verifyScriptIsAbsent() || nothingLintableChanged()) {
    if (!released) resetCounter();
    process.exit(EXIT_OK);
  }

  if (released) process.exit(EXIT_OK);

  const { passed, timedOut, lockBusy, output } = await runVerify();
  if (lockBusy) {
    const reason = `another verify run holds ${LOCK_PATH_LABEL}; run the verify command once it finishes`;
    process.stdout.write(JSON.stringify({ systemMessage: `verify-on-stop skipped: ${reason}` }));
    process.exit(EXIT_OK);
  }
  if (passed) {
    resetCounter();
    process.exit(EXIT_OK);
  }
  const blocks = readCounter() + 1;
  console.assert(blocks >= 1, `a block count must start at 1 or more, got ${blocks}; the counter read as released mid-run`);
  writeCounter(blocks);
  if (blocks > MAX_CONSECUTIVE_BLOCKS) {
    writeCounter(RELEASED);
    process.exit(EXIT_OK);
  }
  const reason =
    `Verification gate (\`${VERIFY_CMD}\`) ` +
    (timedOut
      ? `timed out after ${VERIFY_TIMEOUT_MS} ms — make it finish before ending the turn `
      : "reported issues — fix them before ending the turn ") +
    `(block ${blocks}/${MAX_CONSECUTIVE_BLOCKS}; the gate auto-releases after that). ` +
    `Show the passing output as evidence once fixed.\n\n${output.slice(-VERIFY_OUTPUT_TAIL)}`;
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(EXIT_OK);
};

await main();
