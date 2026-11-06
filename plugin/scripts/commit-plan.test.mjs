import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutFacts, conventionOf, main, nearestClaudeMd, plan, prBodyFile, refusal, sourceOf, stagingProblems } from "./commit-plan.mjs";
import { runScript } from "./run-cli.test.support.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "commit-plan.mjs");
const EXIT_PLANNED = 0;
const EXIT_NEEDS_TICKET = 1;
const EXIT_USAGE = 2;
const EXIT_BAD_STAGING = 3;
const ACME_ORIGIN = "git@github.com:acme/demo.git";
const FOREIGN_ORIGIN = "git@github.com:someone/demo.git";
const KEYED_BRANCH = "feat/ACME-7-greeting";
const KEYLESS_BRANCH = "feat/greeting";
const DESCRIPTION = "add greeting";
const NOTES = "/notes";

const conventionWith = (appliesTo, extra = []) => {
  assert(typeof appliesTo === "string" && appliesTo !== "", `the Applies to text must be a non-empty string, got ${JSON.stringify(appliesTo)}`);
  assert(Array.isArray(extra), `the extra lines must be a list, got ${typeof extra}`);
  return ["## Commit convention", "", `- **Applies to:** ${appliesTo}`, "- **Subject:** `<type>(<KEY>-<N>): <description>`", "- **Branch:** `<type>/<KEY>-<N>-<short-desc>`", ...extra, "", "## Other", "- **Subject:** `wrong`", ""].join("\n");
};

const claudeMdFile = (text) => {
  assert(typeof text === "string", `the CLAUDE.md text must be a string, got ${typeof text}`);
  assert(text.length > 0, `the CLAUDE.md text must not be empty, got ${JSON.stringify(text)}`);
  const file = join(mkdtempSync(join(tmpdir(), "commit-plan-")), "CLAUDE.md");
  writeFileSync(file, text);
  return file;
};

const ACME = claudeMdFile(conventionWith("origins under `acme/`"));
const PROSE = claudeMdFile(conventionWith("every repository of the Acme organisation"));
const NO_SECTION = claudeMdFile("## Other\n- **Subject:** `wrong`\n");

const planCli = ({ claudeMd = ACME, origin = ACME_ORIGIN, branch = KEYED_BRANCH, type = "feat", extra = [], paths = [] } = {}) => {
  assert(Array.isArray(extra) && Array.isArray(paths), `extra and paths must be lists, got ${JSON.stringify({ extra, paths })}`);
  assert(typeof claudeMd === "string" && typeof type === "string", `claudeMd and type must be file and type strings, got ${typeof claudeMd} and ${typeof type}; pass the fixture path and a commit type`);
  return runScript(SCRIPT, ["--claude-md", claudeMd, "--origin", origin, "--branch", branch, "--type", type, "--description", DESCRIPTION, "--local-notes", NOTES, ...extra, ...(paths.length > 0 ? ["--", ...paths] : [])]);
};

test("rejects a matching origin whose branch carries no ticket key and says how to proceed", () => {
  const result = planCli({ branch: KEYLESS_BRANCH });
  assert.equal(result.status, EXIT_NEEDS_TICKET);
  assert.match(result.stderr, /branch "feat\/greeting" carries no ticket key/);
  assert.match(result.stderr, /ask which ticket.*--ticket <KEY-N>/);
  assert.equal(result.stdout, "");
});

test("rejects stage-all flags, globs, pathspec magic and agent scratch, naming each value", () => {
  const refused = [".", "-A", "--all", "src/*.ts", ":(top)a", ".claude/notes.md", "pkg/.claude/x"];
  const result = planCli({ paths: refused });
  assert.equal(result.status, EXIT_BAD_STAGING);
  refused.forEach((path) => assert.ok(result.stderr.includes(JSON.stringify(path)), `${path} must be named in: ${result.stderr}`));
  assert.match(result.stderr, /explicit path/);
  assert.equal(result.stdout, "");
});

test("rejects an unknown plain type on a foreign origin", () => {
  const result = planCli({ origin: FOREIGN_ORIGIN, type: "wip" });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /--type "wip" is not plain Conventional Commits; use one of feat fix chore/);
});

test("rejects a malformed ticket override", () => {
  const result = planCli({ branch: KEYLESS_BRANCH, extra: ["--ticket", "acme7"] });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /--ticket "acme7" is not a ticket key like ABC-123/);
});

test("rejects missing flags and names them", () => {
  const result = runScript(SCRIPT, ["--origin", ACME_ORIGIN]);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /missing --type, --description/);
});

test("rejects an unreadable CLAUDE.md and an unknown flag as usage errors", () => {
  assert.equal(planCli({ claudeMd: join(tmpdir(), "no-such-claude.md") }).status, EXIT_USAGE);
  assert.equal(planCli({ extra: ["--bogus"] }).status, EXIT_USAGE);
});

test("rejects a client Subject template with a placeholder it cannot fill", () => {
  const claudeMd = claudeMdFile("## Commit convention\n- **Applies to:** `acme/`\n- **Subject:** `<type>(<scope>): <description>`\n");
  const result = planCli({ claudeMd });
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /leaves <scope> unfilled.*write the subject by hand/);
});

test("accepts a matching origin with a key in the branch as a client subject", () => {
  const result = planCli();
  assert.equal(result.status, EXIT_PLANNED);
  assert.deepEqual(JSON.parse(result.stdout), {
    source: "client",
    subject: "feat(ACME-7): add greeting",
    branchTemplate: "<type>/<KEY>-<N>-<short-desc>",
    prBodyFile: "/notes/pr-body-feat-ACME-7-greeting.md",
  });
});

test("accepts the ticket override when the branch has no key", () => {
  const result = planCli({ branch: "main", extra: ["--ticket", "ACME-9"] });
  assert.equal(result.status, EXIT_PLANNED);
  assert.equal(JSON.parse(result.stdout).subject, "feat(ACME-9): add greeting");
});

test("accepts a foreign origin as a plain keyless subject on purpose", () => {
  const result = planCli({ origin: FOREIGN_ORIGIN, branch: KEYLESS_BRANCH });
  assert.equal(result.status, EXIT_PLANNED);
  const planned = JSON.parse(result.stdout);
  assert.deepEqual([planned.source, planned.subject, planned.branchTemplate], ["plain", "feat: add greeting", "<type>/<short-desc>"]);
});

test("accepts a plain scoped breaking type", () => {
  assert.equal(JSON.parse(planCli({ origin: FOREIGN_ORIGIN, type: "feat(api)!" }).stdout).subject, "feat(api)!: add greeting");
});

test("marks a prose Applies to as plain-unproven instead of guessing a match", () => {
  const result = planCli({ claudeMd: PROSE, branch: KEYLESS_BRANCH });
  assert.equal(result.status, EXIT_PLANNED);
  const planned = JSON.parse(result.stdout);
  assert.deepEqual([planned.source, planned.subject], ["plain-unproven", "feat: add greeting"]);
});

test("accepts a CLAUDE.md without a convention section as plain", () => {
  assert.equal(JSON.parse(planCli({ claudeMd: NO_SECTION }).stdout).source, "plain");
});

test("accepts explicit paths and replaces every slash of the branch in the body file", () => {
  const result = planCli({ branch: "feat/ACME-7/deep", paths: ["src/a.ts", "docs/b.md"] });
  assert.equal(result.status, EXIT_PLANNED);
  assert.equal(JSON.parse(result.stdout).prBodyFile, "/notes/pr-body-feat-ACME-7-deep.md");
});

const checkoutWith = (origin, branch) => {
  assert(typeof origin === "string", `the origin must be a string, got ${typeof origin}`);
  assert(branch !== "", `the branch must not be empty, got ${JSON.stringify(branch)}; name the branch to init`);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "commit-plan-repo-")));
  const nested = join(root, "packages", "app");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), conventionWith("origins under `acme/`"));
  assert.equal(spawnSync("git", ["init", "-q", "-b", branch], { cwd: root }).status, 0, "the checkout must initialise");
  if (origin) assert.equal(spawnSync("git", ["remote", "add", "origin", origin], { cwd: root }).status, 0, "the remote must be added");
  return nested;
};

const defaultsCli = (cwd) => {
  assert(typeof cwd === "string" && cwd !== "", `the working directory must be a path, got ${JSON.stringify(cwd)}`);
  assert(existsSync(cwd), `the working directory must exist, got ${cwd}`);
  return runScript(SCRIPT, ["--type", "feat", "--description", DESCRIPTION], { cwd });
};

test("rejects a refusal without a message or with an unknown exit code", () => {
  assert.throws(() => refusal("", EXIT_USAGE), /needs a message that says what to fix/);
  assert.throws(() => refusal("x", 9), /exits with one of 1, 2, 3, got 9/);
});

test("rejects a convention source that is not text, an ambiguous CLAUDE.md and a non-object convention", () => {
  assert.throws(() => conventionOf(undefined), /CLAUDE.md text must be a string/);
  assert.throws(() => conventionOf(`${conventionWith("`a/`")}\n${conventionWith("`b/`")}`), /holds 2 "## Commit convention" sections; keep one/);
  assert.throws(() => sourceOf("convention", ACME_ORIGIN), /convention must come from conventionOf, got string/);
  assert.throws(() => sourceOf(undefined, undefined), /origin must be a string.*--origin <url>/);
});

test("rejects staging and body-file inputs that are not explicit values", () => {
  assert.throws(() => stagingProblems("src/a.ts"), /must be a list/);
  assert.throws(() => stagingProblems(["src/a.ts", ""]), /every staged path must be a non-empty string/);
  assert.throws(() => prBodyFile(""), /branch name must be a non-empty string/);
  assert.throws(() => prBodyFile("feat/x", "relative/notes"), /--local-notes must be an absolute directory.*Delivery notes/);
});

test("rejects a blank description and a missing branch in plan", () => {
  assert.throws(() => plan({ claudeMd: "", origin: "", branch: "b", type: "feat", description: "  " }), /--description must say what the change does/);
  assert.throws(() => plan({ claudeMd: "", origin: "", branch: undefined, type: "feat", description: "x" }), /branch must be a string.*--branch <name>/);
});

test("rejects relative or missing directories for the CLAUDE.md search and the checkout facts", () => {
  assert.throws(() => nearestClaudeMd("relative"), /search directory must be absolute/);
  assert.throws(() => nearestClaudeMd(join(tmpdir(), "commit-plan-absent")), /search directory must exist/);
  assert.throws(() => checkoutFacts("relative"), /checkout directory must be absolute/);
  assert.throws(() => checkoutFacts(join(tmpdir(), "commit-plan-absent")), /checkout directory must exist/);
});

test("rejects arguments that are not a list of strings", () => {
  assert.throws(() => main("--type"), /arguments must be a list/);
  assert.throws(() => main(["--type", 1]), /every argument must be a string/);
});

test("conventionOf reads one section and nothing from a later heading", () => {
  assert.deepEqual(conventionOf(conventionWith("`acme/`")), { "Applies to": "`acme/`", Subject: "`<type>(<KEY>-<N>): <description>`", Branch: "`<type>/<KEY>-<N>-<short-desc>`" });
});

test("rejects a directory outside any checkout, naming the branch flag", () => {
  const result = defaultsCli(realpathSync(mkdtempSync(join(tmpdir(), "commit-plan-nogit-"))));
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /no current branch.*--branch <name>/);
});

test("defaults the CLAUDE.md, origin and branch to the nearest CLAUDE.md and the checkout", () => {
  const result = defaultsCli(checkoutWith(ACME_ORIGIN, KEYED_BRANCH));
  assert.equal(result.status, EXIT_PLANNED);
  assert.equal(JSON.parse(result.stdout).subject, "feat(ACME-7): add greeting");
});

test("falls back to plain when the checkout has no remote", () => {
  assert.equal(JSON.parse(defaultsCli(checkoutWith("", KEYLESS_BRANCH)).stdout).source, "plain");
});

test("defaults the body file to the local notes home", () => {
  const result = runScript(SCRIPT, ["--claude-md", ACME, "--origin", ACME_ORIGIN, "--branch", KEYED_BRANCH, "--type", "feat", "--description", DESCRIPTION]);
  assert.match(JSON.parse(result.stdout).prBodyFile, /\.local\/state\/gated-delivery\/pr-body-feat-ACME-7-greeting\.md$/);
});
