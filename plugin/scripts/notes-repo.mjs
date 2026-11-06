#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_OK = 0;
const EXIT_GIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_CONFLICT = 3;
const EXIT_STOP = 4;
const EXIT_WRONG_REPO = 5;
const ENCODING = "utf8";
const GIT = "git";
const GH = "gh";
const NOTES_REPO_ENV = "GATED_DELIVERY_NOTES_REPO";
const CLONE_DIRECTORY_PREFIX = "gated-delivery-notes-";
const REMOTE = "origin";
const MAIN_BRANCH = "main";
const MAIN_REF = `refs/heads/${MAIN_BRANCH}`;
const REMOTE_MAIN = `${REMOTE}/${MAIN_BRANCH}`;
const REPO_NAME_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const TRAILING_SLASHES = /\/+$/;
const GIT_SUFFIX = /\.git$/i;
const REMOTE_SEPARATORS = /[/:]/;
const REPO_NAME_SEGMENTS = 2;
const NO_SUCH_CONFIG_KEY = 1;
const PARSE_ARGS_CODE_PREFIX = "ERR_PARSE_ARGS";
const LITERAL_PATHSPECS = "--literal-pathspecs";
const NOTHING_STAGED = 0;
const SOME_STAGED = 1;
const NO_MERGE_IN_PROGRESS = 1;
const USAGE = [
  "usage: notes-repo.mjs prepare (--repo-name <owner/name> | --in-repo)",
  "       notes-repo.mjs publish --path <checkout> --file <path>... --message <text>",
].join("\n");

/** @typedef {{ exit: number, report: Record<string, unknown> }} Outcome */

/**
 * @param {string} command
 * @param {string} cwd
 * @param {string[]} args
 * @param {number[]} [expected]
 * @returns {{ status: number | null, out: string }}
 */
const run = (command, cwd, args, expected = [EXIT_OK]) => { // zanity: ignore[assertion-density] -- io-wrapper: one spawnSync whose only postcondition is an expected exit status, thrown as an error otherwise
  const result = spawnSync(command, args, { cwd, encoding: ENCODING });
  if (result.error) throw result.error;
  if (!expected.includes(/** @type {number} */ (result.status))) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return { status: result.status, out: result.stdout.trim() };
};

/**
 * @param {string} path
 * @returns {{ merged: boolean, behind: number }}
 */
const mergeOrigin = (path) => { // zanity: ignore[assertion-density] -- multi-caller-helper: prepare and publish assert the checkout and its branch before calling, and a failed merge is a returned result
  run(GIT, path, ["fetch", REMOTE, MAIN_BRANCH]);
  const behind = Number(run(GIT, path, ["rev-list", "--count", `HEAD..${REMOTE_MAIN}`]).out);
  const merge = run(GIT, path, ["merge", "--no-edit", REMOTE_MAIN], [EXIT_OK, EXIT_GIT_FAILED]);
  if (merge.status === EXIT_OK) return { merged: true, behind };
  const inProgress = run(GIT, path, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], [EXIT_OK, NO_MERGE_IN_PROGRESS]).status === EXIT_OK;
  if (!inProgress) throw new Error(`git merge ${REMOTE_MAIN} failed without a conflict: ${merge.out}`);
  run(GIT, path, ["merge", "--abort"]);
  return { merged: false, behind };
};

/**
 * @param {string[]} argv
 * @returns {Outcome}
 */
const prepare = (argv) => {
  const { values } = parseArgs({ args: argv, options: { "repo-name": { type: "string" }, "in-repo": { type: "boolean" } } });
  if (values["in-repo"]) return { exit: EXIT_OK, report: { inRepo: true, path: null, branch: null, clean: null, behind: null } };
  const repoName = values["repo-name"];
  assert(repoName, "`prepare` needs `--repo-name <owner/name>`; pass the notes repository, or pass `--in-repo` when the notes live in the repository being changed");
  assert(REPO_NAME_PATTERN.test(repoName), `--repo-name ${JSON.stringify(repoName)} is not owner/name; pass the repository as <owner>/<name>`);
  const configured = process.env[NOTES_REPO_ENV];
  let path = configured ? resolve(configured) : mkdtempSync(join(tmpdir(), CLONE_DIRECTORY_PREFIX));
  if (!configured) run(GH, tmpdir(), ["repo", "clone", repoName, path]);
  assert(existsSync(join(path, ".git")), `${path} is not a git checkout`);
  path = realpathSync(path);
  const origin = run(GIT, path, ["config", "--get", `remote.${REMOTE}.url`], [EXIT_OK, NO_SUCH_CONFIG_KEY]).out;
  const [actualRepo, expectedRepo] = [origin, repoName].map((remote) => remote.trim().replace(TRAILING_SLASHES, "").replace(GIT_SUFFIX, "").split(REMOTE_SEPARATORS).slice(-REPO_NAME_SEGMENTS).join("/").toLowerCase());
  if (actualRepo !== expectedRepo) {
    console.error(`STOP: the notes checkout ${path} has origin ${origin || "(none)"}, not ${repoName}; point ${NOTES_REPO_ENV} at a checkout of ${repoName}, or unset it`);
    return { exit: EXIT_WRONG_REPO, report: { inRepo: false, path, origin, expected: repoName } };
  }
  const branch = run(GIT, path, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  const clean = run(GIT, path, ["status", "--porcelain"]).out === "";
  if (branch !== MAIN_BRANCH || !clean) {
    console.error(`STOP: the notes checkout ${path} must be clean and on ${MAIN_BRANCH}; it is on ${branch} and ${clean ? "clean" : "dirty"}`);
    return { exit: EXIT_STOP, report: { inRepo: false, path, branch, clean, behind: null } };
  }
  const { merged, behind } = mergeOrigin(path);
  return { exit: merged ? EXIT_OK : EXIT_CONFLICT, report: { inRepo: false, path, branch, clean, behind } };
};

/**
 * @param {string[]} argv
 * @returns {Outcome}
 */
const publish = (argv) => {
  const { values } = parseArgs({ args: argv, options: { path: { type: "string" }, file: { type: "string", multiple: true }, message: { type: "string" } } });
  assert(values.path, "--path <checkout> is required");
  const path = resolve(values.path);
  const files = values.file ?? [];
  assert(files.length > 0, `--file needs at least one path, got ${files.length}; publishing stages named files only`);
  assert(values.message?.trim(), "--message <text> is required");
  assert(existsSync(join(path, ".git")), `${path} is not a git checkout`);
  for (const file of files) assert(!(existsSync(resolve(path, file)) && statSync(resolve(path, file)).isDirectory()), `${file} is a directory; name each file, since a directory stages everything under it`);
  const branch = run(GIT, path, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== MAIN_BRANCH) {
    console.error(`STOP: the notes checkout ${path} is on ${branch}, not ${MAIN_BRANCH}; nothing was committed or pushed`);
    return { exit: EXIT_STOP, report: { path, branch, committed: false, pushed: false } };
  }
  run(GIT, path, [LITERAL_PATHSPECS, "add", "--", ...files]);
  const staged = run(GIT, path, [LITERAL_PATHSPECS, "diff", "--cached", "--quiet", "--", ...files], [NOTHING_STAGED, SOME_STAGED]).status === SOME_STAGED;
  if (staged) run(GIT, path, [LITERAL_PATHSPECS, "commit", "-m", String(values.message), "--", ...files]);
  const { merged } = mergeOrigin(path);
  if (!merged) return { exit: EXIT_CONFLICT, report: { path, branch, committed: staged, pushed: false } };
  run(GIT, path, ["push", REMOTE, `HEAD:${MAIN_REF}`]);
  return { exit: EXIT_OK, report: { path, branch, committed: staged, pushed: true } };
};

const COMMANDS = new Map([["prepare", prepare], ["publish", publish]]);

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => { // zanity: ignore[assertion-density] -- entry-point: CLI main dispatches a subcommand and maps its errors to exit codes, and its one input-dependent invariant is asserted inline
  try {
    const [name, ...rest] = argv;
    const command = COMMANDS.get(String(name));
    assert(command, `unknown subcommand ${JSON.stringify(name)}`);
    const { exit, report } = command(rest);
    console.log(JSON.stringify(report));
    return exit;
  } catch (error) {
    const isUsage = error instanceof assert.AssertionError || String(/** @type {NodeJS.ErrnoException} */ (error).code).startsWith(PARSE_ARGS_CODE_PREFIX);
    console.error(`notes-repo: ${error instanceof Error ? error.message : String(error)}${isUsage ? `\n${USAGE}` : ""}`);
    return isUsage ? EXIT_USAGE : EXIT_GIT_FAILED;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
