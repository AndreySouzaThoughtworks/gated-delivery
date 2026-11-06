#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_CLAIMED = 0;
const EXIT_PRECONDITION = 1;
const EXIT_USAGE = 2;
const EXIT_HELD = 4;
const ENCODING = "utf8";
const DEFAULT_BASE = "main";
const PORCELAIN_STATUS_PREFIX = /^\s*\S+\s+/;
const DIRTY_PATHS_SHOWN = 3;
const REMOTE = "origin";
const LS_REMOTE_FOUND = 0;
const JSON_INDENT = 2;
const NONCE_BYTES = 8;
const TICKET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLICE_TREE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "slice", "scripts", "slice-tree.sh");
const SLICE_TREE_REFUSAL = "claim refused";
const USAGE = "usage: slice-claim.mjs --ticket <id> --slice <n> --slug <text> [--base <branch>] [--repo <dir>] [--tree <path>]";

/** @typedef {{ ticket: string, slice: string, slug: string, base: string, repo: string, tree: string | undefined, branch: string }} Request */

class ClaimHeld extends Error {}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: ENCODING, stdio: "pipe" }).trim(); // zanity: ignore[assertion-density] -- io-wrapper: one execFileSync whose only postcondition is its exit status and a second assertion would only restate it

/**
 * @param {string[]} argv
 * @returns {Request}
 */
const parseRequest = (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: { ticket: { type: "string" }, slice: { type: "string" }, slug: { type: "string" }, base: { type: "string" }, repo: { type: "string" }, tree: { type: "string" } },
  });
  const { ticket = "", slice = "", slug = "" } = values;
  assert(TICKET_ID.test(ticket), `\`--ticket\` must be a ticket id, got ${JSON.stringify(values.ticket)}; pass the tracker id, such as PROJ-12.`);
  assert(POSITIVE_INTEGER.test(slice), `\`--slice\` must be a positive integer, got ${JSON.stringify(values.slice)}; pass the slice number from the Rollout.`);
  assert(SLUG.test(slug), `\`--slug\` must be lowercase words joined by hyphens, got ${JSON.stringify(values.slug)}; pass the spec slug.`);
  return {
    ticket,
    slice,
    slug,
    base: values.base ?? DEFAULT_BASE,
    repo: resolve(values.repo ?? process.cwd()),
    tree: values.tree === undefined ? undefined : resolve(values.tree),
    branch: `feat/${ticket}-${slug}-s${slice}`,
  };
};

/**
 * @param {Request} request
 * @returns {void}
 */
const assertReady = ({ repo, ticket }) => {
  const dirty = git(repo, ["status", "--porcelain"]);
  const paths = dirty.split("\n").map((line) => line.replace(PORCELAIN_STATUS_PREFIX, ""));
  const hidden = paths.length - DIRTY_PATHS_SHOWN;
  assert(dirty === "", `the working tree must be clean, but ${paths.slice(0, DIRTY_PATHS_SHOWN).map((path) => JSON.stringify(path)).join(", ")}${hidden > 0 ? ` and ${hidden} more` : ""} changed; commit or stash them.`);
  const head = git(repo, ["branch", "--show-current"]);
  assert(head === DEFAULT_BASE || head.startsWith(`feat/${ticket}-`), `HEAD must be ${DEFAULT_BASE} or a branch of ${ticket}, got ${JSON.stringify(head)}; run \`git checkout ${DEFAULT_BASE}\`.`);
};

/**
 * @param {Request} request
 * @returns {{ branch: string, base: string, baseSha: string, tree: string }}
 */
const claimSlice = (request) => { // zanity: ignore[assertion-density] -- limit-bound: splitting the ordered claim steps would breach the long-function limit and each step is asserted by its own exit status
  const { repo, base, branch, ticket, slice, tree } = request;
  const claimsInPlace = tree === undefined;
  if (claimsInPlace) {
    git(repo, ["checkout", base]);
    if (base === DEFAULT_BASE) git(repo, ["pull", "--ff-only"]);
  } else {
    git(repo, ["fetch", REMOTE]);
  }
  const baseRef = !claimsInPlace && base === DEFAULT_BASE ? `${REMOTE}/${base}` : base;
  const baseSha = git(repo, ["rev-parse", baseRef]);
  let claimTree = repo;
  try {
    if (claimsInPlace) {
      git(repo, ["checkout", "-b", branch]);
    } else {
      claimTree = execFileSync("bash", [SLICE_TREE_SCRIPT, "--claim", tree, branch, baseRef], { cwd: repo, encoding: ENCODING, stdio: "pipe" }).trim();
    }
  } catch (error) {
    const reason = String(/** @type {{ stderr?: unknown }} */ (error).stderr ?? error);
    throw claimsInPlace || reason.includes(SLICE_TREE_REFUSAL) ? new ClaimHeld(reason) : new Error(reason);
  }
  try {
    const actor = git(repo, ["config", "user.name"]);
    git(claimTree, ["commit", "--allow-empty", "-m", `chore(${ticket}): claim s${slice} for ${actor}`, "-m", `claim-nonce: ${randomBytes(NONCE_BYTES).toString("hex")}`]);
    git(claimTree, ["push", "-u", `--force-with-lease=refs/heads/${branch}:`, REMOTE, `HEAD:refs/heads/${branch}`]);
  } catch (error) {
    const onOrigin = spawnSync("git", ["ls-remote", "--exit-code", REMOTE, `refs/heads/${branch}`], { cwd: repo, stdio: "ignore" }).status === LS_REMOTE_FOUND;
    if (claimsInPlace) git(repo, ["checkout", base]);
    else git(repo, ["worktree", "remove", "--force", /** @type {string} */ (tree)]);
    git(repo, ["branch", "-D", branch]);
    const reason = String(/** @type {{ stderr?: unknown }} */ (error).stderr ?? error);
    throw onOrigin ? new ClaimHeld(reason) : new Error(reason);
  }
  return { branch, base, baseSha, tree: claimTree };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => { // zanity: ignore[assertion-density] -- entry-point: CLI main only maps parsing and claim outcomes to exit codes, and each outcome is asserted and proven in the functions it calls
  let request;
  try {
    request = parseRequest(argv);
  } catch (error) {
    console.error(`slice-claim: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    assertReady(request);
    console.log(JSON.stringify(claimSlice(request), null, JSON_INDENT));
    return EXIT_CLAIMED;
  } catch (error) {
    console.error(`slice-claim: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof ClaimHeld ? EXIT_HELD : EXIT_PRECONDITION;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
