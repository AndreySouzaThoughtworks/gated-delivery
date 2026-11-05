import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { basename, isAbsolute } from "node:path";

const ENCODING = "utf8";
const PIPES = /** @type {import("node:child_process").StdioOptions} */ (["ignore", "pipe", "pipe"]);
const WORKTREE_LINE = "worktree ";
const BRANCH_LINE = "branch refs/heads/";
const BLOCK_SEPARATOR = "\n\n";
const LINE_BREAK = "\n";
const BATCH_SUFFIX = /-b\d+$/;
const UNKNOWN_PR_STATE = "missing";
const OWNER_GROUP = 2;

export const MAIN_BRANCH = "main";
export const MERGED = "MERGED";
export const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/;
export const ACTOR = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;
export const SLICE_BRANCH = /^feat\/(.+?)-s(\d+)(?:-b(\d+))?$/;
export const REASON_FOREIGN_WORKTREE = "worktree-not-owned-by-actor";
export const REASON_UNCOMMITTED = "uncommitted-changes";

/**
 * @typedef {{ branch: string, tree: string | null }} Removal
 * @typedef {{ branch: string, reason: string }} Keeper
 * @typedef {{ removed: Removal[], kept: Keeper[] }} CleanupPlan
 */

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {string} [fallback]
 * @returns {string}
 */
export const git = (repo, args, fallback) => {
  assert(isAbsolute(repo), `git needs an absolute repository path, got ${JSON.stringify(repo)}`);
  assert(args.length > 0, `git needs a subcommand, got ${JSON.stringify(args)}`);
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: ENCODING, stdio: PIPES });
  } catch (error) {
    if (fallback === undefined) throw error;
    return fallback;
  }
};

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
export const ghJson = (repo, args, fallback) => {
  assert(isAbsolute(repo), `gh needs an absolute repository path, got ${JSON.stringify(repo)}`);
  assert(args.includes("--json"), `gh output is only parsed as JSON when asked for it, got ${JSON.stringify(args)}`);
  try {
    return JSON.parse(execFileSync("gh", args, { cwd: repo, encoding: ENCODING, stdio: PIPES }));
  } catch (error) {
    if (fallback === undefined) throw error;
    return fallback;
  }
};

/**
 * @param {string} ticket
 * @param {string} actor
 * @returns {void}
 */
export const requireIdentity = (ticket, actor) => {
  assert(TICKET_ID.test(ticket), `--ticket must be a tracker key such as PROJ-123, got ${JSON.stringify(ticket)}`);
  assert(ACTOR.test(actor), `--actor must be a handle such as alice or alice@laptop, got ${JSON.stringify(actor)}`);
};

/**
 * @param {{ repo: string, ticket: string, actor: string }} target
 * @returns {CleanupPlan}
 */
export const planCleanup = ({ repo, ticket, actor }) => {
  assert(TICKET_ID.test(ticket), `the ticket must be a tracker key before it joins a branch pattern, got ${JSON.stringify(ticket)}`);
  assert(isAbsolute(repo), `the repository must be an absolute path, got ${repo}`);
  const ownTree = new RegExp(`^${ticket}-s\\d+(-b\\d+)?-(.+)$`);
  const worktrees = git(repo, ["worktree", "list", "--porcelain"])
    .split(BLOCK_SEPARATOR)
    .filter((block) => block.trim() !== "")
    .map((block) => block.split(LINE_BREAK))
    .map((lines) => ({ path: lines.find((line) => line.startsWith(WORKTREE_LINE))?.slice(WORKTREE_LINE.length) ?? "", branch: lines.find((line) => line.startsWith(BRANCH_LINE))?.slice(BRANCH_LINE.length) ?? null }));
  const branches = git(repo, ["for-each-ref", "--format=%(refname:short)", `refs/heads/feat/${ticket}-*`])
    .split(LINE_BREAK)
    .filter((name) => SLICE_BRANCH.test(name));
  /** @type {Map<string, string | null>} */
  const states = new Map();
  /** @type {CleanupPlan} */
  const plan = { removed: [], kept: [] };
  for (const branch of branches) {
    const sliceBranch = branch.replace(BATCH_SUFFIX, "");
    if (!states.has(sliceBranch)) states.set(sliceBranch, /** @type {{ state?: string }} */ (ghJson(repo, ["pr", "view", sliceBranch, "--json", "state"], {})).state ?? null);
    const state = states.get(sliceBranch);
    const tree = worktrees.find((worktree) => worktree.branch === branch)?.path ?? null;
    if (state !== MERGED) plan.kept.push({ branch, reason: `pr-${(state ?? UNKNOWN_PR_STATE).toLowerCase()}` });
    else if (tree !== null && basename(tree).match(ownTree)?.[OWNER_GROUP] !== actor) plan.kept.push({ branch, reason: REASON_FOREIGN_WORKTREE });
    else if (tree !== null && git(tree, ["status", "--porcelain", "--untracked-files=all"]).trim() !== "") plan.kept.push({ branch, reason: REASON_UNCOMMITTED });
    else plan.removed.push({ branch, tree });
  }
  return plan;
};
