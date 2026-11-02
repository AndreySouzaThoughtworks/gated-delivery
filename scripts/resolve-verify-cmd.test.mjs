import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_COMMAND_MESSAGE, VERIFY_ENV, resolveVerifyCmd } from "../plugin/skills/slice/scripts/resolve-verify-cmd.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "slice", "scripts", "resolve-verify-cmd.mjs");
const FROM_INSTRUCTIONS = "make verify-from-instructions";
const FROM_REPO_FILE = "make verify-from-repo-claude";
const FROM_ENV = "make verify-from-env";
const NEAR_FOLDER_COMMAND = "make verify-near";
const FAR_FOLDER_COMMAND = "make verify-far";
const INSTRUCTIONS_OF = Object.fromEntries(
  [FROM_INSTRUCTIONS, FROM_REPO_FILE, NEAR_FOLDER_COMMAND, FAR_FOLDER_COMMAND].map((command) => [command, `# Rules\n\n## Verification\n\n**Verify command:** \`${command}\`\n`]),
);
const WITHOUT_COMMAND = "# Rules\n\n## Verification\n\nno command here\n";

const write = (path, body) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  assert(readFileSync(path, "utf8") === body, `${path} must hold the text just written, got ${readFileSync(path, "utf8").length} characters instead of ${body.length}`);
  assert(isAbsolute(path), `fixture files must be written by absolute path, got ${path}`);
};

const world = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "resolve-verify-home-")));
  const folder = join(home, "work");
  const repo = join(folder, "repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  assert(existsSync(join(repo, ".git")), `the repository fixture must be a git work tree, got no .git inside ${repo}`);
  assert(repo.startsWith(home), `the repository fixture must sit inside the fake home ${home}, got ${repo}`);
  return { home, repo, folder, options: { env: { HOME: home }, cwd: repo, home } };
};

test("the environment variable wins over a CLAUDE.md and package.json", () => {
  const w = world();
  write(join(w.folder, "CLAUDE.md"), INSTRUCTIONS_OF[FROM_INSTRUCTIONS]);
  write(join(w.repo, "package.json"), '{"scripts":{"check":"x"}}');
  const command = resolveVerifyCmd({ ...w.options, env: { HOME: w.home, [VERIFY_ENV]: FROM_ENV } });
  assert.equal(command, FROM_ENV, `got ${command}`);
  assert.equal(resolveVerifyCmd(w.options), FROM_INSTRUCTIONS, "without the variable the CLAUDE.md must win");
});

test("the nearest CLAUDE.md above the repository wins", () => {
  const w = world();
  write(join(w.home, "CLAUDE.md"), INSTRUCTIONS_OF[FAR_FOLDER_COMMAND]);
  write(join(w.folder, "CLAUDE.md"), INSTRUCTIONS_OF[NEAR_FOLDER_COMMAND]);
  assert.equal(resolveVerifyCmd(w.options), NEAR_FOLDER_COMMAND, "the nearer folder must win");
  write(join(w.folder, "CLAUDE.md"), WITHOUT_COMMAND);
  assert.equal(resolveVerifyCmd(w.options), FAR_FOLDER_COMMAND, "a CLAUDE.md without a Verify command must not stop the search");
});

test("the repository's own CLAUDE.md is never read", () => {
  const w = world();
  write(join(w.repo, "CLAUDE.md"), INSTRUCTIONS_OF[FROM_REPO_FILE]);
  assert.equal(resolveVerifyCmd(w.options), undefined, "a cloned repository must not choose the command");
  const plain = join(w.folder, "plain");
  write(join(plain, "CLAUDE.md"), INSTRUCTIONS_OF[FROM_REPO_FILE]);
  assert.equal(resolveVerifyCmd({ ...w.options, cwd: plain }), undefined, "a working folder outside any repository must not read its own CLAUDE.md either");
});

test("a folder inside a git work tree is never read", () => {
  const w = world();
  execFileSync("git", ["init", "-q", w.folder]);
  write(join(w.folder, "CLAUDE.md"), INSTRUCTIONS_OF[FROM_INSTRUCTIONS]);
  assert.equal(resolveVerifyCmd(w.options), undefined, "an outer work tree around the repository must not choose the command");
});

test("a symlinked CLAUDE.md is never read", () => {
  const w = world();
  const target = join(w.home, "elsewhere.md");
  write(target, INSTRUCTIONS_OF[FROM_INSTRUCTIONS]);
  symlinkSync(target, join(w.folder, "CLAUDE.md"));
  assert.equal(resolveVerifyCmd(w.options), undefined, "a symlink could point at a file someone else controls");
});

test("a CLAUDE.md outside the home folder is never read", () => {
  const w = world();
  write(join(dirname(w.home), "CLAUDE.md"), INSTRUCTIONS_OF[FROM_INSTRUCTIONS]);
  assert.equal(resolveVerifyCmd({ ...w.options, home: w.folder }), undefined, "the folder above home must stay unread");
  const otherHome = realpathSync(mkdtempSync(join(tmpdir(), "resolve-verify-other-")));
  write(join(w.folder, "CLAUDE.md"), INSTRUCTIONS_OF[FROM_INSTRUCTIONS]);
  assert.equal(resolveVerifyCmd({ ...w.options, home: otherHome }), undefined, "a repository outside home has no readable folder above it");
});

test("the first of check, lint, test in package.json runs through pnpm", () => {
  const w = world();
  write(join(w.repo, "package.json"), '{"scripts":{"test":"t","lint":"l"}}');
  assert.equal(resolveVerifyCmd(w.options), "pnpm lint", "lint comes before test");
  write(join(w.repo, "package.json"), '{"scripts":{"test":"t","lint":"l","check":"c"}}');
  assert.equal(resolveVerifyCmd(w.options), "pnpm check", "check comes first");
});

test("the command line prints the command, or fails with a plain message", () => {
  const w = world();
  const base = { cwd: w.repo, encoding: "utf8" };
  const printed = spawnSync("node", [SCRIPT], { ...base, env: { PATH: process.env.PATH, HOME: w.home, [VERIFY_ENV]: FROM_ENV } });
  assert.deepEqual([printed.status, printed.stdout], [0, `${FROM_ENV}\n`], "the command must be printed alone");
  const failed = spawnSync("node", [SCRIPT], { ...base, env: { PATH: process.env.PATH, HOME: w.home } });
  assert.deepEqual([failed.status, failed.stderr], [1, `${NO_COMMAND_MESSAGE}\n`], "no source must exit 1 with the message");
});
