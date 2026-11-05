import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { basename, isAbsolute } from "node:path";

const ENCODING = "utf8";
const PIPES = /** @type {import("node:child_process").StdioOptions} */ (["ignore", "pipe", "pipe"]);
const REF_HEADS = "refs/heads/";
const WORKTREE_LINE = "worktree ";
const BRANCH_LINE = "branch refs/heads/";
const BLOCK_SEPARATOR = "\n\n";
const LINE_BREAK = "\n";
const BATCH_SUFFIX = /-b\d+$/;
const PR_VIEW_FIELDS = "state";
const UNKNOWN_PR_STATE = "missing";
const OWNER_GROUP = 2;

export const MAIN_BRANCH = "main";
export const MERGED = "MERGED";
export const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/;
export const ACTOR = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;
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
 * @returns {string}
 */
export const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: ENCODING, stdio: PIPES }); // zanity: ignore[assertion-density] -- io-wrapper: one git spawn whose failure throws with git's own message

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {string | null}
 */
export const gitOrNull = (repo, args) => { // zanity: ignore[assertion-density] -- thin-wrapper: git throws on a non-zero exit and this maps that to null for the callers that read it as a no
  try {
    return git(repo, args);
  } catch {
    return null;
  }
};

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {unknown}
 */
export const ghJson = (repo, args) => JSON.parse(execFileSync("gh", args, { cwd: repo, encoding: ENCODING, stdio: PIPES })); // zanity: ignore[assertion-density] -- io-wrapper: one gh spawn whose failure throws and whose output the caller types

/**
 * @param {string} repo
 * @param {string} branch
 * @returns {string | null}
 */
const prState = (repo, branch) => { // zanity: ignore[assertion-density] -- thin-wrapper: ghJson throws when gh finds no PR or cannot ask, and this maps both to an unknown state that cleanup keeps
  try {
    return /** @type {{ state: string }} */ (ghJson(repo, ["pr", "view", branch, "--json", PR_VIEW_FIELDS])).state;
  } catch {
    return null;
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
 * @param {string} ticket
 * @returns {{ slice: RegExp, batch: RegExp }}
 */
export const branchPatterns = (ticket) => { // zanity: ignore[assertion-density] -- multi-caller-helper: both callers pass a ticket that requireIdentity already checked against TICKET_ID
  const stem = `^feat/${ticket}-.+`;
  return { slice: new RegExp(`${stem}-s(\\d+)$`), batch: new RegExp(`${stem}-s(\\d+)-b(\\d+)$`) };
};

/**
 * @param {RegExp} pattern
 * @param {string} name
 * @returns {number}
 */
export const sliceNumberOf = (pattern, name) => Number(pattern.exec(name)?.[1] ?? Number.NaN); // zanity: ignore[assertion-density] -- no-invariant: a regex lookup that yields NaN for a name the pattern does not match

/**
 * @param {string} repo
 * @param {string} ticket
 * @returns {string[]}
 */
export const localTicketBranches = (repo, ticket) => // zanity: ignore[assertion-density] -- multi-caller-helper: both callers pass a ticket that requireIdentity already checked, and git throws when the repository is unreadable
  git(repo, ["for-each-ref", "--format=%(refname)", `${REF_HEADS}feat/${ticket}-*`])
    .split(LINE_BREAK)
    .filter((ref) => ref !== "")
    .map((ref) => ref.slice(REF_HEADS.length));

/**
 * @param {{ repo: string, ticket: string, actor: string }} target
 * @returns {CleanupPlan}
 */
export const planCleanup = ({ repo, ticket, actor }) => {
  assert(TICKET_ID.test(ticket), `the ticket must be a tracker key before it joins a branch pattern, got ${JSON.stringify(ticket)}`);
  assert(isAbsolute(repo), `the repository must be an absolute path, got ${repo}`);
  const { slice, batch } = branchPatterns(ticket);
  const ownTree = new RegExp(`^${ticket}-s\\d+(-b\\d+)?-(.+)$`);
  const worktrees = git(repo, ["worktree", "list", "--porcelain"])
    .split(BLOCK_SEPARATOR)
    .filter((block) => block.trim() !== "")
    .map((block) => block.split(LINE_BREAK))
    .map((lines) => ({ path: lines.find((line) => line.startsWith(WORKTREE_LINE))?.slice(WORKTREE_LINE.length) ?? "", branch: lines.find((line) => line.startsWith(BRANCH_LINE))?.slice(BRANCH_LINE.length) ?? null }));
  const branches = localTicketBranches(repo, ticket).filter((name) => slice.test(name) || batch.test(name));
  /** @type {Map<string, string | null>} */
  const states = new Map();
  /** @type {CleanupPlan} */
  const plan = { removed: [], kept: [] };
  for (const branch of branches) {
    const sliceBranch = branch.replace(BATCH_SUFFIX, "");
    if (!states.has(sliceBranch)) states.set(sliceBranch, prState(repo, sliceBranch));
    const state = states.get(sliceBranch);
    const tree = worktrees.find((worktree) => worktree.branch === branch)?.path ?? null;
    if (state !== MERGED) plan.kept.push({ branch, reason: `pr-${(state ?? UNKNOWN_PR_STATE).toLowerCase()}` });
    else if (tree !== null && basename(tree).match(ownTree)?.[OWNER_GROUP] !== actor) plan.kept.push({ branch, reason: REASON_FOREIGN_WORKTREE });
    else if (tree !== null && git(tree, ["status", "--porcelain", "--untracked-files=all"]).trim() !== "") plan.kept.push({ branch, reason: REASON_UNCOMMITTED });
    else plan.removed.push({ branch, tree });
  }
  return plan;
};
