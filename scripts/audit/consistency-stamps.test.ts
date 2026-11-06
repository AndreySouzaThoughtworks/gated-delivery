import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { STATIC_CHECKS, skillHash } from "../eval/changed-skills.ts";
import { write, validRepo, runGuard, ONE_SCENARIO } from "../test-support/consistency-fixtures.test.support.ts";

const BASE_REF = "main";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir: string, args: string[]) => {
  assert(existsSync(dir), `git must run in a folder that exists, got ${dir}; build the fixture first`);
  assert(args.length > 0, `git needs a subcommand, got ${JSON.stringify(args)}; name one`);
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...GIT_IDENTITY } });
};

const FEATURE_BRANCH = "feature";

const featureBranchEditing = (file: string, body: string) => {
  assert(!file.startsWith("/"), `the edited file must be relative to the repo, got ${file}; drop the leading slash`);
  const dir = validRepo();
  git(dir, ["init", "-b", BASE_REF]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  git(dir, ["checkout", "-b", FEATURE_BRANCH]);
  write(dir, file, body);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "change"]);
  const checkedOut = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  assert(checkedOut === FEATURE_BRANCH, `the edit must be committed on ${FEATURE_BRANCH}, got ${checkedOut}`);
  return dir;
};

const SKILL_EDIT: [string, string] = ["plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\nEdited.\n"];
const stateStamps = (dir: string, live: number, staticCount: number, waived: number) => {
  const total = live + staticCount + waived;
  assert(total >= 1, `a stamp statement needs at least one stamp, got ${live} live, ${staticCount} static, ${waived} waived`);
  assert([live, staticCount, waived].every((count) => Number.isInteger(count) && count >= 0), `stamp counts must be whole numbers, got ${live}, ${staticCount}, ${waived}`);
  write(dir, "README.md", `The plugin — 1 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n\n**${live} live, ${staticCount} static, ${waived} waived** of ${total} skill stamps\n`);
};
const stamp = (dir: string, hash: string) => {
  assert(hash.length > 0, `a stamp hash must not be blank, got ${JSON.stringify(hash)}; a blank one reads as a missing stamp`);
  write(dir, "evals/results/alpha.json", JSON.stringify({ hash }));
  stateStamps(dir, 1, 0, 0);
  assert(existsSync(join(dir, "evals/results/alpha.json")), `the stamp must exist after it is written, got none in ${dir}`);
};

test("a skill changed against the base ref needs an eval stamp with a matching hash", () => {
  const dir = featureBranchEditing(...SKILL_EDIT);
  const missing = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(missing.code, 1);
  assert.match(missing.out, /skill alpha changed since its evals last passed; run node scripts\/eval\/changed-skills\.ts --static alpha \(no model run\) or the live run, and commit evals\/results\/alpha\.json/);
  stamp(dir, "not-the-hash");
  const stale = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(stale.code, 1);
  assert.match(stale.out, /skill alpha/);
  stamp(dir, skillHash(dir, "alpha"));
  const matching = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(matching.code, 0, matching.out);
});

test("the stamp check is skipped when GATED_DELIVERY_BASE_REF is unset", () => {
  const dir = featureBranchEditing(...SKILL_EDIT);
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, out);
});

test("a skill nobody changed, or whose only change is evals.md, needs no stamp", () => {
  const evalsOnly = featureBranchEditing("plugin/skills/alpha/evals.md", ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | `grep -c foo out` |\n\n## Deterministic Checks\n\n```bash\n# expect: manual\ngrep -c bar output.md\n```\n");
  const edited = runGuard(evalsOnly, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(edited.code, 0, edited.out);
  const untouched = featureBranchEditing("docs/note.md", "note\n");
  const unchanged = runGuard(untouched, { GATED_DELIVERY_BASE_REF: BASE_REF });
  assert.equal(unchanged.code, 0, unchanged.out);
});

test("a changed skill on a waiver for its current hash passes with a warning; a blank or stale waiver fails", () => {
  const dir = featureBranchEditing(...SKILL_EDIT);
  const env = { GATED_DELIVERY_BASE_REF: BASE_REF };
  stateStamps(dir, 0, 0, 1);
  write(dir, "evals/results/alpha.json", JSON.stringify({ hash: skillHash(dir, "alpha"), waived: "no credentials" }));
  const waived = runGuard(dir, env);
  assert.equal(waived.code, 0, waived.out);
  assert.match(waived.out, /WARN\s+skill alpha ships on a waiver: no credentials/);
  write(dir, "evals/results/alpha.json", JSON.stringify({ hash: skillHash(dir, "alpha"), waived: " " }));
  const blank = runGuard(dir, env);
  assert.equal(blank.code, 1);
  assert.match(blank.out, /skill alpha has a waiver with no reason/);
  write(dir, "evals/results/alpha.json", JSON.stringify({ hash: "old", waived: "no credentials" }));
  const stale = runGuard(dir, env);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /skill alpha has a stamp for different content/);
});

const staticStamp = (hash: string, checks: { name: string; result: string }[], extra: Record<string, unknown> = {}) => {
  assert(hash.length > 0, `a static stamp hash must not be blank, got ${JSON.stringify(hash)}`);
  assert(Array.isArray(checks), `static checks must be a list, got ${JSON.stringify(checks)}`);
  return JSON.stringify({ hash, static: { checks, ranAt: "2026-01-01T00:00:00.000Z" }, ...extra });
};

test("a static stamp passes only for the current hash with every registered check passing", () => {
  const dir = featureBranchEditing(...SKILL_EDIT);
  const env = { GATED_DELIVERY_BASE_REF: BASE_REF };
  const hash = skillHash(dir, "alpha");
  const registered = STATIC_CHECKS.map(({ name }) => ({ name, result: "pass" }));
  stateStamps(dir, 0, 1, 0);
  write(dir, "evals/results/alpha.json", staticStamp(hash, registered));
  const valid = runGuard(dir, env);
  assert.equal(valid.code, 0, valid.out);
  assert.doesNotMatch(valid.out, /WARN|waiver/);
  write(dir, "evals/results/alpha.json", staticStamp(hash, registered.map(({ name }) => ({ name, result: "none" }))));
  assert.equal(runGuard(dir, env).code, 0);
  const rejected: [string, RegExp][] = [
    [staticStamp("old", registered), /skill alpha has a stamp for different content/],
    [staticStamp(hash, registered.map((check, index) => (index === 0 ? { ...check, result: "fail" } : check))), /skill alpha has a static stamp that is empty, holds a check that did not pass/],
    [staticStamp(hash, registered.slice(1)), /skill alpha has a static stamp that is empty, holds a check that did not pass, or lacks a registered check/],
    [staticStamp(hash, []), /skill alpha has a static stamp that is empty/],
    [staticStamp(hash, registered, { waived: "no credentials" }), /skill alpha has a stamp that is both a waiver and a static stamp/],
  ];
  for (const [stampText, expected] of rejected) {
    write(dir, "evals/results/alpha.json", stampText);
    const result = runGuard(dir, env);
    assert.equal(result.code, 1, stampText);
    assert.match(result.out, expected);
  }
});
test("the README must state the true number of live, static and waived skill stamps", () => {
  const cases: [string | null, RegExp | null][] = [
    ["**1 live, 1 static, 1 waived** of 3 skill stamps", null],
    ["**2 live, 1 static, 1 waived** of 3 skill stamps", /says 2 live, 1 static, 1 waived of 3 skill stamps, but evals\/results holds 1 live, 1 static, 1 waived of 3/],
    ["**1 live, 2 static, 1 waived** of 3 skill stamps", /says 1 live, 2 static, 1 waived of 3 skill stamps, but evals\/results holds 1 live, 1 static, 1 waived of 3/],
    ["**1 live, 1 static, 2 waived** of 3 skill stamps", /says 1 live, 1 static, 2 waived of 3 skill stamps, but evals\/results holds 1 live, 1 static, 1 waived of 3/],
    ["**1 live, 1 static, 1 waived** of 4 skill stamps", /says 1 live, 1 static, 1 waived of 4 skill stamps, but evals\/results holds 1 live, 1 static, 1 waived of 3/],
    [null, /has no "\*\*L live, S static, W waived\*\* of N skill stamps" line, and evals\/results holds 1 live, 1 static, 1 waived of 3/],
  ];
  for (const [readmeLine, expected] of cases) {
    const dir = validRepo();
    write(dir, "evals/results/alpha.json", JSON.stringify({ hash: "any" }));
    write(dir, "evals/results/beta.json", staticStamp("any", [{ name: "lint", result: "pass" }]));
    write(dir, "evals/results/gamma.json", JSON.stringify({ hash: "any", waived: "no credentials" }));
    write(dir, "README.md", `The plugin — 1 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n${readmeLine ?? ""}\n`);
    const { code, out } = runGuard(dir);
    if (expected === null) assert.equal(code, 0, out);
    else assert.match(out, expected);
  }
});
