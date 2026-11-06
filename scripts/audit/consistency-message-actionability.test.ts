import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BASELINE_FILE, BASELINE_RULE, baselineText } from "./message-actionability/baseline.ts";
import { runGuard, validRepo, write } from "../test-support/consistency-fixtures.test.support.ts";

const ACTIONABILITY_SCRIPT = "scripts/audit/message-actionability.ts";
const BAD_SOURCE = 'assert(ok, "something went wrong here");\n';
const BASE_TAG = "base";

const git = (dir: string, args: string[]) => {
  assert(dir !== "", `git needs a working directory, got ${JSON.stringify(dir)}`);
  assert(args.length > 0, `git needs a subcommand, got ${args.length} arguments`);
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
};
const baselineOf = (paths: string[]) => {
  assert(Array.isArray(paths), `the baseline paths must be a list, got ${typeof paths}`);
  assert(paths.every((path) => path.endsWith(".mjs")), `the baseline paths must name .mjs files, got ${JSON.stringify(paths)}`);
  return baselineText(paths.map((path) => ({ path, rule: BASELINE_RULE, message: "something went wrong here" })));
};

const trackedRepo = (sources: string[], baselinePaths: string[]) => {
  const dir = validRepo();
  write(dir, ACTIONABILITY_SCRIPT, "");
  for (const source of sources) write(dir, source, BAD_SOURCE);
  write(dir, BASELINE_FILE, baselineOf(baselinePaths));
  git(dir, ["init", "-q"]);
  git(dir, ["add", "-A"]);
  assert(git(dir, ["ls-files"]).includes(BASELINE_FILE), `the fixture must track ${BASELINE_FILE}`);
  assert(sources.every((source) => git(dir, ["ls-files", source]).trim() === source), `the fixture must track ${JSON.stringify(sources)}`);
  return dir;
};

test("check 32 accepts a baseline that holds every non-actionable message", () => {
  const { code, out } = runGuard(trackedRepo(["plugin/scripts/a.mjs"], ["plugin/scripts/a.mjs"]));
  assert.equal(code, 0, out);
});

test("check 32 reports a non-actionable message the baseline does not hold", () => {
  const { code, out } = runGuard(trackedRepo(["plugin/scripts/a.mjs"], []));
  assert.equal(code, 1, out);
  assert.match(out, /plugin\/scripts\/a\.mjs must not hold the non-actionable message "something went wrong here"/);
});

test("check 32 reports a baseline entry whose message is gone", () => {
  const { code, out } = runGuard(trackedRepo([], ["plugin/scripts/a.mjs"]));
  assert.equal(code, 1, out);
  assert.match(out, /message-actionability-baseline\.json lists a stale message "something went wrong here" of plugin\/scripts\/a\.mjs/);
});

test("check 32 reports a baseline that grew against the base ref", () => {
  const dir = trackedRepo(["plugin/scripts/a.mjs"], ["plugin/scripts/a.mjs"]);
  git(dir, ["commit", "-q", "-m", BASE_TAG]);
  git(dir, ["tag", BASE_TAG]);
  write(dir, "plugin/scripts/b.mjs", BAD_SOURCE);
  write(dir, BASELINE_FILE, baselineOf(["plugin/scripts/a.mjs", "plugin/scripts/b.mjs"]));
  git(dir, ["add", "-A"]);
  const { code, out } = runGuard(dir, { GATED_DELIVERY_BASE_REF: BASE_TAG });
  assert.equal(code, 1, out);
  assert.match(out, /must not grow, but went from 1 to 2 entries against base/);
});

test("check 32 stays silent in a repo without the actionability tool", () => {
  const { code, out } = runGuard(validRepo());
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /non-actionable/);
});
