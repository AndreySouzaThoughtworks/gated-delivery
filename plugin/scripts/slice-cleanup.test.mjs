import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REASON_FOREIGN_WORKTREE, REASON_UNCOMMITTED, planCleanup } from "./slice-git.mjs";
import { makeWorld } from "./fixtures/slice-world.mjs";

const EXIT_DONE = 0;
const EXIT_USAGE = 2;
const SCRIPT = "slice-cleanup.mjs";
const ACTOR = "alice";
const S1 = "feat/T-1-demo-s1";
const S2 = "feat/T-1-demo-s2";
const S1_BATCH = "feat/T-1-demo-s1-b1";

const view = (branch, state) => {
  assert(branch.startsWith("feat/"), `a viewed branch must be a feat branch, got ${branch}`);
  assert(["OPEN", "MERGED", "CLOSED"].includes(state), `a PR state must be OPEN, MERGED or CLOSED, got ${state}`);
  return { [branch]: { state } };
};

const cleanup = (world, extra = []) => {
  assert(Array.isArray(extra), `extra arguments must be a list, got ${typeof extra}`);
  const result = world.run(SCRIPT, ["--ticket", "T-1", "--actor", ACTOR, ...extra]);
  assert(result.status !== null, `the script must exit on its own, got stderr ${result.stderr}`);
  return result;
};

const branchExists = (world, name) => {
  assert(name.startsWith("feat/"), `a checked branch must be a feat branch, got ${name}`);
  assert(existsSync(world.repo), `the repository must exist at ${world.repo}`);
  return world.git(world.repo, ["branch", "--list", name]) !== "";
};

test("a merged slice's tree and branch are removed", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}` });
  world.prs([], view(S1, "MERGED"));
  const result = cleanup(world);
  assert.equal(result.status, EXIT_DONE);
  assert.deepEqual(result.json().removed, [{ branch: S1, tree: join(world.trees, `T-1-s1-${ACTOR}`) }]);
  assert.equal(existsSync(join(world.trees, `T-1-s1-${ACTOR}`)), false);
  assert.equal(branchExists(world, S1), false);
});

test("a merged slice's branch with no tree is deleted", () => {
  const world = makeWorld();
  world.branch(S1);
  world.prs([], view(S1, "MERGED"));
  assert.deepEqual(cleanup(world).json().removed, [{ branch: S1, tree: null }]);
  assert.equal(branchExists(world, S1), false);
});

test("a merged slice's batch branch and batch tree go with it", () => {
  const world = makeWorld();
  world.branch(S1);
  world.branch(S1_BATCH, { tree: `T-1-s1-b1-${ACTOR}` });
  world.prs([], view(S1, "MERGED"));
  const result = cleanup(world);
  assert.deepEqual(result.json().removed.map((entry) => entry.branch).sort(), [S1, S1_BATCH]);
  assert.equal(branchExists(world, S1_BATCH), false);
  assert.equal(existsSync(join(world.trees, `T-1-s1-b1-${ACTOR}`)), false);
});

test("another actor's tree and branch are never touched", () => {
  const world = makeWorld();
  world.branch(S2, { tree: "T-1-s2-bob" });
  world.prs([], view(S2, "MERGED"));
  const result = cleanup(world);
  assert.deepEqual(result.json().removed, []);
  assert.deepEqual(result.json().kept, [{ branch: S2, reason: REASON_FOREIGN_WORKTREE }]);
  assert.equal(existsSync(join(world.trees, "T-1-s2-bob")), true);
  assert.equal(branchExists(world, S2), true);
});

test("an actor whose name ends with this actor's name is another actor", () => {
  const world = makeWorld();
  world.branch(S1, { tree: "T-1-s1-carol-alice" });
  world.prs([], view(S1, "MERGED"));
  assert.deepEqual(cleanup(world).json().removed, []);
  assert.equal(existsSync(join(world.trees, "T-1-s1-carol-alice")), true);
});

test("an actor whose name starts with this actor's name is another actor", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}-2` });
  world.prs([], view(S1, "MERGED"));
  assert.deepEqual(cleanup(world).json().removed, []);
  assert.equal(existsSync(join(world.trees, `T-1-s1-${ACTOR}-2`)), true);
});

test("an OPEN PR's branch and tree are never removed", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}` });
  world.prs([], view(S1, "OPEN"));
  const result = cleanup(world);
  assert.deepEqual(result.json().kept, [{ branch: S1, reason: "pr-open" }]);
  assert.equal(branchExists(world, S1), true);
  assert.equal(existsSync(join(world.trees, `T-1-s1-${ACTOR}`)), true);
});

test("a CLOSED PR's branch is kept", () => {
  const world = makeWorld();
  world.branch(S1);
  world.prs([], view(S1, "CLOSED"));
  assert.deepEqual(cleanup(world).json().kept, [{ branch: S1, reason: "pr-closed" }]);
  assert.equal(branchExists(world, S1), true);
});

test("a branch with no PR is kept", () => {
  const world = makeWorld();
  world.branch(S1);
  assert.deepEqual(cleanup(world).json().kept, [{ branch: S1, reason: "pr-missing" }]);
  assert.equal(branchExists(world, S1), true);
});

test("a merged slice's tree with uncommitted changes is kept", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}` });
  writeFileSync(join(world.trees, `T-1-s1-${ACTOR}`, "wip.txt"), "unsaved work\n");
  world.prs([], view(S1, "MERGED"));
  const result = cleanup(world);
  assert.deepEqual(result.json().kept, [{ branch: S1, reason: REASON_UNCOMMITTED }]);
  assert.equal(existsSync(join(world.trees, `T-1-s1-${ACTOR}`, "wip.txt")), true);
  assert.equal(branchExists(world, S1), true);
});

test("a merged slice's tree with a modified tracked file is kept", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}` });
  writeFileSync(join(world.trees, `T-1-s1-${ACTOR}`, "README.md"), "edited\n");
  world.prs([], view(S1, "MERGED"));
  assert.deepEqual(cleanup(world).json().kept, [{ branch: S1, reason: REASON_UNCOMMITTED }]);
});

test("a merged branch checked out in the main checkout is kept", () => {
  const world = makeWorld();
  world.branch(S1);
  world.git(world.repo, ["checkout", "-q", S1]);
  world.prs([], view(S1, "MERGED"));
  assert.deepEqual(cleanup(world).json().kept, [{ branch: S1, reason: REASON_FOREIGN_WORKTREE }]);
  assert.equal(branchExists(world, S1), true);
});

test("another ticket's merged branch is never touched", () => {
  const world = makeWorld();
  world.branch("feat/T-2-other-s1");
  world.branch("feat/T-10-demo-s1");
  world.prs([], { ...view("feat/T-2-other-s1", "MERGED"), ...view("feat/T-10-demo-s1", "MERGED") });
  assert.deepEqual(cleanup(world).json(), { dryRun: false, removed: [], kept: [] });
  assert.equal(branchExists(world, "feat/T-2-other-s1"), true);
  assert.equal(branchExists(world, "feat/T-10-demo-s1"), true);
});

test("the remote branch survives a cleanup", () => {
  const world = makeWorld();
  world.branch(S1, { push: true });
  world.prs([], view(S1, "MERGED"));
  cleanup(world);
  assert.match(world.git(world.origin, ["branch", "--list", S1]), /feat\/T-1-demo-s1/);
});

test("a dry run lists what would go and removes nothing", () => {
  const world = makeWorld();
  world.branch(S1, { tree: `T-1-s1-${ACTOR}` });
  world.prs([], view(S1, "MERGED"));
  const result = cleanup(world, ["--dry-run"]);
  assert.equal(result.status, EXIT_DONE);
  assert.equal(result.json().dryRun, true);
  assert.deepEqual(result.json().removed, [{ branch: S1, tree: join(world.trees, `T-1-s1-${ACTOR}`) }]);
  assert.equal(existsSync(join(world.trees, `T-1-s1-${ACTOR}`)), true);
  assert.equal(branchExists(world, S1), true);
});

test("the plan refuses a relative repository path and a ticket that is not a tracker key", () => {
  assert.throws(() => planCleanup({ repo: "relative/repo", ticket: "T-1", actor: ACTOR }), /absolute path/);
  assert.throws(() => planCleanup({ repo: "/tmp", ticket: "T-1.*", actor: ACTOR }), /tracker key/);
});

test("usage errors exit 2", () => {
  const world = makeWorld();
  assert.equal(world.run(SCRIPT, ["--actor", ACTOR]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T-1"]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T 1", "--actor", ACTOR]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T-1", "--actor", "-x"]).status, EXIT_USAGE);
  assert.equal(world.run(SCRIPT, ["--ticket", "T-1", "--actor", ACTOR, "--force"]).status, EXIT_USAGE);
});
