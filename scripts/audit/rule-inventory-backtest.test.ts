import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "rule-inventory-backtest.ts");
const TRACKED = "SKILL.md";
const GIT_IDENTITY = ["-c", "user.name=test", "-c", "user.email=test@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];
const LIMITED_TEXT = "Never merge PRs.\n\n## What it does NOT do\n\n- Auto-merge PRs.\n\nSTOP on a dirty tree.\n";
const PROSE_ADDED_TEXT = `${LIMITED_TEXT}plain prose\n`;
const LIMITS_TRIMMED_TEXT = "Never merge PRs.\n\nSTOP on a dirty tree.\nplain prose\n";

const git = (dir: string, args: string[]) => {
  assert(args.length > 0, `git needs a subcommand, got ${args.length} arguments`);
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: dir, encoding: "utf8" }).trim();
};
const runTool = (dir: string, args: string[]) => {
  const result = spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, encoding: "utf8" });
  assert(result.error === undefined, `the tool must start in ${dir}, got ${result.error}`);
  assert(result.status !== null, `the tool must exit, got signal ${result.signal}`);
  assert(typeof result.stdout === "string", `the tool must print text, got ${typeof result.stdout}`);
  return { code: result.status, out: result.stdout + result.stderr };
};
const syntheticHistory = () => {
  const dir = mkdtempSync(join(tmpdir(), "rule-inventory-backtest-test-"));
  git(dir, ["init", "-q"]);
  const [, reworded, trimmed] = [LIMITED_TEXT, PROSE_ADDED_TEXT, LIMITS_TRIMMED_TEXT].map((text, index) => {
    writeFileSync(join(dir, TRACKED), text);
    git(dir, ["add", TRACKED]);
    git(dir, ["commit", "-m", `version ${index}`]);
    return git(dir, ["rev-parse", "HEAD"]);
  });
  assert(reworded !== trimmed, `each version must be its own commit, got ${reworded} twice`);
  assert(git(dir, ["rev-list", "--count", "HEAD"]) === "3", "the history must hold three commits");
  return { dir, reworded, trimmed };
};

test("a commit that deletes a limit bullet is flagged, naming the deleted line", () => {
  const { dir, trimmed } = syntheticHistory();
  const { code, out } = runTool(dir, ["--commit", trimmed, "--file", TRACKED]);
  assert.equal(code, 0, out);
  assert.match(out, /MISSING - Auto-merge PRs\./);
  assert.match(out, /1 of 4 marker lines missing/);
  assert.match(out, /interruption rate: 1 of 1 commits/);
});

test("a commit that only adds prose flags nothing", () => {
  const { dir, reworded } = syntheticHistory();
  const { out } = runTool(dir, ["--commit", reworded, "--file", TRACKED]);
  assert.match(out, /0 of 3 marker lines missing/);
  assert.match(out, /interruption rate: 0 of 1 commits/);
  assert.doesNotMatch(out, /MISSING/);
});

test("without --commit every commit that touched the file is compared, and the creating commit is skipped", () => {
  const { dir } = syntheticHistory();
  const { out } = runTool(dir, ["--file", TRACKED]);
  assert.match(out, /interruption rate: 1 of 2 commits flag at least one missing anchor \(50\.0%\)/);
});

test("a commit whose file is gone flags every marker line of its parent", () => {
  const { dir } = syntheticHistory();
  git(dir, ["rm", "-q", TRACKED]);
  git(dir, ["commit", "-q", "-m", "remove"]);
  const { out } = runTool(dir, ["--commit", "HEAD", "--file", TRACKED]);
  assert.match(out, /2 of 2 marker lines missing/);
});

test("running without --file prints usage and exits 2", () => {
  const { dir } = syntheticHistory();
  const { code, out } = runTool(dir, []);
  assert.equal(code, 2, out);
  assert.match(out, /usage: node scripts\/audit\/rule-inventory-backtest\.ts --file <path> \[--commit <sha>\]/);
});
