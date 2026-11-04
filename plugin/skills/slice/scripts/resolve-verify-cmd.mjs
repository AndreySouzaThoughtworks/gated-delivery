#!/usr/bin/env node
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const VERIFY_ENV = "GATED_DELIVERY_VERIFY_CMD";
export const SCRIPT_ORDER = ["check", "lint", "test"];
export const RUNNER = "pnpm";
export const NO_COMMAND_MESSAGE =
  `no verify command found: set ${VERIFY_ENV}, add a "**Verify command:** \`...\`" line under "## Verification" in a CLAUDE.md in a folder above the repository and inside your home folder, or define one of ${SCRIPT_ORDER.join(", ")} in package.json scripts`;
const INSTRUCTIONS_FILE = "CLAUDE.md";
const VERIFICATION_SECTION = "Verification";
const VERIFY_LINE = /\*\*Verify command:\*\*\s*`([^`]+)`/;
const EXIT_NO_COMMAND = 1;
/** @type {import("node:child_process").SpawnSyncOptionsWithStringEncoding} */
const GIT_QUIET = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
const WORK_TREE_ANSWER = "true";

/** @param {{ cwd: string, home: string }} location */
export const commandFromInstructions = ({ cwd, home: configuredHome }) => {
  assert(isAbsolute(configuredHome), `the home folder must be an absolute path to bound the CLAUDE.md search, got ${configuredHome}; set HOME to an absolute path`);
  let home;
  try {
    home = realpathSync(configuredHome);
  } catch {
    home = resolve(configuredHome);
  }
  const root = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], GIT_QUIET).stdout?.trim() || cwd;
  let found;
  for (let dir = dirname(root); dir === home || dir.startsWith(home + sep); dir = dirname(dir)) {
    try {
      const file = join(dir, INSTRUCTIONS_FILE);
      const insideWorkTree = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], GIT_QUIET).stdout?.trim() === WORK_TREE_ANSWER;
      if (!insideWorkTree && !lstatSync(file).isSymbolicLink()) {
        const section = readFileSync(file, "utf8")
          .split(/^## /m)
          .find((part) => part.startsWith(VERIFICATION_SECTION));
        found = section?.match(VERIFY_LINE)?.[1];
      }
    } catch {
      found = undefined;
    }
    if (found || dir === home) break;
  }
  assert(found === undefined || found.trim().length > 0, `a Verify command read from ${INSTRUCTIONS_FILE} must not be blank, got ${JSON.stringify(found)}; write the command between the backticks`);
  return found;
};

/**
 * @param {Record<string, unknown> | undefined} scripts
 * @param {string[]} [order]
 * @returns {string | undefined}
 */
export const pickScript = (scripts, order = SCRIPT_ORDER) => { // zanity: ignore[assertion-density] -- exported-and-tested: the order list is its only caller-supplied input, and the chosen name comes straight out of order.find
  assert(
    Array.isArray(order) && order.length > 0 && order.every((name) => typeof name === "string" && name.length > 0) && new Set(order).size === order.length,
    `the script order must be a non-empty list of distinct script names, got ${JSON.stringify(order)}`,
  );
  return order.find((candidate) => scripts?.[candidate]);
};

/** @param {{ cwd: string }} location */
export const commandFromPackage = ({ cwd }) => { // zanity: ignore[assertion-density] -- single-invariant: cwd is the only input it can distrust, and an unreadable package.json falls back to no command by design
  assert(typeof cwd === "string" && cwd.length > 0, `cwd must be a non-empty path, got ${JSON.stringify(cwd)}`);
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")).scripts;
  } catch {
    scripts = undefined;
  }
  const name = pickScript(scripts);
  return name && `${RUNNER} ${name}`;
};

/** @param {Record<string, string | undefined>} env */
export const commandFromEnv = (env) => {
  assert(typeof env === "object" && env !== null, `env must be an object of variables, got ${JSON.stringify(env)}`);
  const value = env[VERIFY_ENV];
  assert(value == null || typeof value === "string", `${VERIFY_ENV} must be text when set, got ${typeof value}: ${JSON.stringify(value)}`);
  return value?.trim() || undefined;
};

/** @param {{ env?: Record<string, string | undefined>, cwd?: string, home?: string }} [options] */
export const resolveVerifyCmd = ({ env = process.env, cwd = process.cwd(), home = env.HOME || homedir() } = {}) => { // zanity: ignore[assertion-density] -- single-invariant: cwd is its only own precondition, and each command source asserts what it reads before this function picks the first one
  assert(typeof cwd === "string" && cwd.length > 0, `cwd must be a non-empty path, got ${JSON.stringify(cwd)}`);
  return commandFromEnv(env) ?? commandFromInstructions({ cwd, home }) ?? commandFromPackage({ cwd });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = resolveVerifyCmd();
  if (command === undefined) {
    process.stderr.write(`${NO_COMMAND_MESSAGE}\n`);
    process.exit(EXIT_NO_COMMAND);
  }
  process.stdout.write(`${command}\n`);
}
