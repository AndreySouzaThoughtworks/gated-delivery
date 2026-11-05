import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { lintSpec } from "../skills/spec/scripts/spec-lint.mjs";
import { RESUME_REASON, ROUTE, STALE_REASON, chooseRoute } from "./slice-state.mjs";
import { makeWorld, specText } from "./fixtures/slice-world.mjs";

const EXIT_ROUTED = 0;
const EXIT_PRECONDITION = 1;
const EXIT_USAGE = 2;
const EXIT_NO_ROUTE = 3;
const SCRIPT = "slice-state.mjs";
const ACTOR = "alice";
const S1 = "feat/T-1-demo-s1";
const S2 = "feat/T-1-demo-s2";
const S3 = "feat/T-1-demo-s3";
const DASH = "—";

const pr = (number, head, state, { draft = false, oid = "", merge = null } = {}) => {
  assert(["OPEN", "MERGED", "CLOSED"].includes(state), `a PR state must be OPEN, MERGED or CLOSED, got ${state}`);
  assert(/^(feat|docs)\//.test(head), `a PR head must be a feat or docs branch, got ${head}`);
  return { number, state, isDraft: draft, headRefName: head, headRefOid: oid, mergeCommit: merge === null ? null : { oid: merge } };
};

const state = (world, extra = []) => {
  assert(Array.isArray(extra), `extra arguments must be a list, got ${typeof extra}`);
  const result = world.run(SCRIPT, ["--ticket", "T-1", "--actor", ACTOR, "--spec", world.specPath, ...extra]);
  assert(result.status !== null, `the script must exit on its own, got stderr ${result.stderr}`);
  return result;
};

const resumeBlock = (heading, fields = {}) => {
  assert(heading.includes("Resume"), `a Resume block heading must say Resume, got ${heading}`);
  assert(Object.keys(fields).every((name) => /^[A-Z][a-z]+$/.test(name)), `field names must be capitalised words, got ${Object.keys(fields)}`);
  return `${heading}\n\n${Object.entries({ Updated: "2026-01-01T00:00Z", ...fields }).map(([name, value]) => `- ${name}: ${value}`).join("\n")}\n\n`;
};

const withHandoff = (world, text) => {
  assert(text.includes("## Resume"), `a handoff must hold a Resume block, got ${text}`);
  const path = `${world.repo}/handoff.md`;
  writeFileSync(path, text);
  world.git(world.repo, ["add", "handoff.md"]);
  world.git(world.repo, ["commit", "-q", "-m", "handoff"]);
  assert(existsSync(path), `the handoff must exist at ${path}`);
  return ["--handoff", path];
};

const ALL_MERGED = [pr(1, S1, "MERGED", { merge: "a" }), pr(2, S2, "MERGED", { merge: "b" }), pr(3, S3, "MERGED", { merge: "c" })];

test("a dirty tree stops with exit 1 and names the dirty path", () => {
  const world = makeWorld();
  writeFileSync(`${world.repo}/README.md`, "changed\n");
  const result = state(world);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.equal(result.json().precondition.clean, false);
  assert.deepEqual(result.json().precondition.dirtyPaths, [`${world.repo}/README.md`]);
  assert.deepEqual(result.json().precondition.options, ["check out main", "stash", "stack on the current branch"]);
  assert.equal(result.json().route, ROUTE.NONE);
});

test("an uncommitted spec alone is flagged for the model but still stops", () => {
  const world = makeWorld({ spec: null });
  writeFileSync(world.specPath, specText());
  const result = state(world);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.equal(result.json().precondition.uncommittedSpecOnly, true);
  assert.deepEqual(result.json().modelChecks.map((entry) => entry.check), ["B-prime", "uncommitted-spec"]);
});

test("HEAD on an unrelated branch stops with exit 1", () => {
  const world = makeWorld();
  world.git(world.repo, ["checkout", "-q", "-b", "feat/T-2-other-s1"]);
  const result = state(world);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.equal(result.json().precondition.head, "feat/T-2-other-s1");
  assert.equal(result.json().precondition.ok, false);
});

test("HEAD on a branch of a ticket sharing the id prefix stops with exit 1", () => {
  const world = makeWorld();
  world.git(world.repo, ["checkout", "-q", "-b", "feat/T-10-other-s1"]);
  assert.equal(state(world).status, EXIT_PRECONDITION);
});

test("HEAD on the ticket's own branch passes the precondition", () => {
  const world = makeWorld();
  world.git(world.repo, ["checkout", "-q", "-b", S1]);
  const result = state(world);
  assert.equal(result.status, EXIT_ROUTED);
  assert.equal(result.json().precondition.head, S1);
  assert.deepEqual(result.json().precondition.options, []);
});

test("a notes repository off main stops with exit 1", () => {
  const world = makeWorld();
  world.git(world.repo, ["checkout", "-q", "-b", "side"]);
  const result = world.run(SCRIPT, ["--ticket", "T-1", "--actor", ACTOR, "--spec", world.specPath, "--notes-repo", world.repo]);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.equal(result.json().precondition.notesRepo.head, "side");
});

test("an open spec PR with no spec file routes E, not A", () => {
  const world = makeWorld({ spec: null });
  world.prs([pr(9, "docs/T-1-spec", "OPEN")]);
  const result = state(world);
  assert.equal(result.status, EXIT_ROUTED);
  assert.equal(result.json().route, ROUTE.WAIT);
  assert.deepEqual(result.json().specPr, { number: 9, state: "OPEN" });
});

test("a merged spec PR does not hold the route", () => {
  const world = makeWorld();
  world.prs([pr(9, "docs/T-1-spec", "MERGED")]);
  assert.equal(state(world).json().route, ROUTE.START);
});

test("no spec and no branch routes A", () => {
  const world = makeWorld({ spec: null });
  assert.equal(state(world).json().route, ROUTE.SPEC);
});

test("open decisions route B", () => {
  const world = makeWorld({ spec: specText({ openDecision: true }) });
  assert.equal(state(world).json().route, ROUTE.DECIDE);
});

test("the open-decision rule agrees with spec-lint on every shape it knows", () => {
  const shapes = [
    { body: "- **Options:** A or B", open: true },
    { body: "The owner still needs user input here.", open: true },
    { body: "None.", open: false },
    { body: "Resolved: A, because B.", open: false },
    { body: "None.\n\n- **Options:** a second entry after a resolved one", open: true },
  ];
  for (const { body, open } of shapes) {
    const world = makeWorld({ spec: specText().replace("None.", body).replace("status: Draft", "status: Ready") });
    const lintSaysOpen = lintSpec(specText().replace("None.", body).replace("status: Draft", "status: Ready")).some((problem) => problem.includes("Open decisions still holds an unresolved entry"));
    assert.equal(lintSaysOpen, open);
    assert.equal(state(world).json().spec.openDecisions, lintSaysOpen);
  }
});

test("a spec without Rollout routes R", () => {
  const world = makeWorld({ spec: specText({ rollout: false }) });
  const result = state(world);
  assert.equal(result.json().route, ROUTE.ROLLOUT);
  assert.equal(result.json().spec.hasRollout, false);
});

test("a spec reports its slices and waves", () => {
  const spec = state(makeWorld()).json().spec;
  assert.equal(spec.hasRollout, true);
  assert.equal(spec.slices, 3);
  assert.deepEqual(spec.waves, [[1], [2, 3]]);
});

test("a rollout without a wave table is a strict sequence", () => {
  const world = makeWorld({ spec: specText({ waves: "" }) });
  assert.deepEqual(state(world).json().spec.waves, [[1], [2], [3]]);
});

test("every slice merged routes F", () => {
  const world = makeWorld();
  world.prs(ALL_MERGED);
  assert.equal(state(world).json().route, ROUTE.CLOSE);
});

test("an unheld single-slice first wave routes C", () => {
  assert.equal(state(makeWorld()).json().route, ROUTE.START);
});

test("a first wave held by another actor routes E and never starts the later wave", () => {
  const world = makeWorld();
  world.branch(S1, { push: true, message: "chore(T-1): claim s1 for bob" });
  world.git(world.repo, ["branch", "-D", S1]);
  const result = state(world);
  assert.equal(result.json().route, ROUTE.WAIT);
  assert.equal(result.json().slices.find((slice) => slice.n === 1).heldBy, "bob");
});

test("an unclaimed slice with a fresh branch on origin but unfetched claim reports an unknown holder", () => {
  const world = makeWorld();
  world.branch(S1, { push: true });
  world.git(world.repo, ["branch", "-D", S1]);
  world.git(world.repo, ["update-ref", "-d", `refs/remotes/origin/${S1}`]);
  const slice = state(world).json().slices.find((entry) => entry.n === 1);
  assert.equal(slice.heldBy, "unknown");
  assert.equal(slice.remote, true);
});

test("a two-slice wave with one slice unheld routes W", () => {
  const world = makeWorld();
  world.prs([pr(1, S1, "MERGED", { merge: "a" })]);
  world.branch(S2, { push: true, message: "chore(T-1): claim s2 for bob" });
  world.git(world.repo, ["branch", "-D", S2]);
  assert.equal(state(world).json().route, ROUTE.WAVE);
});

test("a two-slice wave with both slices held routes E", () => {
  const world = makeWorld();
  world.prs([pr(1, S1, "MERGED", { merge: "a" })]);
  world.branch(S2, { push: true, message: "chore(T-1): claim s2 for bob" });
  world.branch(S3, { push: true, message: "chore(T-1): claim s3 for carol" });
  world.git(world.repo, ["branch", "-D", S2]);
  world.git(world.repo, ["branch", "-D", S3]);
  assert.equal(state(world).json().route, ROUTE.WAIT);
});

test("a local slice branch with no PR is this actor's and routes D", () => {
  const world = makeWorld();
  world.branch(S1);
  const result = state(world);
  assert.equal(result.json().route, ROUTE.RESUME);
  const slice = result.json().slices.find((entry) => entry.n === 1);
  assert.equal(slice.heldBy, ACTOR);
  assert.equal(slice.resumeReason, RESUME_REASON.NO_PR);
});

test("a local slice branch with a draft PR routes D", () => {
  const world = makeWorld();
  world.branch(S1);
  world.prs([pr(4, S1, "OPEN", { draft: true })]);
  assert.equal(state(world).json().slices[0].resumeReason, RESUME_REASON.DRAFT);
});

test("a ready PR whose gates ran after every sibling merged routes past D", () => {
  const world = makeWorld();
  const oid = world.branch(S1);
  world.prs([pr(4, S1, "OPEN", { oid })]);
  const result = state(world);
  assert.equal(result.json().slices[0].resumeReason, null);
  assert.equal(result.json().route, ROUTE.WAIT);
});

test("a ready PR behind a sibling merged after its gates ran routes D", () => {
  const world = makeWorld();
  const oid = world.branch(S2);
  writeFileSync(`${world.repo}/sibling.txt`, "merged later\n");
  world.git(world.repo, ["add", "sibling.txt"]);
  world.git(world.repo, ["commit", "-q", "-m", "sibling squash"]);
  const merge = world.git(world.repo, ["rev-parse", "HEAD"]);
  world.prs([pr(1, S1, "MERGED", { merge }), pr(4, S2, "OPEN", { oid })]);
  const slice = state(world).json().slices.find((entry) => entry.n === 2);
  assert.equal(slice.resumeReason, RESUME_REASON.SIBLING_MERGED);
  assert.equal(state(world).json().route, ROUTE.RESUME);
});

test("a ready PR already carrying the sibling's merge does not route D", () => {
  const world = makeWorld();
  writeFileSync(`${world.repo}/sibling.txt`, "merged earlier\n");
  world.git(world.repo, ["add", "sibling.txt"]);
  world.git(world.repo, ["commit", "-q", "-m", "sibling squash"]);
  const merge = world.git(world.repo, ["rev-parse", "HEAD"]);
  const oid = world.branch(S2);
  world.prs([pr(1, S1, "MERGED", { merge }), pr(4, S2, "OPEN", { oid })]);
  assert.equal(state(world).json().slices.find((entry) => entry.n === 2).resumeReason, null);
});

test("a Resume block older than Git, naming a slice Git shows merged, loses to Git", () => {
  const world = makeWorld();
  world.prs(ALL_MERGED);
  const handoff = withHandoff(world, resumeBlock(`## Resume ${DASH} ${ACTOR} ${DASH} s2`, { Branch: S2, Slice: "s2" }));
  const result = state(world, handoff);
  assert.equal(result.json().route, ROUTE.CLOSE);
  assert.deepEqual(result.json().staleResume, [{ actor: ACTOR, slice: 2, reason: STALE_REASON.MERGED }]);
});

test("a Resume block another actor wrote holds its slice", () => {
  const world = makeWorld();
  world.prs([pr(1, S1, "MERGED", { merge: "a" })]);
  world.branch(S2, { push: true, message: "chore(T-1): claim s2 for bob" });
  world.git(world.repo, ["branch", "-D", S2]);
  const handoff = withHandoff(world, resumeBlock(`## Resume ${DASH} carol ${DASH} s3`));
  const result = state(world, handoff);
  assert.equal(result.json().slices.find((slice) => slice.n === 3).heldBy, "carol");
  assert.equal(result.json().route, ROUTE.WAIT);
});

test("a heading that departs from the Resume format names no holder", () => {
  const world = makeWorld();
  world.prs([pr(1, S1, "MERGED", { merge: "a" })]);
  world.branch(S2, { push: true, message: "chore(T-1): claim s2 for bob" });
  world.git(world.repo, ["branch", "-D", S2]);
  const handoff = withHandoff(world, resumeBlock("## Resume - carol - s3") + resumeBlock(`### Resume ${DASH} carol ${DASH} s3`));
  const result = state(world, handoff);
  assert.equal(result.json().slices.find((slice) => slice.n === 3).heldBy, null);
  assert.equal(result.json().route, ROUTE.WAVE);
});

test("a closed Resume block no longer holds its slice", () => {
  const world = makeWorld();
  world.prs([pr(1, S1, "MERGED", { merge: "a" })]);
  world.branch(S2, { push: true, message: "chore(T-1): claim s2 for bob" });
  world.git(world.repo, ["branch", "-D", S2]);
  const handoff = withHandoff(world, resumeBlock(`## Resume ${DASH} carol ${DASH} s3`, { Closed: "2026-02-01T00:00Z" }));
  const result = state(world, handoff);
  assert.equal(result.json().route, ROUTE.WAVE);
  assert.deepEqual(result.json().staleResume, [{ actor: "carol", slice: 3, reason: STALE_REASON.CLOSED }]);
});

test("a Resume block on an origin slice branch is read without checking it out", () => {
  const world = makeWorld();
  world.prs([pr(1, S1, "MERGED", { merge: "a" })]);
  world.git(world.repo, ["checkout", "-q", "-b", S3, "main"]);
  writeFileSync(`${world.repo}/handoff.md`, resumeBlock(`## Resume ${DASH} dave ${DASH} s3`));
  world.git(world.repo, ["add", "handoff.md"]);
  world.git(world.repo, ["commit", "-q", "-m", "handoff on branch"]);
  world.git(world.repo, ["push", "-q", "origin", `${S3}:refs/heads/${S3}`]);
  world.git(world.repo, ["checkout", "-q", "main"]);
  world.git(world.repo, ["branch", "-D", S3]);
  const result = world.run(SCRIPT, ["--ticket", "T-1", "--actor", ACTOR, "--spec", world.specPath, "--handoff", `${world.repo}/handoff.md`]);
  assert.equal(result.json().slices.find((slice) => slice.n === 3).heldBy, "dave");
});

test("the actor's own Resume block without a local branch still routes D", () => {
  const world = makeWorld();
  const handoff = withHandoff(world, resumeBlock(`## Resume ${DASH} ${ACTOR} ${DASH} s1`));
  assert.equal(state(world, handoff).json().route, ROUTE.RESUME);
});

test("the cleanup list names this actor's merged slice branches", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}` });
  world.prs([pr(1, S1, "MERGED", { merge: "a" })], { [S1]: { state: "MERGED" } });
  const result = state(world);
  assert.deepEqual(result.json().cleanup, [{ branch: S1, tree: `${world.trees}/T-1-s1-${ACTOR}` }]);
  assert.equal(world.git(world.repo, ["branch", "--list", S1]), `+ ${S1}`);
});

test("a rollout nobody can route reports exit 3", () => {
  const world = makeWorld({ spec: null });
  world.branch(S1, { push: true, message: "chore(T-1): claim s1 for bob" });
  world.git(world.repo, ["branch", "-D", S1]);
  const result = state(world);
  assert.equal(result.status, EXIT_NO_ROUTE);
  assert.equal(result.json().route, ROUTE.NONE);
});

const facts = (slices, waves) => {
  assert(Array.isArray(slices) && slices.length > 0, `the router needs at least one slice, got ${JSON.stringify(slices)}`);
  assert(waves.every((wave) => wave.length > 0), `every wave needs a member, got ${JSON.stringify(waves)}`);
  return { actor: ACTOR, specPrOpen: false, spec: { paths: ["spec.md"], hasRollout: true, slices: slices.length, openDecisions: false, waves }, hasBranch: false, slices };
};

const slice = (n, extra = {}) => {
  assert(Number.isInteger(n) && n > 0, `a slice number must be a positive integer, got ${n}`);
  assert(!("n" in extra), `the slice number is the first argument, not a field, got ${JSON.stringify(extra)}`);
  return { n, branch: null, local: false, remote: false, batches: [], pr: null, merged: false, heldBy: null, resumeReason: null, ...extra };
};

test("the router refuses a wave naming a slice it has no facts for", () => {
  assert.throws(() => chooseRoute(facts([slice(1)], [[1], [2]])), /known slice/);
});

test("the router refuses a merged slice that still has a holder", () => {
  assert.throws(() => chooseRoute(facts([slice(1, { merged: true, heldBy: "bob" })], [[1]])), /no holder/);
});

test("the router takes the first row that fits, in the order the table gives", () => {
  const unheld = [slice(1), slice(2), slice(3)];
  assert.equal(chooseRoute(facts(unheld, [[1], [2, 3]])), ROUTE.START);
  assert.equal(chooseRoute(facts(unheld, [[1, 2], [3]])), ROUTE.WAVE);
  assert.equal(chooseRoute(facts([slice(1, { heldBy: "bob" }), slice(2), slice(3)], [[1], [2, 3]])), ROUTE.WAIT);
  assert.equal(chooseRoute(facts([slice(1, { heldBy: ACTOR, resumeReason: RESUME_REASON.DRAFT }), slice(2)], [[1], [2]])), ROUTE.RESUME);
  assert.equal(chooseRoute(facts([slice(1, { merged: true })], [[1]])), ROUTE.CLOSE);
});

test("usage errors exit 2", () => {
  const world = makeWorld();
  assert.equal(world.run(SCRIPT, ["--actor", ACTOR]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T-1"]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "not a ticket", "--actor", ACTOR]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T-1", "--actor", "bad actor"]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T-1", "--actor", ACTOR, "--bogus"]).status, EXIT_USAGE);
});
