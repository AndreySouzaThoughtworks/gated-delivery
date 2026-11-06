import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertActionable } from "./run-cli.test.support.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "slice-claim.mjs");
const EXIT_CLAIMED = 0;
const EXIT_PRECONDITION = 1;
const EXIT_USAGE = 2;
const EXIT_HELD = 4;
const ENCODING = "utf8";
const HOOK_MODE = 0o755;
const TICKET = "T-1";
const SLUG = "alpha";
const BRANCH = "feat/T-1-alpha-s1";
const CLAIM_COMMIT_SUBJECT = "chore(T-1): claim s1 for Alice";
const FROZEN_CLOCK = { GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const ISOLATED_GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

Object.assign(process.env, ISOLATED_GIT_ENV);

const git = (cwd, args) => {
  assert(existsSync(cwd), `the git directory must exist, got ${cwd}`);
  const result = spawnSync("git", args, { cwd, encoding: ENCODING });
  assert(result.status === 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const refOnOrigin = (origin, ref) => {
  assert(existsSync(origin), `the origin must exist, got ${origin}`);
  assert(!ref.startsWith("refs/"), `the ref must be a branch name, got ${ref}`);
  return spawnSync("git", ["rev-parse", "--verify", "-q", `refs/heads/${ref}`], { cwd: origin, encoding: ENCODING }).stdout.trim();
};

const clone = (root, origin, name, identity) => {
  assert(existsSync(origin), `the origin must exist, got ${origin}`);
  const checkout = join(root, name);
  git(root, ["clone", "-q", origin, checkout]);
  git(checkout, ["config", "user.name", `${identity[0].toUpperCase()}${identity.slice(1)}`]);
  git(checkout, ["config", "user.email", `${identity}@example.com`]);
  assert(git(checkout, ["branch", "--show-current"]) === "main", `${name} must start on main`);
  return checkout;
};

const world = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "slice-claim-")));
  const origin = join(root, "origin.git");
  git(root, ["init", "-q", "--bare", origin]);
  git(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  const seed = join(root, "seed");
  git(root, ["init", "-q", seed]);
  git(seed, ["config", "user.name", "Seed"]);
  git(seed, ["config", "user.email", "seed@example.com"]);
  git(seed, ["checkout", "-q", "-b", "main"]);
  writeFileSync(join(seed, "file.txt"), "one\n");
  git(seed, ["add", "file.txt"]);
  git(seed, ["commit", "-q", "-m", "initial"]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  assert(existsSync(join(seed, "file.txt")), `the seed ${seed} must hold the first commit`);
  assert(refOnOrigin(origin, "main") !== "", `origin ${origin} must start with main`);
  return { root, origin, main: () => refOnOrigin(origin, "main"), clone: (name, identity = name) => clone(root, origin, name, identity) };
};

const CLAIM_ARGS = ["--ticket", TICKET, "--slice", "1", "--slug", SLUG];

const claim = (repo, extra = [], env = {}) => {
  assert(existsSync(repo), `the repo must exist, got ${repo}`);
  const result = spawnSync(process.execPath, [SCRIPT, "--repo", repo, ...CLAIM_ARGS, ...extra], { encoding: ENCODING, env: { ...process.env, ...env } });
  assert(result.status !== null, `the claim must exit on its own, got signal ${result.signal}`);
  return result;
};

const localBranches = (repo) => {
  assert(existsSync(repo), `the repo must exist, got ${repo}`);
  const branches = git(repo, ["branch", "--format=%(refname:short)"]).split("\n");
  assert(branches.includes("main"), `main must never be removed, got ${branches}`);
  return branches;
};

test("a claim returns the branch, base, base sha and tree, and lands one empty commit on origin", () => {
  const { origin, main, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  const baseSha = main();
  const result = claim(repo);
  assert.equal(result.status, EXIT_CLAIMED, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { branch: BRANCH, base: "main", baseSha, tree: repo });
  const tip = refOnOrigin(origin, BRANCH);
  assert.equal(git(origin, ["log", "-1", "--format=%s", tip]), CLAIM_COMMIT_SUBJECT);
  assert.equal(git(origin, ["rev-parse", `${tip}^`]), baseSha);
  assert.equal(git(origin, ["diff", "--name-only", `${tip}^`, tip]), "");
  assert.equal(git(repo, ["branch", "--show-current"]), BRANCH);
  assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "@{upstream}"]), `origin/${BRANCH}`);
  assert.equal(main(), baseSha);
});

test("the claim starts from the updated main, not a stale local one", () => {
  const { origin, main, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  const other = cloneOf("other");
  git(other, ["commit", "-q", "--allow-empty", "-m", "main moves on"]);
  git(other, ["push", "-q", "origin", "main:refs/heads/main"]);
  const result = claim(repo);
  assert.equal(result.status, EXIT_CLAIMED, result.stderr);
  assert.equal(JSON.parse(result.stdout).baseSha, main());
  assert.equal(git(origin, ["rev-parse", `${refOnOrigin(origin, BRANCH)}^`]), main());
});

test("push.default=upstream never lets the claim land on main", () => {
  const { main, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  git(repo, ["config", "push.default", "upstream"]);
  const mainBefore = main();
  const result = claim(repo);
  assert.equal(result.status, EXIT_CLAIMED, result.stderr);
  assert.equal(main(), mainBefore);
});

test("a claim in a slice tree cuts from origin/main and never touches main, even under push.default=upstream", () => {
  const { origin, main, root, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  git(repo, ["config", "push.default", "upstream"]);
  const mainBefore = main();
  const tree = join(root, "trees", "T-1-s1-alice");
  const result = claim(repo, ["--tree", tree]);
  assert.equal(result.status, EXIT_CLAIMED, result.stderr);
  const claimed = JSON.parse(result.stdout);
  assert.deepEqual(claimed, { branch: BRANCH, base: "main", baseSha: mainBefore, tree });
  assert.equal(git(tree, ["branch", "--show-current"]), BRANCH);
  assert.equal(git(repo, ["branch", "--show-current"]), "main");
  assert.equal(refOnOrigin(origin, BRANCH), git(tree, ["rev-parse", "HEAD"]));
  assert.equal(main(), mainBefore);
});

test("a claim may start from the ticket's own earlier slice branch and still branches from main", () => {
  const { main, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  assert.equal(claim(repo).status, EXIT_CLAIMED);
  const second = spawnSync(process.execPath, [SCRIPT, "--repo", repo, "--ticket", TICKET, "--slice", "2", "--slug", "beta"], { encoding: ENCODING });
  assert.equal(second.status, EXIT_CLAIMED, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { branch: "feat/T-1-beta-s2", base: "main", baseSha: main(), tree: repo });
});

test("a stacked claim branches from the named base and records that base's sha", () => {
  const { clone: cloneOf } = world();
  const repo = cloneOf("alice");
  git(repo, ["checkout", "-q", "-b", "feat/T-1-pred-s0"]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", "predecessor work"]);
  const predecessorSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["checkout", "-q", "main"]);
  const result = claim(repo, ["--base", "feat/T-1-pred-s0"]);
  assert.equal(result.status, EXIT_CLAIMED, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { branch: BRANCH, base: "feat/T-1-pred-s0", baseSha: predecessorSha, tree: repo });
  assert.equal(git(repo, ["rev-parse", `${BRANCH}^`]), predecessorSha);
});

test("a second claimant is held and nothing it created is left behind", () => {
  const { origin, clone: cloneOf } = world();
  const alice = cloneOf("alice");
  const bob = cloneOf("bob");
  assert.equal(claim(alice).status, EXIT_CLAIMED);
  const winnerTip = refOnOrigin(origin, BRANCH);
  const result = claim(bob);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(refOnOrigin(origin, BRANCH), winnerTip);
  assert.deepEqual(localBranches(bob), ["main"]);
  assert.equal(git(bob, ["branch", "--show-current"]), "main");
});

test("a second claimant in a slice tree is held and leaves no tree and no branch", () => {
  const { origin, root, clone: cloneOf } = world();
  const alice = cloneOf("alice");
  const bob = cloneOf("bob");
  assert.equal(claim(alice).status, EXIT_CLAIMED);
  const winnerTip = refOnOrigin(origin, BRANCH);
  const tree = join(root, "trees", "T-1-s1-bob");
  const result = claim(bob, ["--tree", tree]);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(existsSync(tree), false);
  assert.equal(refOnOrigin(origin, BRANCH), winnerTip);
  assert.deepEqual(localBranches(bob), ["main"]);
});

const rivalWinsDuringPush = (origin, repo, cloneOf) => {
  const rival = cloneOf("rival");
  git(rival, ["checkout", "-q", "-b", BRANCH]);
  git(rival, ["commit", "-q", "--allow-empty", "-m", "rival claim"]);
  const hook = join(repo, ".git", "hooks", "pre-push");
  assert(existsSync(dirname(hook)), `the hooks directory must exist, got ${dirname(hook)}`);
  writeFileSync(hook, `#!/bin/sh\nenv -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "${rival}" push -q origin ${BRANCH}:refs/heads/${BRANCH}\n`);
  chmodSync(hook, HOOK_MODE);
  assert(refOnOrigin(origin, BRANCH) === "", "the rival must not have pushed yet");
  return rival;
};

test("a claim that loses the push to a rival is held and removes only what it made", () => {
  const { origin, root, clone: cloneOf } = world();
  const repo = cloneOf("bob");
  const rival = rivalWinsDuringPush(origin, repo, cloneOf);
  const result = claim(repo);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(refOnOrigin(origin, BRANCH), git(rival, ["rev-parse", BRANCH]));
  assert.deepEqual(localBranches(repo), ["main"]);
  assert.equal(git(repo, ["branch", "--show-current"]), "main");
});

test("a slice-tree claim that loses the push to a rival removes its tree and branch", () => {
  const { origin, root, clone: cloneOf } = world();
  const repo = cloneOf("bob");
  const rival = rivalWinsDuringPush(origin, repo, cloneOf);
  const tree = join(root, "trees", "T-1-s1-bob");
  const result = claim(repo, ["--tree", tree]);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(refOnOrigin(origin, BRANCH), git(rival, ["rev-parse", BRANCH]));
  assert.equal(existsSync(tree), false);
  assert.deepEqual(localBranches(repo), ["main"]);
});

test("a pre-existing local branch of that name is held and left untouched", () => {
  const { origin, clone: cloneOf } = world();
  const bob = cloneOf("bob");
  git(bob, ["checkout", "-q", "-b", BRANCH]);
  git(bob, ["commit", "-q", "--allow-empty", "-m", "bob's own work"]);
  const ownTip = git(bob, ["rev-parse", "HEAD"]);
  git(bob, ["checkout", "-q", "main"]);
  const result = claim(bob);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(git(bob, ["rev-parse", BRANCH]), ownTip);
  assert.equal(refOnOrigin(origin, BRANCH), "");
  assert.equal(git(bob, ["branch", "--show-current"]), "main");
});

test("a branch already on origin that could be fast-forwarded is not pushed over", () => {
  const { origin, main, clone: cloneOf } = world();
  const holder = cloneOf("holder");
  git(holder, ["checkout", "-q", "-b", BRANCH]);
  git(holder, ["commit", "-q", "--allow-empty", "-m", "holder work"]);
  git(holder, ["push", "-q", "origin", `${BRANCH}:refs/heads/${BRANCH}`]);
  const holderTip = refOnOrigin(origin, BRANCH);
  git(origin, ["merge-base", "--is-ancestor", main(), holderTip]);
  const bob = cloneOf("bob");
  const result = claim(bob);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(refOnOrigin(origin, BRANCH), holderTip);
  assert.deepEqual(localBranches(bob), ["main"]);
});

const claimConcurrently = async (repos, env) => {
  assert(repos.length === 2, `the race needs two claimants, got ${repos.length}`);
  assert(env.GIT_AUTHOR_DATE === undefined || env.GIT_AUTHOR_DATE === env.GIT_COMMITTER_DATE, "a frozen clock must use one date");
  return Promise.all(
    repos.map(
      (repo) =>
        new Promise((resolveExit) => {
          const child = spawn(process.execPath, [SCRIPT, "--repo", repo, ...CLAIM_ARGS], { stdio: "ignore", env: { ...process.env, ...env } });
          child.on("close", resolveExit);
        }),
    ),
  );
};

test("two claimants running at the same moment: exactly one holds the slice", async () => {
  const { origin, clone: cloneOf } = world();
  const repos = [cloneOf("alice"), cloneOf("bob")];
  const exits = await claimConcurrently(repos, {});
  assert.deepEqual([...exits].sort(), [EXIT_CLAIMED, EXIT_HELD]);
  assert.equal(git(origin, ["rev-list", "--count", `main..${BRANCH}`]), "1");
  const loser = repos[exits.indexOf(EXIT_HELD)];
  assert.deepEqual(localBranches(loser), ["main"]);
});

test("two claimants with one identity and a frozen clock: the second is held, one claim commit lands", () => {
  const { origin, clone: cloneOf } = world();
  const first = cloneOf("twin1", "alice");
  const second = cloneOf("twin2", "alice");
  assert.equal(claim(first, [], FROZEN_CLOCK).status, EXIT_CLAIMED);
  const winnerTip = refOnOrigin(origin, BRANCH);
  const result = claim(second, [], FROZEN_CLOCK);
  assert.equal(result.status, EXIT_HELD, result.stderr);
  assert.equal(refOnOrigin(origin, BRANCH), winnerTip);
  assert.equal(git(origin, ["rev-list", "--count", `main..${BRANCH}`]), "1");
  assert.deepEqual(localBranches(second), ["main"]);
});

test("two concurrent claimants with one identity and a frozen clock: exactly one holds the slice", async () => {
  const { origin, clone: cloneOf } = world();
  const repos = [cloneOf("twin1", "alice"), cloneOf("twin2", "alice")];
  const exits = await claimConcurrently(repos, FROZEN_CLOCK);
  assert.deepEqual([...exits].sort(), [EXIT_CLAIMED, EXIT_HELD]);
  assert.equal(git(origin, ["rev-list", "--count", `main..${BRANCH}`]), "1");
});

test("a push that fails for a reason other than a held slice is a precondition failure and is cleaned up", () => {
  const { root, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  git(repo, ["remote", "set-url", "--push", "origin", join(root, "missing.git")]);
  const result = claim(repo, ["--base", "main"]);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.deepEqual(localBranches(repo), ["main"]);
  assert.equal(git(repo, ["branch", "--show-current"]), "main");
});

test("a dirty tree is refused before anything is created", () => {
  const { origin, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  writeFileSync(join(repo, "file.txt"), "edited\n");
  const result = claim(repo);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.match(result.stderr, /working tree must be clean, but "file\.txt" changed/);
  assertActionable(result.stderr.trim().replace(/^slice-claim: /, ""));
  assert.deepEqual(localBranches(repo), ["main"]);
  assert.equal(refOnOrigin(origin, BRANCH), "");
});

test("HEAD on an unrelated branch is refused before anything is created", () => {
  const { origin, clone: cloneOf } = world();
  const repo = cloneOf("alice");
  git(repo, ["checkout", "-q", "-b", "feat/OTHER-9-thing-s1"]);
  const result = claim(repo);
  assert.equal(result.status, EXIT_PRECONDITION);
  assert.match(result.stderr, /HEAD must be main or a branch of T-1/);
  assertActionable(result.stderr.trim().replace(/^slice-claim: /, ""));
  assert.equal(git(repo, ["branch", "--show-current"]), "feat/OTHER-9-thing-s1");
  assert.equal(refOnOrigin(origin, BRANCH), "");
});

test("bad or missing options are usage errors", () => {
  const { clone: cloneOf } = world();
  const repo = cloneOf("alice");
  const badCalls = [
    ["--slice", "1", "--slug", SLUG],
    ["--ticket", "bad/id", "--slice", "1", "--slug", SLUG],
    ["--ticket", TICKET, "--slug", SLUG],
    ["--ticket", TICKET, "--slice", "0", "--slug", SLUG],
    ["--ticket", TICKET, "--slice", "1"],
    ["--ticket", TICKET, "--slice", "1", "--slug", "Not A Slug"],
    [...CLAIM_ARGS, "--unknown", "x"],
  ];
  for (const args of badCalls) {
    const result = spawnSync(process.execPath, [SCRIPT, "--repo", repo, ...args], { encoding: ENCODING });
    assert.equal(result.status, EXIT_USAGE, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, /usage: slice-claim\.mjs/);
    if (!args.includes("--unknown")) assertActionable(result.stderr.split("\n")[0].replace(/^slice-claim: /, ""));
  }
  assert.deepEqual(localBranches(repo), ["main"]);
});
