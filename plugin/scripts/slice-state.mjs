#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseSpec } from "../skills/spec/scripts/spec-lint.mjs";
import { MAIN_BRANCH, MERGED, branchPatterns, ghJson, git, gitOrNull, localTicketBranches, planCleanup, requireIdentity, sliceNumberOf } from "./slice-git.mjs";

const EXIT_ROUTED = 0;
const EXIT_PRECONDITION = 1;
const EXIT_USAGE = 2;
const EXIT_NO_ROUTE = 3;
const EXIT_FAILURE = 4;
const JSON_INDENT = 2;
const LINE_BREAK = "\n";
const ENCODING = "utf8";
const EM_DASH = "—";
const STATUS_PREFIX_LENGTH = 3;
const RENAME_ARROW = " -> ";
const OUTSIDE_REPOSITORY = "..";
const PR_LIST_LIMIT = "500";
const PR_LIST_FIELDS = "number,state,isDraft,headRefName,headRefOid,mergeCommit";
const REMOTE = "origin";
const REMOTE_HEADS = "refs/heads/";
const UNKNOWN_HOLDER = "unknown";
const OPEN = "OPEN";
const PR_RANK = [OPEN, MERGED];
const CHECKOUT_OPTIONS = ["check out main", "stash", "stack on the current branch"];
const OPEN_DECISION = /^- \*\*Options:\*\*|needs user input/m;
const WAVE_ROW = /^\|\s*(\d+)\s*\|([^|]*)\|/gm;
const DIGITS = /\d+/g;
const SLICE_OF_BRANCH = /-s(\d+)$/;
const SLICE_OF_TEXT = /(?:\bs|slice\s*)(\d+)/i;
const CLAIMANT = / for (\S+)$/;
const USAGE = "usage: slice-state.mjs --ticket <id> --actor <name> [--spec <path>]... [--handoff <path>] [--notes-repo <path>] [--repo <dir>]";

export const ROUTE = { WAIT: "E", SPEC: "A", DECIDE: "B", ROLLOUT: "R", CLOSE: "F", RESUME: "D", WAVE: "W", START: "C", NONE: "none" };
export const MODEL_CHECKS = [
  { check: "B-prime", precedes: ROUTE.ROLLOUT },
  { check: "uncommitted-spec", relaxes: "precondition" },
];
export const RESUME_REASON = { NO_PR: "no-pr", DRAFT: "draft", SIBLING_MERGED: "sibling-merged" };
export const STALE_REASON = { MERGED: "git-shows-merged", CLOSED: "closed" };

/**
 * @typedef {{ ticket: string, actor: string, specPaths: string[], handoff: string | null, notesRepo: string | null, repo: string }} Options
 * @typedef {{ head: string, clean: boolean, dirtyPaths: string[], ok: boolean }} Checkout
 * @typedef {{ paths: string[], hasRollout: boolean, slices: number, openDecisions: boolean, waves: number[][] }} SpecFacts
 * @typedef {{ number: number, state: string, isDraft: boolean, headRefName: string, headRefOid: string, mergeCommit: { oid: string } | null }} PullRequest
 * @typedef {{ actor: string, slice: number | null, updated: string, closed: boolean }} Resume
 * @typedef {{ repo: string, ticket: string, actor: string, local: string[], remote: string[], slicePrs: PullRequest[], specPr: PullRequest | null, numbers: number[], resumes: Resume[] }} Evidence
 * @typedef {{ n: number, branch: string | null, local: boolean, remote: boolean, batches: string[], pr: { number: number, state: string, draft: boolean } | null, merged: boolean, heldBy: string | null, resumeReason: string | null }} SliceFacts
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
const parseOptions = (argv) => { // zanity: ignore[assertion-density] -- thin-wrapper: parseArgs rejects unknown flags and requireIdentity asserts the ticket and actor formats
  const { values } = parseArgs({
    args: argv,
    options: { ticket: { type: "string" }, actor: { type: "string" }, spec: { type: "string", multiple: true }, handoff: { type: "string" }, "notes-repo": { type: "string" }, repo: { type: "string" } },
  });
  const ticket = values.ticket ?? "";
  const actor = values.actor ?? "";
  requireIdentity(ticket, actor);
  return { ticket, actor, specPaths: values.spec ?? [], handoff: values.handoff ?? null, notesRepo: values["notes-repo"] ?? null, repo: resolve(values.repo ?? process.cwd()) };
};

/**
 * @param {string} path
 * @param {(head: string) => boolean} headAllowed
 * @returns {Checkout}
 */
const inspectCheckout = (path, headAllowed) => { // zanity: ignore[assertion-density] -- io-wrapper: three git reads whose failure already throws, and the verdict is a pure combination of them
  const head = git(path, ["branch", "--show-current"]).trim();
  const top = git(path, ["rev-parse", "--show-toplevel"]).trim();
  const dirtyPaths = git(path, ["status", "--porcelain", "--untracked-files=all"])
    .split(LINE_BREAK)
    .filter((line) => line !== "")
    .map((line) => join(top, line.slice(STATUS_PREFIX_LENGTH).split(RENAME_ARROW).pop() ?? ""));
  return { head, clean: dirtyPaths.length === 0, dirtyPaths, ok: dirtyPaths.length === 0 && headAllowed(head) };
};

/**
 * @param {string} rollout
 * @param {number[]} numbers
 * @returns {number[][]}
 */
const wavesOf = (rollout, numbers) => { // zanity: ignore[assertion-density] -- single-invariant: every member is filtered to a slice the Rollout names, and a second check would restate that filter
  const table = [...rollout.matchAll(WAVE_ROW)].map(([, wave, cell]) => ({ wave: Number(wave), members: [...cell.matchAll(DIGITS)].map((digits) => Number(digits[0])).filter((number) => numbers.includes(number)) }));
  const listed = new Set(table.flatMap((row) => row.members));
  const tabled = table.sort((a, b) => a.wave - b.wave).map((row) => row.members).filter((members) => members.length > 0);
  return [...tabled, ...numbers.filter((number) => !listed.has(number)).map((number) => [number])];
};

/**
 * @param {string} repo
 * @param {string[]} specPaths
 * @returns {SpecFacts}
 */
const readSpec = (repo, specPaths) => { // zanity: ignore[assertion-density] -- thin-wrapper: parseSpec asserts the text and its heading structure, and the rest reads fields off its sections
  const paths = specPaths.map((path) => resolve(repo, path)).filter((path) => existsSync(path)).map((path) => realpathSync(path));
  if (paths.length === 0) return { paths, hasRollout: false, slices: 0, openDecisions: false, waves: [] };
  const spec = parseSpec(readFileSync(paths[0], ENCODING));
  const numbers = spec.slices.map((slice) => slice.number);
  return { paths, hasRollout: numbers.length > 0, slices: numbers.length, openDecisions: OPEN_DECISION.test(spec.bodies["Open decisions"] ?? ""), waves: wavesOf(spec.bodies.Rollout ?? "", numbers) };
};

/**
 * @param {string} text
 * @param {string} field
 * @returns {string | undefined}
 */
const fieldOf = (text, field) => text.match(new RegExp(`^- ${field}: *(.*)$`, "m"))?.[1]?.trim(); // zanity: ignore[assertion-density] -- no-invariant: a regex lookup over text a caller already read, so there is nothing a bug could break

/**
 * @param {string[]} texts
 * @returns {Resume[]}
 */
const parseResumes = (texts) => { // zanity: ignore[assertion-density] -- no-invariant: it only matches heading and field text, and a block that does not match is skipped
  const heading = new RegExp(`^## Resume ${EM_DASH} (\\S+)(?: ${EM_DASH} s(\\d+))?[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "gm");
  /** @type {Map<string, Resume>} */
  const latest = new Map();
  for (const [, actor, headingSlice, body] of texts.flatMap((text) => [...text.matchAll(heading)])) {
    const named = headingSlice ?? fieldOf(body, "Branch")?.match(SLICE_OF_BRANCH)?.[1] ?? fieldOf(body, "Slice")?.match(SLICE_OF_TEXT)?.[1];
    const resume = { actor, slice: named === undefined ? null : Number(named), updated: fieldOf(body, "Updated") ?? "", closed: fieldOf(body, "Closed") !== undefined };
    const key = `${actor}|${resume.slice}`;
    if ((latest.get(key)?.updated ?? "") <= resume.updated) latest.set(key, resume);
  }
  return [...latest.values()];
};

/**
 * @param {{ repo: string, handoff: string | null, remote: string[], numbers: number[] }} source
 * @returns {string[]}
 */
const handoffTexts = ({ repo, handoff, remote, numbers }) => { // zanity: ignore[assertion-density] -- io-wrapper: reads each candidate file and each origin branch copy, skipping the ones that are absent
  if (handoff === null) return [];
  const directory = dirname(resolve(repo, handoff));
  const physicalDirectory = existsSync(directory) ? realpathSync(directory) : directory;
  const top = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const texts = [];
  for (const name of [basename(handoff), ...numbers.map((n) => `handoff-s${n}.md`)]) {
    if (existsSync(join(directory, name))) texts.push(readFileSync(join(directory, name), ENCODING));
    const inRepository = relative(top, join(physicalDirectory, name));
    const branchCopies = inRepository.startsWith(OUTSIDE_REPOSITORY) ? [] : remote.map((branch) => gitOrNull(repo, ["show", `${REMOTE}/${branch}:${inRepository}`]));
    texts.push(...branchCopies.filter((text) => text !== null));
  }
  return texts;
};

/**
 * @param {Evidence} evidence
 * @param {number} n
 * @param {{ merged: boolean, localBranch: string | null, remoteBranch: string | null }} found
 * @returns {string | null}
 */
const heldByOf = ({ repo, ticket, actor, resumes }, n, { merged, localBranch, remoteBranch }) => { // zanity: ignore[assertion-density] -- limit-bound: merging it into describeSlice would breach the complex-function limit
  if (merged) return null;
  if (localBranch !== null) return actor;
  const named = resumes.find((resume) => resume.slice === n && !resume.closed);
  if (named !== undefined) return named.actor;
  if (remoteBranch === null) return null;
  const claim = gitOrNull(repo, ["log", `${REMOTE}/${remoteBranch}`, "--reverse", "--format=%s", "--fixed-strings", `--grep=chore(${ticket}): claim s${n} for `]);
  return claim?.split(LINE_BREAK)[0].match(CLAIMANT)?.[1] ?? UNKNOWN_HOLDER;
};

/**
 * @param {Evidence} evidence
 * @param {PullRequest | null} best
 * @returns {string | null}
 */
const resumeReasonOf = ({ repo, slicePrs }, best) => { // zanity: ignore[assertion-density] -- limit-bound: merging it into describeSlice would breach the complex-function limit
  if (best === null) return RESUME_REASON.NO_PR;
  if (best.isDraft) return RESUME_REASON.DRAFT;
  const behindMergedSibling = slicePrs.some((sibling) => sibling.state === MERGED && sibling.mergeCommit !== null && gitOrNull(repo, ["merge-base", "--is-ancestor", sibling.mergeCommit.oid, best.headRefOid]) === null);
  return best.state === OPEN && behindMergedSibling ? RESUME_REASON.SIBLING_MERGED : null;
};

/**
 * @param {Evidence} evidence
 * @param {number} n
 * @returns {SliceFacts}
 */
const describeSlice = (evidence, n) => { // zanity: ignore[assertion-density] -- limit-bound: it only gathers facts per slice, and splitting it further would scatter one lookup across functions
  const { slice, batch } = branchPatterns(evidence.ticket);
  const own = evidence.slicePrs.filter((pr) => sliceNumberOf(slice, pr.headRefName) === n).sort((a, b) => PR_RANK.indexOf(a.state) - PR_RANK.indexOf(b.state) || b.number - a.number);
  const merged = own.some((pr) => pr.state === MERGED);
  const localBranch = evidence.local.find((name) => sliceNumberOf(slice, name) === n) ?? null;
  const remoteBranch = evidence.remote.find((name) => sliceNumberOf(slice, name) === n) ?? null;
  return {
    n,
    branch: localBranch ?? remoteBranch,
    local: localBranch !== null,
    remote: remoteBranch !== null,
    batches: evidence.local.filter((name) => sliceNumberOf(batch, name) === n),
    pr: own[0] === undefined ? null : { number: own[0].number, state: own[0].state, draft: own[0].isDraft },
    merged,
    heldBy: heldByOf(evidence, n, { merged, localBranch, remoteBranch }),
    resumeReason: merged ? null : resumeReasonOf(evidence, own[0] ?? null),
  };
};

/**
 * @param {{ actor: string, specPrOpen: boolean, spec: SpecFacts, hasBranch: boolean, slices: SliceFacts[] }} facts
 * @returns {string}
 */
export const chooseRoute = ({ actor, specPrOpen, spec, hasBranch, slices }) => {
  const bySlice = new Map(slices.map((slice) => [slice.n, slice]));
  assert(spec.waves.flat().every((n) => bySlice.has(n)), `every wave member must be a known slice, got waves ${JSON.stringify(spec.waves)} for slices ${[...bySlice.keys()].join(", ")}`);
  const heldMerged = slices.filter((slice) => slice.merged && slice.heldBy !== null);
  assert(heldMerged.length === 0, `a merged slice must have no holder, got ${JSON.stringify(heldMerged)}`);
  const specExists = spec.paths.length > 0;
  const earliest = spec.waves.map((wave) => wave.map((n) => /** @type {SliceFacts} */ (bySlice.get(n)))).find((wave) => wave.some((slice) => !slice.merged));
  if (specPrOpen) return ROUTE.WAIT;
  if (!specExists && !hasBranch) return ROUTE.SPEC;
  if (spec.openDecisions) return ROUTE.DECIDE;
  if (specExists && !spec.hasRollout) return ROUTE.ROLLOUT;
  if (spec.hasRollout && earliest === undefined) return ROUTE.CLOSE;
  if (slices.some((slice) => slice.heldBy === actor && slice.resumeReason !== null)) return ROUTE.RESUME;
  if (earliest === undefined) return ROUTE.NONE;
  if (earliest.filter((slice) => !slice.merged).every((slice) => slice.heldBy !== null)) return ROUTE.WAIT;
  return earliest.length >= 2 ? ROUTE.WAVE : ROUTE.START;
};

/**
 * @param {Options} options
 * @param {SpecFacts} spec
 * @returns {Evidence}
 */
const gatherEvidence = ({ repo, ticket, actor, handoff }, spec) => { // zanity: ignore[assertion-density] -- io-wrapper: reads branches, origin heads and the PR list, and each read throws on failure
  const { slice } = branchPatterns(ticket);
  const specBranch = `docs/${ticket}-spec`;
  const local = localTicketBranches(repo, ticket);
  const remote = git(repo, ["ls-remote", "--heads", REMOTE, `${REMOTE_HEADS}feat/${ticket}-*`]).split(LINE_BREAK).filter((line) => line !== "").map((line) => line.split(REMOTE_HEADS)[1]);
  const prs = /** @type {PullRequest[]} */ (ghJson(repo, ["pr", "list", "--state", "all", "--limit", PR_LIST_LIMIT, "--json", PR_LIST_FIELDS]));
  const numbers = [...new Set([...spec.waves.flat(), ...[...local, ...remote].map((name) => sliceNumberOf(slice, name)).filter((n) => !Number.isNaN(n))])].sort((a, b) => a - b);
  return {
    repo,
    ticket,
    actor,
    local,
    remote,
    slicePrs: prs.filter((pr) => slice.test(pr.headRefName)),
    specPr: prs.filter((pr) => pr.headRefName === specBranch).sort((a, b) => b.number - a.number)[0] ?? null,
    numbers,
    resumes: parseResumes(handoffTexts({ repo, handoff, remote, numbers })),
  };
};

/**
 * @param {Options} options
 * @param {SpecFacts} spec
 * @returns {Record<string, unknown>}
 */
const checkPreconditions = ({ ticket, repo, notesRepo }, spec) => { // zanity: ignore[assertion-density] -- thin-wrapper: inspectCheckout reads git, and this only combines its verdicts for the repository and the notes repository
  const checkout = inspectCheckout(repo, (head) => head === MAIN_BRANCH || head.startsWith(`feat/${ticket}-`));
  const notes = notesRepo === null ? null : inspectCheckout(resolve(notesRepo), (head) => head === MAIN_BRANCH);
  return {
    ok: checkout.ok && (notes?.ok ?? true),
    head: checkout.head,
    clean: checkout.clean,
    options: checkout.ok ? [] : CHECKOUT_OPTIONS,
    dirtyPaths: checkout.dirtyPaths,
    uncommittedSpecOnly: checkout.dirtyPaths.length > 0 && checkout.dirtyPaths.every((path) => spec.paths.includes(path)),
    ...(notes === null ? {} : { notesRepo: notes }),
  };
};

/**
 * @param {Options} options
 * @returns {Record<string, unknown>}
 */
const buildReport = (options) => { // zanity: ignore[assertion-density] -- entry-point: assembles the report from helpers that each assert or read git, and the only branching is the precondition gate
  const spec = readSpec(options.repo, options.specPaths);
  const precondition = checkPreconditions(options, spec);
  if (precondition.ok !== true) return { precondition, spec, slices: [], cleanup: [], route: ROUTE.NONE, modelChecks: MODEL_CHECKS };
  const evidence = gatherEvidence(options, spec);
  const slices = evidence.numbers.map((n) => describeSlice(evidence, n));
  const staleResume = evidence.resumes
    .filter((resume) => resume.closed || slices.some((slice) => slice.n === resume.slice && slice.merged))
    .map((resume) => ({ actor: resume.actor, slice: resume.slice, reason: resume.closed ? STALE_REASON.CLOSED : STALE_REASON.MERGED }));
  const route = chooseRoute({ actor: options.actor, specPrOpen: evidence.specPr?.state === OPEN, spec, hasBranch: slices.some((slice) => slice.branch !== null), slices });
  const specPr = evidence.specPr === null ? null : { number: evidence.specPr.number, state: evidence.specPr.state };
  return { precondition, spec, specPr, slices, staleResume, cleanup: planCleanup(options).removed, route, modelChecks: MODEL_CHECKS };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => { // zanity: ignore[assertion-density] -- entry-point: parseOptions asserts every option, and the exit code is read straight off the report
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    console.error(`slice-state: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    const report = buildReport(options);
    console.log(JSON.stringify(report, null, JSON_INDENT));
    if (/** @type {{ ok: boolean }} */ (report.precondition).ok === false) return EXIT_PRECONDITION;
    return report.route === ROUTE.NONE ? EXIT_NO_ROUTE : EXIT_ROUTED;
  } catch (error) {
    console.error(`slice-state: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILURE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
