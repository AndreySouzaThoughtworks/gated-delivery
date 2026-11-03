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
  assert(root !== dirname(root) || found === undefined, `a repository at the filesystem root has no folder above it, yet read ${JSON.stringify(found)}`);
  return found;
};

/** @param {{ cwd: string }} location */
export const commandFromPackage = ({ cwd }) => {
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")).scripts;
  } catch {
    scripts = undefined;
  }
  const name = SCRIPT_ORDER.find((candidate) => scripts?.[candidate]);
  return name && `${RUNNER} ${name}`;
};

/** @param {{ env?: Record<string, string | undefined>, cwd?: string, home?: string }} [options] */
export const resolveVerifyCmd = ({ env = process.env, cwd = process.cwd(), home = env.HOME || homedir() } = {}) => {
  const fromEnv = env[VERIFY_ENV]?.trim() || undefined;
  const command = fromEnv ?? commandFromInstructions({ cwd, home }) ?? commandFromPackage({ cwd });
  return command;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = resolveVerifyCmd();
  if (command === undefined) {
    process.stderr.write(`${NO_COMMAND_MESSAGE}\n`);
    process.exit(EXIT_NO_COMMAND);
  }
  process.stdout.write(`${command}\n`);
}
