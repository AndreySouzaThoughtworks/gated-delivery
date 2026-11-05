import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec } from "../../skills/spec/scripts/spec-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = join(HERE, "gh-stub.mjs");
const IDENTITY = { GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "tester@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "tester@example.com" };
const ENCODING = "utf8";
const EXECUTABLE = 0o755;
const MAIN = "main";
const SPEC_FILE = "docs/specs/T-1-demo.md";
const TICKET = "T-1";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
export const git = (cwd, args) => {
  assert(existsSync(cwd), `the directory must exist, got ${cwd}`);
  assert(args.length > 0, `a subcommand is required, got ${args.length} arguments`);
  return execFileSync("git", ["-C", cwd, ...args], { encoding: ENCODING, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).trim();
};

/**
 * @param {{ openDecision?: boolean, rollout?: boolean, waves?: string }} [shape]
 * @returns {string}
 */
export const specText = ({ openDecision = false, rollout = true, waves = "| 1 | S1 | only |\n| 2 | S2, S3 | independent |" } = {}) => {
  const decisions = openDecision ? "- **Options:** A or B" : "None.";
  const slices = [1, 2, 3].map((n) => `### Slice ${n} — AC${n} — exposure: complete\n\nBody.\n`).join("\n");
  const rolloutSection = rollout ? `## Rollout\n\n| Wave | Slices | Why |\n|---|---|---|\n${waves}\n\n${slices}` : "";
  const text = `---\nticket: ${TICKET}\ntype: change\nstatus: Draft\ncreated: 2026-01-01\n---\n# ${TICKET} — demo\n\n## Open decisions\n\n${decisions}\n\n${rolloutSection}`;
  assert(parseSpec(text).slices.length === (rollout ? 3 : 0), `the fixture spec must name ${rollout ? 3 : 0} slices`);
  assert(text.includes("## Open decisions"), "the fixture spec must carry its Open decisions section");
  return text;
};

/**
 * @param {{ spec?: string | null }} [shape]
 */
export const makeWorld = ({ spec = specText() } = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "slice-world-")));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const trees = join(root, "notes", "slice-trees");
  const bin = join(root, "bin");
  const fixture = join(root, "gh.json");
  mkdirSync(bin);
  mkdirSync(trees, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec node "${STUB}" "$@"\n`);
  chmodSync(join(bin, "gh"), EXECUTABLE);
  git(root, ["init", "-q", "--bare", "-b", MAIN, origin]);
  git(root, ["init", "-q", "-b", MAIN, repo]);
  git(repo, ["remote", "add", "origin", origin]);
  mkdirSync(join(repo, "docs", "specs"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "demo\n");
  if (spec !== null) writeFileSync(join(repo, SPEC_FILE), spec);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "init"]);
  git(repo, ["push", "-q", "origin", `${MAIN}:refs/heads/${MAIN}`]);
  const env = { ...process.env, ...IDENTITY, GH_STUB_FIXTURE: fixture, PATH: `${bin}${delimiter}${process.env.PATH}` };
  const world = {
    root,
    repo,
    origin,
    trees,
    specPath: join(repo, SPEC_FILE),
    git: (/** @type {string} */ cwd, /** @type {string[]} */ args) => git(cwd, args),
    prs: (/** @type {unknown[]} */ list = [], /** @type {Record<string, unknown>} */ view = {}) => writeFileSync(fixture, JSON.stringify({ list, view })),
    branch: (/** @type {string} */ name, { push = false, message = `work on ${name}`, tree = null } = {}) => {
      git(repo, ["checkout", "-q", "-b", name, MAIN]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", message]);
      const sha = git(repo, ["rev-parse", "HEAD"]);
      if (push) git(repo, ["push", "-q", "origin", `${name}:refs/heads/${name}`]);
      git(repo, ["checkout", "-q", MAIN]);
      if (tree !== null) git(repo, ["worktree", "add", "-q", join(trees, tree), name]);
      return sha;
    },
    run: (/** @type {string} */ script, /** @type {string[]} */ args) => {
      const result = spawnSync("node", [join(dirname(HERE), script), ...args], { encoding: ENCODING, env, cwd: repo });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, json: () => JSON.parse(result.stdout) };
    },
  };
  world.prs();
  assert(existsSync(join(repo, ".git")), `the world repository must be initialised at ${repo}`);
  assert(spec === null || existsSync(world.specPath), `the spec must be written at ${world.specPath}`);
  return world;
};
