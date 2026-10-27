#!/usr/bin/env node
// PostToolUse hook: auto-format a file right after Claude edits it, using the repo's
// prettier. No-op if the file type isn't formattable or prettier isn't available.
//
// Prettier is spawned as a plain .cjs file under this same Node, never through a package manager.
// Reaching it through `pnpm` needs a shell on some platforms, and `shell: true` would hand the file
// path back to a shell and reinstate the command injection this file was fixed for. Resolving the
// CLI and running it directly keeps one shell-free code path.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { readHookInput } from "./lib/read-hook-input.mjs";

const FORMATTABLE = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
]);
const FORMAT_TIMEOUT_MS = 30_000;
const EXIT_OK = 0;

/**
 * The installed prettier's CLI entry, taken from its own manifest rather than a hard-coded path:
 * prettier 3 ships `bin/prettier.cjs`, prettier 2 ships `bin-prettier.js` at the package root, and
 * either literal silently stops formatting every repo on the other major.
 */
const prettierCli = () => {
  try {
    const manifest = createRequire(join(process.cwd(), "package.json")).resolve(
      "prettier/package.json",
    );
    const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
    const declared = typeof bin === "string" ? bin : bin?.prettier;
    console.assert(declared === undefined || typeof declared === "string", `a prettier manifest names its CLI as text, got ${typeof declared}`);
    const cli = declared ? join(dirname(manifest), declared) : null;
    console.assert(cli === null || existsSync(cli), `the declared prettier CLI must exist on disk, got ${cli}`);
    return cli;
  } catch {
    return null;
  }
};

const main = () => {
  const input = readHookInput();
  console.assert(input?.tool_input === undefined || typeof input.tool_input === "object", `a tool call carries its input as an object, got ${typeof input?.tool_input}`);
  const filePath = input?.tool_input?.file_path;
  console.assert(filePath === undefined || typeof filePath === "string", `an edited file path is text when present, got ${typeof filePath}`);
  if (!filePath || !FORMATTABLE.has(extname(filePath))) process.exit(EXIT_OK);
  if (!existsSync(resolve(process.cwd(), filePath))) process.exit(EXIT_OK);

  // Resolved from the edited repo, so it picks up that repo's prettier version. Absent — the common
  // case for a plugin installed everywhere — is a silent no-op, same as before.
  const cli = prettierCli();
  if (!cli) process.exit(EXIT_OK);

  try {
    // execFileSync, not execSync: passing args as an array means no shell parses them. The string
    // form interpolated the path into a shell command inside double quotes, where `$(...)` and
    // backticks still expand — a file named `$(id -u)/a.ts` got formatted as `501/a.ts`.
    execFileSync(process.execPath, [cli, "--write", filePath], {
      stdio: "ignore",
      cwd: process.cwd(),
      timeout: FORMAT_TIMEOUT_MS,
    });
  } catch {
    // prettier absent, not configured, or failed — never block on formatting
  }
  process.exit(EXIT_OK);
};

main();
