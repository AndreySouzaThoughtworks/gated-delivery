#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseSpec } from "../skills/spec/scripts/spec-lint.mjs";
import { MAIN_BRANCH, MERGED, SLICE_BRANCH, ghJson, git, planCleanup, requireIdentity } from "./slice-git.mjs";

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
const SLICE_GROUP = 2;
const BATCH_GROUP = 3;
const CHECKOUT_OPTIONS = ["check out main", "stash", "stack on the current branch"];
const OPEN_DECISION = /^- \*\*Options:\*\*|needs user input/m;
const WAVE_ROW = /^\|\s*(\d+)\s*\|([^|]*)\|/gm;
const DIGITS = /\d+/g;
const RESUME_FIELD = /^- (\w+): *(.*)$/gm;
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
 * @typedef {{ paths: string[], hasRollout: boolean, slices: number, openDecisions: boolean, waves: number[][] }} SpecFacts
 * @typedef {{ number: number, n: number, behind: boolean, state: string, isDraft: boolean, headRefName: string, headRefOid: string, mergeCommit: { oid: string } | null }} PullRequest
 * @typedef {{ actor: string, slice: number | null, updated: string, closed: boolean }} Resume
 * @typedef {{ name: string, n: number, batch: boolean, local: boolean, remote: boolean }} Branch
 * @typedef {{ repo: string, ticket: string, actor: string, branches: Branch[], remote: string[], slicePrs: PullRequest[], specPr: PullRequest | null, numbers: number[], resumes: Resume[] }} Evidence
 * @typedef {{ n: number, branch: string | null, local: boolean, remote: boolean, batches: string[], pr: { number: number, state: string, draft: boolean } | null, merged: boolean, heldBy: string | null, resumeReason: string | null }} SliceFacts
 */

/**
 * @param {string} repo
 * @param {string[]} specPaths
 * @returns {SpecFacts}
 */
const loadSpec = (repo, specPaths) => {
  const paths = specPaths.map((path) => resolve(repo, path)).filter((path) => existsSync(path)).map((path) => realpathSync(path));
  assert(paths.every((path) => statSync(path).isFile()), `every --spec path must be a file, got ${JSON.stringify(paths)}`);
  if (paths.length === 0) return { paths, hasRollout: false, slices: 0, openDecisions: false, waves: [] };
  const spec = parseSpec(readFileSync(paths[0], ENCODING));
  const numbers = spec.slices.map((slice) => slice.number);
  assert(numbers.every(Number.isInteger), `Rollout slice headings must read "### Slice <n> — <ACs> — exposure: <kind>", got ${JSON.stringify(spec.slices.map((slice) => slice.line))}`);
  const table = [...(spec.bodies.Rollout ?? "").matchAll(WAVE_ROW)].map(([, wave, cell]) => ({ wave: Number(wave), members: [...cell.matchAll(DIGITS)].map((digits) => Number(digits[0])).filter((number) => numbers.includes(number)) }));
  const listed = new Set(table.flatMap((row) => row.members));
  const tabled = table.sort((a, b) => a.wave - b.wave).map((row) => row.members).filter((members) => members.length > 0);
  const waves = [...tabled, ...numbers.filter((number) => !listed.has(number)).map((number) => [number])];
  return { paths, hasRollout: numbers.length > 0, slices: numbers.length, openDecisions: OPEN_DECISION.test(spec.bodies["Open decisions"] ?? ""), waves };
};

/**
 * @param {{ repo: string, handoff: string | null, remote: string[], numbers: number[] }} source
 * @returns {Resume[]}
 */
const readResumes = ({ repo, handoff, remote, numbers }) => { // zanity: ignore[assertion-density] -- io-wrapper: reads each candidate file and each origin branch copy, skipping the absent ones, and parses only blocks whose heading matches the Resume format
  if (handoff === null) return [];
  const directory = dirname(resolve(repo, handoff));
  const physicalDirectory = existsSync(directory) ? realpathSync(directory) : directory;
  const top = git(repo, ["rev-parse", "--show-toplevel"]).trim();
  const texts = [];
  for (const name of [basename(handoff), ...numbers.map((n) => `handoff-s${n}.md`)]) {
    if (existsSync(join(directory, name))) texts.push(readFileSync(join(directory, name), ENCODING));
    const inRepository = relative(top, join(physicalDirectory, name));
    if (!inRepository.startsWith(OUTSIDE_REPOSITORY)) texts.push(...remote.map((branch) => git(repo, ["show", `${REMOTE}/${branch}:${inRepository}`], "")));
  }
  const heading = new RegExp(`^## Resume ${EM_DASH} (\\S+)(?: ${EM_DASH} s(\\d+))?[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "gm");
  /** @type {Map<string, Resume>} */
  const latest = new Map();
  for (const [, actor, headingSlice, body] of texts.flatMap((text) => [...text.matchAll(heading)])) {
    const fields = Object.fromEntries([...body.matchAll(RESUME_FIELD)].map(([, name, value]) => [name, value.trim()]));
    const named = headingSlice ?? fields.Branch?.match(SLICE_OF_BRANCH)?.[1] ?? fields.Slice?.match(SLICE_OF_TEXT)?.[1];
    const resume = { actor, slice: named === undefined ? null : Number(named), updated: fields.Updated ?? "", closed: fields.Closed !== undefined };
    const key = `${actor}|${resume.slice}`;
    if ((latest.get(key)?.updated ?? "") <= resume.updated) latest.set(key, resume);
  }
  return [...latest.values()];
};

/**
 * @param {Options} options
 * @param {SpecFacts} spec
 * @returns {Evidence}
 */
const loadEvidence = ({ repo, ticket, actor, handoff }, spec) => {
  const prefix = `feat/${ticket}-`;
  const local = git(repo, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}*`]).split(LINE_BREAK).filter((name) => name !== "");
  const remote = git(repo, ["ls-remote", "--heads", REMOTE, `${REMOTE_HEADS}${prefix}*`]).split(LINE_BREAK).filter((line) => line !== "").map((line) => line.split(REMOTE_HEADS)[1]);
  const listed = ghJson(repo, ["pr", "list", "--state", "all", "--limit", PR_LIST_LIMIT, "--json", PR_LIST_FIELDS]);
  assert(Array.isArray(listed), `gh pr list must print a JSON array, got ${JSON.stringify(listed)}`);
  assert(listed.every((pr) => typeof pr?.headRefName === "string" && typeof pr?.state === "string"), `every PR needs a head branch and a state, got ${JSON.stringify(listed.filter((pr) => typeof pr?.headRefName !== "string" || typeof pr?.state !== "string"))}`);
  const branches = [...new Set([...local, ...remote])].flatMap((name) => {
    const found = SLICE_BRANCH.exec(name);
    return found && name.startsWith(prefix) ? [{ name, n: Number(found[SLICE_GROUP]), batch: found[BATCH_GROUP] !== undefined, local: local.includes(name), remote: remote.includes(name) }] : [];
  });
  const slicePrs = listed.flatMap((pr) => {
    const found = SLICE_BRANCH.exec(pr.headRefName);
    return found && pr.headRefName.startsWith(prefix) && found[BATCH_GROUP] === undefined ? [{ ...pr, n: Number(found[SLICE_GROUP]), behind: false }] : [];
  });
  for (const pr of slicePrs) {
    pr.behind = slicePrs.some((sibling) => sibling.state === MERGED && sibling.mergeCommit !== null && git(repo, ["merge-base", sibling.mergeCommit.oid, pr.headRefOid], "").trim() !== sibling.mergeCommit.oid);
  }
  const numbers = [...new Set([...spec.waves.flat(), ...branches.filter((branch) => !branch.batch).map((branch) => branch.n)])].sort((a, b) => a - b);
  const specPr = listed.filter((pr) => pr.headRefName === `docs/${ticket}-spec`).sort((a, b) => b.number - a.number)[0] ?? null;
  return { repo, ticket, actor, branches, remote, slicePrs, specPr, numbers, resumes: readResumes({ repo, handoff, remote, numbers }) };
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
  const claim = git(repo, ["log", `${REMOTE}/${remoteBranch}`, "--reverse", "--format=%s", "--fixed-strings", `--grep=chore(${ticket}): claim s${n} for `], "");
  return claim.split(LINE_BREAK)[0].match(CLAIMANT)?.[1] ?? UNKNOWN_HOLDER;
};

/**
 * @param {Evidence} evidence
 * @param {number} n
 * @returns {SliceFacts}
 */
const describeSlice = (evidence, n) => { // zanity: ignore[assertion-density] -- limit-bound: it only gathers facts per slice, and splitting it further would scatter one lookup across functions
  const own = evidence.slicePrs.filter((pr) => pr.n === n).sort((a, b) => PR_RANK.indexOf(a.state) - PR_RANK.indexOf(b.state) || b.number - a.number);
  const best = own[0] ?? null;
  const merged = own.some((pr) => pr.state === MERGED);
  const sliceBranches = evidence.branches.filter((branch) => branch.n === n && !branch.batch);
  const localBranch = sliceBranches.find((branch) => branch.local)?.name ?? null;
  const remoteBranch = sliceBranches.find((branch) => branch.remote)?.name ?? null;
  const resumeReason = best === null ? RESUME_REASON.NO_PR : best.isDraft ? RESUME_REASON.DRAFT : best.state === OPEN && best.behind ? RESUME_REASON.SIBLING_MERGED : null;
  return {
    n,
    branch: localBranch ?? remoteBranch,
    local: localBranch !== null,
    remote: remoteBranch !== null,
    batches: evidence.branches.filter((branch) => branch.n === n && branch.batch && branch.local).map((branch) => branch.name),
    pr: best === null ? null : { number: best.number, state: best.state, draft: best.isDraft },
    merged,
    heldBy: heldByOf(evidence, n, { merged, localBranch, remoteBranch }),
    resumeReason: merged ? null : resumeReason,
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
 * @returns {Record<string, unknown>}
 */
const buildReport = (options) => { // zanity: ignore[assertion-density] -- entry-point: assembles the report from loadSpec, loadEvidence and chooseRoute, which assert their own inputs
  const { ticket, actor, repo, notesRepo } = options;
  const spec = loadSpec(repo, options.specPaths);
  const [checkout, notes] = [repo, notesRepo].filter((path) => path !== null).map((path) => {
    const top = git(path, ["rev-parse", "--show-toplevel"]).trim();
    const dirtyPaths = git(path, ["status", "--porcelain", "--untracked-files=all"])
      .split(LINE_BREAK)
      .filter((line) => line !== "")
      .map((line) => join(top, line.slice(STATUS_PREFIX_LENGTH).split(RENAME_ARROW).pop() ?? ""));
    return { head: git(path, ["branch", "--show-current"]).trim(), clean: dirtyPaths.length === 0, dirtyPaths };
  });
  const checkoutOk = checkout.clean && (checkout.head === MAIN_BRANCH || checkout.head.startsWith(`feat/${ticket}-`));
  const notesOk = notes === undefined || (notes.clean && notes.head === MAIN_BRANCH);
  const precondition = {
    ok: checkoutOk && notesOk,
    head: checkout.head,
    clean: checkout.clean,
    options: checkoutOk ? [] : CHECKOUT_OPTIONS,
    dirtyPaths: checkout.dirtyPaths,
    uncommittedSpecOnly: !checkout.clean && checkout.dirtyPaths.every((path) => spec.paths.includes(path)),
    ...(notes === undefined ? {} : { notesRepo: { head: notes.head, clean: notes.clean, ok: notesOk } }),
  };
  if (!precondition.ok) return { precondition, spec, slices: [], cleanup: [], route: ROUTE.NONE, modelChecks: MODEL_CHECKS };
  const evidence = loadEvidence(options, spec);
  const slices = evidence.numbers.map((n) => describeSlice(evidence, n));
  const staleResume = evidence.resumes
    .filter((resume) => resume.closed || slices.some((slice) => slice.n === resume.slice && slice.merged))
    .map((resume) => ({ actor: resume.actor, slice: resume.slice, reason: resume.closed ? STALE_REASON.CLOSED : STALE_REASON.MERGED }));
  const route = chooseRoute({ actor, specPrOpen: evidence.specPr?.state === OPEN, spec, hasBranch: slices.some((slice) => slice.branch !== null), slices });
  const specPr = evidence.specPr === null ? null : { number: evidence.specPr.number, state: evidence.specPr.state };
  return { precondition, spec, specPr, slices, staleResume, cleanup: planCleanup(options).removed, route, modelChecks: MODEL_CHECKS };
};

/**
 * @param {string[]} argv
 * @returns {Options}
 */
const parseOptions = (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: { ticket: { type: "string" }, actor: { type: "string" }, spec: { type: "string", multiple: true }, handoff: { type: "string" }, "notes-repo": { type: "string" }, repo: { type: "string" } },
  });
  requireIdentity(values.ticket ?? "", values.actor ?? "");
  const repo = resolve(values.repo ?? process.cwd());
  const notesRepo = values["notes-repo"] === undefined ? null : resolve(values["notes-repo"]);
  assert(existsSync(repo) && statSync(repo).isDirectory(), `--repo must be an existing directory, got ${repo}`);
  assert(notesRepo === null || (existsSync(notesRepo) && statSync(notesRepo).isDirectory()), `--notes-repo must be an existing directory, got ${notesRepo}`);
  return { ticket: values.ticket ?? "", actor: values.actor ?? "", specPaths: values.spec ?? [], handoff: values.handoff ?? null, notesRepo, repo };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => { // zanity: ignore[assertion-density] -- entry-point: parseOptions asserts every option and the exit code is read straight off the report
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
