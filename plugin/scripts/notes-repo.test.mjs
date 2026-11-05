import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "notes-repo.mjs");
const EXIT_OK = 0;
const EXIT_GIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_CONFLICT = 3;
const EXIT_STOP = 4;
const NOTES_REPO_ENV = "GATED_DELIVERY_NOTES_REPO";
const CLONE_LOG_ENV = "GH_STUB_CLONE_LOG";
const ORIGIN_ENV = "GH_STUB_ORIGIN";
const GH_STUB = `#!/bin/sh
echo "$@" >> "$${CLONE_LOG_ENV}"
git clone --quiet "$${ORIGIN_ENV}" "$4"
`;
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const git = (cwd, args) => {
  assert(Array.isArray(args), `git arguments must be a list, got ${typeof args}`);
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  assert(result.status === 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trimEnd();
};

const commitFile = (checkout, name, content, message = `edit ${name}`) => {
  writeFileSync(join(checkout, name), content);
  git(checkout, ["add", name]);
  git(checkout, ["commit", "-q", "-m", message]);
  assert(git(checkout, ["status", "--porcelain", "--", name]) === "", `${name} must be committed`);
  assert(git(checkout, ["log", "-1", "--format=%s"]) === message, "the commit must carry the given message");
};

const world = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "notes-repo-test-")));
  const origin = join(root, "origin.git");
  git(root, ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = join(root, "seed");
  git(root, ["clone", "-q", origin, seed]);
  git(seed, ["checkout", "-q", "-b", "main"]);
  commitFile(seed, "a.md", "a\n");
  commitFile(seed, "b.md", "b\n");
  git(seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  const notes = join(root, "notes");
  git(root, ["clone", "-q", origin, notes]);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
  const cloneLog = join(root, "clone.log");
  assert(existsSync(join(notes, ".git")), `${notes} must be a checkout`);
  assert(existsSync(join(bin, "gh")), `the gh stub must be installed in ${bin}`);
  return { root, origin, seed, notes, bin, cloneLog };
};

const script = (scene, args, extraEnv = {}) => {
  assert(Array.isArray(args), `script arguments must be a list, got ${typeof args}`);
  const env = { ...process.env, ...GIT_ENV, PATH: `${scene.bin}${delimiter}${process.env.PATH}`, [CLONE_LOG_ENV]: scene.cloneLog, [ORIGIN_ENV]: scene.origin, [NOTES_REPO_ENV]: "", ...extraEnv };
  const result = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", env });
  assert(result.status !== null, `the script must exit on its own, got ${result.signal}`);
  return { ...result, json: result.stdout.trim().startsWith("{") ? JSON.parse(result.stdout) : null };
};

const prepare = (scene, extra = []) => {
  assert(Array.isArray(extra), `extra arguments must be a list, got ${typeof extra}`);
  assert(existsSync(scene.notes), `${scene.notes} must exist`);
  return script(scene, ["prepare", ...extra], { [NOTES_REPO_ENV]: scene.notes });
};
const publish = (scene, files, message = "publish notes") => {
  assert(Array.isArray(files), `files must be a list, got ${typeof files}`);
  assert(typeof message === "string", `the message must be text, got ${typeof message}`);
  return script(scene, ["publish", "--path", scene.notes, ...files.flatMap((file) => ["--file", file]), "--message", message]);
};
const originLog = (scene) => {
  assert(existsSync(scene.origin), `${scene.origin} must exist`);
  assert(typeof scene.origin === "string", "the origin must be a path");
  return git(scene.origin, ["log", "--format=%s", "main"]);
};
const originFile = (scene, name) => {
  assert(existsSync(scene.origin), `${scene.origin} must exist`);
  assert(typeof name === "string" && name !== "", `the file name must be text, got ${JSON.stringify(name)}`);
  return git(scene.origin, ["show", `main:${name}`]);
};
const assertNoHalfMerge = (checkout) => {
  const status = git(checkout, ["status", "--porcelain"]);
  assert(status === "", `the tree must be clean, got ${status}`);
  assert(!existsSync(join(checkout, ".git", "MERGE_HEAD")), `no merge may be left in progress in ${checkout}`);
};

test("prepare on a clean main that is behind pulls and reports the count", () => {
  const scene = world();
  commitFile(scene.seed, "c.md", "c\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  const result = prepare(scene);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(result.json, { inRepo: false, path: scene.notes, branch: "main", clean: true, behind: 1 });
  assert.equal(readFileSync(join(scene.notes, "c.md"), "utf8"), "c\n");
});

test("prepare on a dirty checkout stops with exit 4 and leaves HEAD where it was", () => {
  const scene = world();
  const before = git(scene.notes, ["rev-parse", "HEAD"]);
  commitFile(scene.seed, "c.md", "c\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  writeFileSync(join(scene.notes, "a.md"), "dirty\n");
  const result = prepare(scene);
  assert.equal(result.status, EXIT_STOP);
  assert.match(result.stderr, /^STOP: .*dirty/);
  assert.deepEqual(result.json, { inRepo: false, path: scene.notes, branch: "main", clean: false, behind: null });
  assert.equal(git(scene.notes, ["rev-parse", "HEAD"]), before);
  assert.equal(readFileSync(join(scene.notes, "a.md"), "utf8"), "dirty\n");
});

test("prepare on a feature branch stops with exit 4 and leaves the branch alone", () => {
  const scene = world();
  git(scene.notes, ["checkout", "-q", "-b", "feat/other"]);
  const before = git(scene.notes, ["rev-parse", "HEAD"]);
  const result = prepare(scene);
  assert.equal(result.status, EXIT_STOP);
  assert.equal(result.json.branch, "feat/other");
  assert.equal(git(scene.notes, ["rev-parse", "--abbrev-ref", "HEAD"]), "feat/other");
  assert.equal(git(scene.notes, ["rev-parse", "HEAD"]), before);
});

test("prepare on a detached HEAD stops with exit 4", () => {
  const scene = world();
  git(scene.notes, ["checkout", "-q", "--detach"]);
  assert.equal(prepare(scene).status, EXIT_STOP);
});

test("prepare merges a divergence with non-overlapping changes and keeps both", () => {
  const scene = world();
  commitFile(scene.notes, "local.md", "local\n");
  commitFile(scene.seed, "remote.md", "remote\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  const result = prepare(scene);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(result.json.behind, 1);
  assert.equal(readFileSync(join(scene.notes, "local.md"), "utf8"), "local\n");
  assert.equal(readFileSync(join(scene.notes, "remote.md"), "utf8"), "remote\n");
  assertNoHalfMerge(scene.notes);
});

test("prepare on a conflicting divergence exits 3 and leaves no half-merge", () => {
  const scene = world();
  commitFile(scene.notes, "a.md", "local edit\n");
  commitFile(scene.seed, "a.md", "remote edit\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  const result = prepare(scene);
  assert.equal(result.status, EXIT_CONFLICT);
  assertNoHalfMerge(scene.notes);
  assert.equal(readFileSync(join(scene.notes, "a.md"), "utf8"), "local edit\n");
});

test("prepare clones through gh into a temporary directory when no checkout is configured", () => {
  const scene = world();
  const result = script(scene, ["prepare", "--repo-name", "owner/notes"]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.json.path, new RegExp(`^${realpathSync(tmpdir())}/gated-delivery-notes-`));
  assert.equal(result.json.branch, "main");
  assert.match(readFileSync(scene.cloneLog, "utf8"), /^repo clone owner\/notes /);
  assert.equal(readFileSync(join(result.json.path, "a.md"), "utf8"), "a\n");
});

test("prepare prefers the configured checkout over cloning", () => {
  const scene = world();
  const result = script(scene, ["prepare", "--repo-name", "owner/notes"], { [NOTES_REPO_ENV]: scene.notes });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(result.json.path, scene.notes);
  assert.equal(existsSync(scene.cloneLog), false);
});

test("prepare with --in-repo says so and neither clones nor touches git", () => {
  const scene = world();
  const result = script(scene, ["prepare", "--in-repo", "--repo-name", "owner/notes"]);
  assert.equal(result.status, EXIT_OK);
  assert.deepEqual(result.json, { inRepo: true, path: null, branch: null, clean: null, behind: null });
  assert.equal(existsSync(scene.cloneLog), false);
});

test("prepare without a checkout, a repository name or --in-repo is a usage error", () => {
  const result = script(world(), ["prepare"]);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /no notes checkout/);
});

test("prepare with a configured path that is not a checkout is a usage error", () => {
  const scene = world();
  const result = script(scene, ["prepare"], { [NOTES_REPO_ENV]: scene.root });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /is not a git checkout/);
});

test("an unknown subcommand and an unknown option are usage errors", () => {
  const scene = world();
  const unknownCommand = script(scene, ["deploy"]);
  assert.equal(unknownCommand.status, EXIT_USAGE);
  assert.match(unknownCommand.stderr, /unknown subcommand "deploy"/);
  assert.equal(script(scene, ["prepare", "--force"]).status, EXIT_USAGE);
});

test("prepare reports a git failure that is not a conflict with exit 1", () => {
  const scene = world();
  git(scene.notes, ["remote", "set-url", "origin", join(scene.root, "missing.git")]);
  assert.equal(prepare(scene).status, EXIT_GIT_FAILED);
});

test("publish stages only the named files and pushes to origin main", () => {
  const scene = world();
  writeFileSync(join(scene.notes, "new.md"), "new\n");
  writeFileSync(join(scene.notes, "a.md"), "dirty a\n");
  writeFileSync(join(scene.notes, "staged.md"), "staged\n");
  git(scene.notes, ["add", "staged.md"]);
  writeFileSync(join(scene.notes, "untracked.md"), "untracked\n");
  const result = publish(scene, ["new.md"], "add new");
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(result.json, { path: scene.notes, branch: "main", committed: true, pushed: true });
  assert.equal(git(scene.notes, ["show", "--name-only", "--format=", "HEAD"]), "new.md");
  assert.equal(originFile(scene, "new.md"), "new");
  assert.equal(git(scene.notes, ["status", "--porcelain"]), " M a.md\nA  staged.md\n?? untracked.md");
  assert.match(originLog(scene), /^add new$/m);
});

test("publish commits the message it was given exactly", () => {
  const scene = world();
  writeFileSync(join(scene.notes, "new.md"), "new\n");
  publish(scene, ["new.md"], "notes: PROJ-1 handoff");
  assert.equal(git(scene.origin, ["log", "-1", "--format=%s", "main"]), "notes: PROJ-1 handoff");
});

test("publish with an empty file list is a usage error and commits nothing", () => {
  const scene = world();
  writeFileSync(join(scene.notes, "a.md"), "dirty\n");
  const before = git(scene.notes, ["rev-parse", "HEAD"]);
  const result = publish(scene, []);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /--file needs at least one path/);
  assert.equal(git(scene.notes, ["rev-parse", "HEAD"]), before);
  assert.equal(git(scene.notes, ["status", "--porcelain"]), " M a.md");
});

test("publish rejects a directory and the dot path so nothing is staged wholesale", () => {
  const scene = world();
  mkdirSync(join(scene.notes, "PROJ-1"));
  writeFileSync(join(scene.notes, "PROJ-1", "x.md"), "x\n");
  const directory = publish(scene, ["PROJ-1"]);
  assert.equal(directory.status, EXIT_USAGE);
  assert.match(directory.stderr, /PROJ-1 is a directory/);
  assert.equal(publish(scene, ["."]).status, EXIT_USAGE);
  assert.equal(git(scene.notes, ["status", "--porcelain"]), "?? PROJ-1/");
});

test("publish treats a glob as a literal path and stages nothing else", () => {
  const scene = world();
  writeFileSync(join(scene.notes, "other.md"), "other\n");
  const result = publish(scene, ["*"]);
  assert.equal(result.status, EXIT_GIT_FAILED);
  assert.equal(git(scene.notes, ["status", "--porcelain"]), "?? other.md");
});

test("publish requires a path and a message", () => {
  const scene = world();
  assert.equal(script(scene, ["publish", "--file", "a.md", "--message", "m"]).status, EXIT_USAGE);
  assert.equal(script(scene, ["publish", "--path", scene.notes, "--file", "a.md"]).status, EXIT_USAGE);
  assert.equal(script(scene, ["publish", "--path", scene.notes, "--file", "a.md", "--message", "  "]).status, EXIT_USAGE);
});

test("publish with a path that is not a checkout is a usage error", () => {
  const scene = world();
  const result = script(scene, ["publish", "--path", scene.root, "--file", "a.md", "--message", "m"]);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /is not a git checkout/);
});

test("publish on a feature branch stops with exit 4 and commits nothing", () => {
  const scene = world();
  git(scene.notes, ["checkout", "-q", "-b", "feat/other"]);
  writeFileSync(join(scene.notes, "new.md"), "new\n");
  const before = git(scene.notes, ["rev-parse", "HEAD"]);
  const result = publish(scene, ["new.md"]);
  assert.equal(result.status, EXIT_STOP);
  assert.equal(git(scene.notes, ["rev-parse", "HEAD"]), before);
  assert.equal(git(scene.notes, ["status", "--porcelain"]), "?? new.md");
  assert.doesNotMatch(originLog(scene), /publish notes/);
});

test("publish merges a divergence with non-overlapping changes, keeps both, and pushes without force", () => {
  const scene = world();
  commitFile(scene.seed, "remote.md", "remote\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  writeFileSync(join(scene.notes, "mine.md"), "mine\n");
  const result = publish(scene, ["mine.md"]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(originFile(scene, "mine.md"), "mine");
  assert.equal(originFile(scene, "remote.md"), "remote");
  assert.equal(git(scene.origin, ["rev-list", "--merges", "--count", "main"]), "1");
  assertNoHalfMerge(scene.notes);
});

test("publish on a conflict exits 3, pushes nothing, and leaves a clean tree with no MERGE_HEAD", () => {
  const scene = world();
  commitFile(scene.seed, "a.md", "remote edit\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  const originBefore = git(scene.origin, ["rev-parse", "main"]);
  writeFileSync(join(scene.notes, "a.md"), "local edit\n");
  const result = publish(scene, ["a.md"]);
  assert.equal(result.status, EXIT_CONFLICT);
  assert.deepEqual(result.json, { path: scene.notes, branch: "main", committed: true, pushed: false });
  assertNoHalfMerge(scene.notes);
  assert.equal(git(scene.origin, ["rev-parse", "main"]), originBefore);
});

test("publish reports a merge refused over a dirty file as a git failure, not a conflict", () => {
  const scene = world();
  commitFile(scene.seed, "b.md", "remote b\n");
  git(scene.seed, ["push", "-q", "origin", "main:refs/heads/main"]);
  writeFileSync(join(scene.notes, "b.md"), "dirty b\n");
  writeFileSync(join(scene.notes, "new.md"), "new\n");
  const result = publish(scene, ["new.md"]);
  assert.equal(result.status, EXIT_GIT_FAILED);
  assert.equal(existsSync(join(scene.notes, ".git", "MERGE_HEAD")), false);
  assert.equal(readFileSync(join(scene.notes, "b.md"), "utf8"), "dirty b\n");
});

test("publish run again after its commit already landed commits nothing and still pushes", () => {
  const scene = world();
  commitFile(scene.notes, "new.md", "new\n", "already committed");
  const result = publish(scene, ["new.md"]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(result.json, { path: scene.notes, branch: "main", committed: false, pushed: true });
  assert.equal(originFile(scene, "new.md"), "new");
});
