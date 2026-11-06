import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_BUILD_COMMAND, SITE_BUILD_SCRIPT, SITE_SOURCES_DIRECTORY, SITE_WORKFLOW, siteWiringProblems } from "./site-wiring.ts";
import { validRepo, write } from "../test-support/consistency-fixtures.test.support.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "site-wiring.ts");
const WORKFLOW_WITHOUT_STEP = "jobs:\n  consistency:\n    steps:\n      - run: node scripts/audit/consistency.ts\n";
const WORKFLOW_WITH_STEP = `${WORKFLOW_WITHOUT_STEP}      - run: ${SITE_BUILD_COMMAND}\n`;
const STEP_IN_OTHER_JOB = `${WORKFLOW_WITHOUT_STEP}  other:\n    steps:\n      - run: ${SITE_BUILD_COMMAND}\n`;

const SITE_WORKFLOW_COMPLETE = "jobs:\n  build:\n    steps:\n      - run: node scripts/site/build.ts\n  deploy:\n    needs: build\n    steps:\n      - run: echo deploy\n";

const repoWithSources = () => {
  const dir = validRepo();
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  write(dir, `${SITE_SOURCES_DIRECTORY}/home.html`, "<h1>Home</h1>\n");
  assert(existsSync(join(dir, SITE_SOURCES_DIRECTORY)), `${dir} must hold the site sources folder`);
  return dir;
};

test("a repository with site sources but no build script is rejected with the file and the fix", () => {
  const dir = repoWithSources();
  write(dir, ".github/workflows/audit.yml", WORKFLOW_WITH_STEP);
  const [problem] = siteWiringProblems(dir);
  assert.match(problem, new RegExp(`^${SITE_BUILD_SCRIPT.replace(/\./g, "\\.")} is missing, but ${SITE_SOURCES_DIRECTORY}/ holds the site sources\\. Rule: .* Fix:`));
});

test("a build script with no CI step, a step in another job, or no workflow is rejected", () => {
  for (const [name, workflow, expected] of [
    ["no step", WORKFLOW_WITHOUT_STEP, /has no "node scripts\/site\/build\.ts --check" step in the consistency job\. Rule: .* Fix:/],
    ["a step in another job", STEP_IN_OTHER_JOB, /has no "node scripts\/site\/build\.ts --check" step in the consistency job/],
    ["no workflow", null, /is missing, so no CI step builds the site\. Rule: .* Fix:/],
  ] as const) {
    const dir = repoWithSources();
    write(dir, SITE_BUILD_SCRIPT, "export {};\n");
    if (workflow !== null) write(dir, ".github/workflows/audit.yml", workflow);
    const problems = siteWiringProblems(dir);
    assert(problems.some((problem) => expected.test(problem)), `${name} must be rejected, got ${JSON.stringify(problems)}`);
  }
});

test("a complete site wiring reports nothing", () => {
  const dir = repoWithSources();
  write(dir, SITE_BUILD_SCRIPT, "export {};\n");
  write(dir, ".github/workflows/audit.yml", WORKFLOW_WITH_STEP);
  write(dir, SITE_WORKFLOW, SITE_WORKFLOW_COMPLETE);
  assert.deepEqual(siteWiringProblems(dir), []);
});

test("a missing site workflow, or one without its build or deploy job, is rejected with the rule and the fix", () => {
  for (const [name, workflow, expected] of [
    ["no workflow", null, /^\.github\/workflows\/site\.yml is missing, so nothing deploys the site\. Rule: .* Fix: restore the workflow with the jobs build and deploy\./],
    ["no build job", "jobs:\n  rebuild:\n    steps: []\n  deploy:\n    steps: []\n", /^\.github\/workflows\/site\.yml has no "build" job\. Rule: .* Fix: restore the "build" job\./],
    ["no deploy job", "jobs:\n  build:\n    steps: []\n", /^\.github\/workflows\/site\.yml has no "deploy" job\. Rule: .* Fix: restore the "deploy" job\./],
  ] as const) {
    const dir = repoWithSources();
    write(dir, SITE_BUILD_SCRIPT, "export {};\n");
    write(dir, ".github/workflows/audit.yml", WORKFLOW_WITH_STEP);
    if (workflow !== null) write(dir, SITE_WORKFLOW, workflow);
    const problems = siteWiringProblems(dir);
    assert.equal(problems.length, 1, `${name} must give exactly one problem, got ${JSON.stringify(problems)}`);
    assert.match(problems[0], expected, `${name} must be rejected with its message`);
  }
});

test("the standalone check exits 1 with the problem on a bad repository and 0 on the full wiring", () => {
  const dir = repoWithSources();
  const bad = spawnSync("node", [SCRIPT, "--repo", dir], { encoding: "utf8" });
  assert.equal(bad.status, 1, `a repository with no build script must fail, got ${bad.status}: ${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /scripts\/site\/build\.ts is missing, but docs-site-src\/ holds the site sources/, `the check must name the missing script, got ${bad.stderr}`);
  write(dir, SITE_BUILD_SCRIPT, "export {};\n");
  write(dir, ".github/workflows/audit.yml", WORKFLOW_WITH_STEP);
  write(dir, SITE_WORKFLOW, SITE_WORKFLOW_COMPLETE);
  const good = spawnSync("node", [SCRIPT, "--repo", dir], { encoding: "utf8" });
  assert.equal(good.status, 0, `the full wiring must pass, got ${good.status}: ${good.stdout}${good.stderr}`);
  assert.match(good.stdout, /^OK: the site has its build script/, `the check must print OK, got ${good.stdout}`);
  const extra = spawnSync("node", [SCRIPT, "--repo", dir, "stray"], { encoding: "utf8" });
  assert.notEqual(extra.status, 0, `a positional argument must be refused, got ${extra.status}`);
  const blank = spawnSync("node", [SCRIPT, "--repo", ""], { encoding: "utf8" });
  assert.match(blank.stderr, /must name a folder, got ""/, `an empty --repo must be refused, got ${blank.stderr}`);
});

test("a repository with no site sources is skipped, and a missing root is refused", () => {
  assert.deepEqual(siteWiringProblems(validRepo()), [], "no sources means nothing to wire");
  assert.throws(() => siteWiringProblems(join(mkdtempSync(join(tmpdir(), "site-wiring-")), "absent")), /must exist to check the site wiring/);
});
