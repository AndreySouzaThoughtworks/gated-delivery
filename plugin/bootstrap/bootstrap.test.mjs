import { test } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detect } from "./detect.mjs";
import { installPlan, isVerifiedInstall } from "./install-zanity.mjs";
import { unpinnedActions } from "./plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const PLAN = join(HERE, "plan.mjs");
const REFUSED_EXIT = 2;
const WORK_BRANCH = "bootstrap/guardrails";
const ALL_GROUPS = ["--group", "config", "--group", "guards", "--group", "ci"];
const FAKE_ZANITY = `#!/bin/sh
echo "$@" >> "$FAKE_ZANITY_LOG"
case "$1" in
  --version) echo "zanity 0.0.0-fake" ;;
  init) echo 'select = ["all"]' > zanity.toml ;;
  check)
    case "$*" in
      *--capture-baseline*) echo '{"findings":[]}' > zanity-baseline.json; exit 0 ;;
    esac
    exit "$FAKE_ZANITY_STATUS" ;;
esac
`;

const EXECUTABLE_MODE = 0o755;
const EXECUTE_BITS = 0o111;
const GIT_DIR = ".git";

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "gd-bootstrap-test-"));
  assert(existsSync(dir), `${dir} must exist after mkdtemp`);
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  return dir;
};

const write = (dir, file, body) => {
  const full = join(dir, file);
  assert(full.startsWith(dir), `${file} must stay inside ${dir}, got ${full}`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  assert(readFileSync(full, "utf8") === body, `${file} must read back what was written, got ${readFileSync(full, "utf8").length} bytes for ${body.length}`);
};

const stubGuards = () => {
  const dir = scratch();
  write(dir, "ratchet.mjs", "process.exit(0);\n");
  write(dir, "rules-about-rules.mjs", "process.exit(0);\n");
  assert(readdirSync(dir).length === 2, `stub dir must hold exactly the 2 guards, got ${readdirSync(dir)}`);
  assert(existsSync(join(dir, "ratchet.mjs")), `ratchet stub must exist in ${dir}`);
  return dir;
};

const fakeZanity = () => {
  const dir = scratch();
  write(dir, "zanity", FAKE_ZANITY);
  chmodSync(join(dir, "zanity"), EXECUTABLE_MODE);
  assert((statSync(join(dir, "zanity")).mode & EXECUTE_BITS) !== 0, `fake zanity must be executable, got mode ${statSync(join(dir, "zanity")).mode.toString(8)}`);
  assert(FAKE_ZANITY.includes("--capture-baseline"), "fake zanity must model baseline capture");
  return { bin: join(dir, "zanity"), log: join(dir, "calls.log") };
};

const gitRepo = (files, branch = WORK_BRANCH) => {
  const dir = scratch();
  for (const [file, body] of Object.entries(files)) write(dir, file, body);
  const init = spawnSync("git", ["init", "-q", "-b", branch], { cwd: dir });
  assert(init.status === 0, `git init must succeed in ${dir}, got status ${init.status}`);
  assert(existsSync(join(dir, GIT_DIR)), `${dir} must hold a ${GIT_DIR} directory after init`);
  return dir;
};

const run = (repo, extraArgs = [], env = {}) => {
  const zanity = fakeZanity();
  writeFileSync(zanity.log, "");
  const result = spawnSync("node", [PLAN, "--repo", repo, "--guards-dir", stubGuards(), ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, ZANITY_BIN: zanity.bin, FAKE_ZANITY_LOG: zanity.log, FAKE_ZANITY_STATUS: "1", ...env },
  });
  assert(result.error === undefined, `node must start, got ${result.error}`);
  assert(result.status !== null, `plan.mjs must exit on its own, got signal ${result.signal}`);
  return { code: result.status, diff: result.stdout, notes: result.stderr, calls: readFileSync(zanity.log, "utf8") };
};

const tree = (dir) => {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && !join(entry.parentPath, entry.name).includes(`/${GIT_DIR}/`))
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length))
    .sort();
  assert(files.every((file) => file.startsWith("/")), `tree paths must be repo-relative with a leading slash, got ${files.find((file) => !file.startsWith("/"))}`);
  assert(!files.some((file) => file.includes(`/${GIT_DIR}/`)), `tree must skip ${GIT_DIR}, got ${files.find((file) => file.includes(GIT_DIR))}`);
  return files;
};

test("python-only repo is detected and gets the workflow and both guards in the diff", () => {
  const repo = gitRepo({ "pyproject.toml": "[tool.ruff]\n[tool.pytest.ini_options]\n", "uv.lock": "", "app/main.py": "x = 1\n" });
  const facts = detect(repo);
  assert(JSON.stringify(facts.languages) === '["python"]', `languages should be exactly python, got ${JSON.stringify(facts.languages)}`);
  assert(facts.packageManagers.includes("uv") && facts.linters.includes("ruff"), `uv and ruff should be detected, got ${JSON.stringify([facts.packageManagers, facts.linters])}`);
  const plan = run(repo);
  assert(plan.code === 0, `plan should exit 0, got ${plan.code}: ${plan.notes}`);
  for (const path of ["guards/ratchet.mjs", "guards/rules-about-rules.mjs", ".github/workflows/guardrails.yml"]) {
    assert(plan.diff.includes(`+++ b/${path}`), `diff should add ${path}, got headers ${plan.diff.match(/^\+\+\+ .*$/gm)}`);
  }
  assert(plan.notes.includes("/plugin install overwatch --marketplace benomahony/overwatch"), `plan should print the overwatch install line, got ${plan.notes}`);
});

test("ts-only repo is detected as typescript and javascript, not python", () => {
  const repo = gitRepo({ "package.json": '{"scripts":{"test":"vitest"}}', "tsconfig.json": "{}", "pnpm-lock.yaml": "", "src/a.ts": "export const a = 1;\n" });
  const facts = detect(repo);
  assert(facts.languages.includes("typescript") && facts.languages.includes("javascript"), `typescript and javascript expected, got ${JSON.stringify(facts.languages)}`);
  assert(!facts.languages.includes("python") && facts.packageManagers[0] === "pnpm", `no python and pnpm expected, got ${JSON.stringify([facts.languages, facts.packageManagers])}`);
});

test("test runners come from the overwatch marker table", () => {
  const repo = gitRepo({ "package.json": "{}", "node_modules/.bin/vitest": "" });
  const names = detect(repo).testRunners.map((runner) => runner.name);
  assert(JSON.stringify(names) === '["vitest"]', `vitest marker should yield exactly vitest, got ${JSON.stringify(names)}`);
  const bare = detect(gitRepo({ "package.json": "{}" })).testRunners;
  assert(bare.length === 0, `no runner marker should yield no runner, got ${JSON.stringify(bare)}`);
});

test("bare repo still plans the guardrails and reports no language", () => {
  const repo = gitRepo({ "README.md": "hello\n" });
  const facts = detect(repo);
  assert(facts.languages.length === 0, `a bare repo has no languages, got ${JSON.stringify(facts.languages)}`);
  const plan = run(repo);
  assert(plan.diff.includes("+++ b/.github/workflows/guardrails.yml"), `bare repo should still get the workflow, got ${plan.diff.slice(0, 120)}`);
  assert(plan.notes.includes("would run: zanity init"), `bare repo should plan zanity init, got ${plan.notes}`);
});

test("existing CI is never overwritten, even with apply", () => {
  const existing = "name: ci\non: push\njobs: {}\n";
  const differing = "name: mine\n";
  const repo = gitRepo({ ".github/workflows/ci.yml": existing, ".github/workflows/guardrails.yml": differing, "a.py": "x = 1\n" });
  const result = run(repo, ["--apply", ...ALL_GROUPS]);
  assert(result.code === 0, `apply should exit 0, got ${result.code}: ${result.notes}`);
  assert(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8") === existing, "ci.yml must be byte-identical after apply");
  assert(readFileSync(join(repo, ".github/workflows/guardrails.yml"), "utf8") === differing, "a differing guardrails.yml must survive apply untouched");
  assert(result.notes.includes("CONFLICT .github/workflows/guardrails.yml"), `conflict should be reported, got ${result.notes}`);
  assert(!result.diff.includes("guardrails.yml"), `a conflict must not appear as a diff to apply, got ${result.diff.slice(0, 200)}`);
});

test("non-GitHub CI alone stops the plan", () => {
  const result = run(gitRepo({ ".gitlab-ci.yml": "stages: []\n" }));
  assert(result.code === REFUSED_EXIT, `gitlab-only repo should be refused with ${REFUSED_EXIT}, got ${result.code}`);
  assert(result.diff === "", `a refused plan must print no diff, got ${result.diff.slice(0, 80)}`);
});

test("a second run after apply gives an empty diff", () => {
  const repo = gitRepo({ "pyproject.toml": "[project]\nname='x'\n", "app.py": "x = 1\n" });
  const first = run(repo, ["--apply", ...ALL_GROUPS]);
  assert(first.code === 0 && first.diff.length > 0, `first run should apply a non-empty diff, got code ${first.code}, diff length ${first.diff.length}: ${first.notes}`);
  for (const path of ["zanity.toml", "zanity-baseline.json", "guards/ratchet.mjs", ".github/workflows/guardrails.yml"]) {
    assert(existsSync(join(repo, path)), `${path} should exist after apply, got tree ${tree(repo)}`);
  }
  const second = run(repo, ["--apply", ...ALL_GROUPS]);
  assert(second.diff === "", `second run diff should be empty, got ${second.diff.slice(0, 200)}`);
  assert(second.code === 0 && !second.notes.includes("CONFLICT"), `second run should be clean, got ${second.code}: ${second.notes}`);
});

test("the clean-repo variant skips the baseline and drops --new-only", () => {
  const repo = gitRepo({ "zanity.toml": 'select = ["all"]\n', "a.py": "x = 1\n" });
  const clean = run(repo, [], { FAKE_ZANITY_STATUS: "0" });
  assert(clean.diff.includes("args: check . --fail-on warning --strict"), `a clean repo should get plain args, got ${clean.diff.match(/args: .*/)}`);
  assert(!clean.diff.includes("--new-only"), "a clean repo must not use --new-only");
  const dirty = run(repo, [], { FAKE_ZANITY_STATUS: "1" });
  assert(dirty.diff.includes("--baseline zanity-baseline.json --new-only"), `a dirty repo should use the baseline, got ${dirty.diff.match(/args: .*/)}`);
});

test("a path escape is refused and nothing is written", () => {
  const outer = scratch();
  const repo = gitRepo({ "a.py": "x = 1\n" });
  const before = tree(repo);
  const escape = run(repo, ["--apply", ...ALL_GROUPS, "--workflow-name", "../../../escaped.yml"]);
  assert(escape.code === REFUSED_EXIT, `escape should be refused with ${REFUSED_EXIT}, got ${escape.code}: ${escape.notes}`);
  assert(escape.notes.includes("outside the repo"), `refusal should say why, got ${escape.notes}`);
  assert(JSON.stringify(tree(repo)) === JSON.stringify(before), `refusal must leave the repo untouched, got ${tree(repo)}`);
  symlinkSync(outer, join(repo, ".github"));
  const viaLink = run(repo, ["--apply", ...ALL_GROUPS]);
  assert(viaLink.code === REFUSED_EXIT, `a symlink out of the repo should be refused with ${REFUSED_EXIT}, got ${viaLink.code}: ${viaLink.notes}`);
  assert(readdirSync(outer).length === 0, `nothing may land in the symlink target, got ${readdirSync(outer)}`);
});

test("plan-only writes nothing and never runs zanity init", () => {
  const repo = gitRepo({ "pyproject.toml": "[project]\n", "a.py": "x = 1\n" });
  const before = tree(repo);
  const plan = run(repo);
  assert(plan.code === 0 && plan.diff.length > 0, `plan should succeed with a diff, got ${plan.code} and ${plan.diff.length} bytes`);
  assert(JSON.stringify(tree(repo)) === JSON.stringify(before), `plan-only must not change the tree, got ${tree(repo)} vs ${before}`);
  assert(!plan.calls.includes("init") && !plan.calls.includes("capture-baseline"), `plan-only must not run init or capture, got calls ${plan.calls}`);
});

test("apply refuses without a confirmed group and on the default branch", () => {
  const onBranch = gitRepo({ "a.py": "x = 1\n" });
  const noGroup = run(onBranch, ["--apply"]);
  assert(noGroup.code === REFUSED_EXIT && noGroup.notes.includes("--group"), `no group should be refused naming --group, got ${noGroup.code}: ${noGroup.notes}`);
  const onMain = gitRepo({ "a.py": "x = 1\n" }, "main");
  const refused = run(onMain, ["--apply", ...ALL_GROUPS]);
  assert(refused.code === REFUSED_EXIT && refused.notes.includes("git switch -c"), `main should be refused with the fix, got ${refused.code}: ${refused.notes}`);
  assert(!existsSync(join(onMain, ".github")), `nothing may be written on main, got ${tree(onMain)}`);
});

test("only confirmed groups are written", () => {
  const repo = gitRepo({ "a.py": "x = 1\n" });
  const result = run(repo, ["--apply", "--group", "guards"]);
  assert(result.code === 0, `apply of one group should exit 0, got ${result.code}: ${result.notes}`);
  assert(existsSync(join(repo, "guards/ratchet.mjs")), `confirmed guards group should be written, got ${tree(repo)}`);
  assert(!existsSync(join(repo, ".github/workflows/guardrails.yml")) && !existsSync(join(repo, "zanity.toml")), `unconfirmed groups must not be written, got ${tree(repo)}`);
});

test("the template pins every action to a SHA that this repo already uses", () => {
  const template = readFileSync(join(HERE, "templates", "guardrails.yml"), "utf8");
  const known = ["audit.yml", "static.yml"].map((file) => readFileSync(join(REPO_ROOT, ".github", "workflows", file), "utf8")).join("\n");
  const shas = [...template.matchAll(/uses:\s*\S+@([0-9a-f]{40})/g)].map((match) => match[1]);
  assert(shas.length === 6, `template should pin 6 action uses, got ${shas.length}`);
  assert(shas.every((sha) => known.includes(sha)), `every SHA must come from audit.yml or static.yml, got unknown ${shas.filter((sha) => !known.includes(sha))}`);
  assert(unpinnedActions(template).length === 0, `template must have no unpinned actions, got ${unpinnedActions(template)}`);
  const floating = template.replace(/@[0-9a-f]{40}/, "@v4");
  assert(unpinnedActions(floating).length === 1, `a floating tag must be reported, got ${JSON.stringify(unpinnedActions(floating))}`);
  assert(template.includes("node guards/ratchet.mjs --baseline zanity-baseline.json --base-ref origin/main") && template.includes("node guards/rules-about-rules.mjs --repo ."), "template must run both guards with their documented CLI");
});

test("zanity installs from the pinned release tag and fails closed on an unverified download", () => {
  const plan = installPlan();
  assert(/\/v\d+\.\d+\.\d+\/install\.sh$/.test(plan.scriptUrl) && !plan.scriptUrl.includes("/main/"), `install script must come from a tag, not main, got ${plan.scriptUrl}`);
  assert(plan.env.ZANITY_VERSION === plan.version, `ZANITY_VERSION must equal the pin, got ${plan.env.ZANITY_VERSION} vs ${plan.version}`);
  assert(isVerifiedInstall("Installed zanity 0.1.39 to /x") === true, "a clean installer run must count as verified");
  assert(isVerifiedInstall("this download is unverified\nInstalled zanity") === false, "an unverified warning must count as not verified");
  assert.throws(() => installPlan("latest"), /pinned x\.y\.z/, "an unpinned version must be refused");
});

test("the plan adds a manifest whose hashes match the guards it copies", () => {
  const stubSource = "process.exit(0);\n";
  const stubHash = createHash("sha256").update(stubSource).digest("hex");
  const plan = run(gitRepo({ "pyproject.toml": '[project]\nname = "x"\n' }));
  assert(plan.code === 0, `plan should exit 0, got ${plan.code}: ${plan.notes}`);
  assert(plan.diff.includes("+++ b/.guardrails/guards.sha256"), `diff should add the manifest, got headers ${plan.diff.match(/^\+\+\+ .*$/gm)}`);
  for (const guard of ["ratchet.mjs", "rules-about-rules.mjs"]) {
    const line = `+${stubHash}  guards/${guard}`;
    assert(plan.diff.includes(line), `manifest should list ${guard} with the hash of what is copied, expected ${line} in ${plan.diff.match(/^\+[0-9a-f]{64}.*$/gm)}`);
  }
});
