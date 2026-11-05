import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScript } from "./run-cli.test.support.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PLUGIN, "..");
const SPEC_LINT = join(PLUGIN, "skills", "spec", "scripts", "spec-lint.mjs");
const DESKCHECK_LINT = join(PLUGIN, "skills", "deskcheck", "scripts", "deskcheck-lint.mjs");
const GUARDRAIL_SCAN = join(PLUGIN, "skills", "issue-writing", "scripts", "guardrail-scan.mjs");
const RESOLVE_VERIFY_CMD = join(PLUGIN, "skills", "slice", "scripts", "resolve-verify-cmd.mjs");
const VALID_SPEC = join(REPO, "scripts", "audit", "fixtures", "valid-spec.md");
const SPEC_TEMPLATE = join(PLUGIN, "skills", "spec", "templates", "change.md");
const VALID_PAGE = join(REPO, "scripts", "audit", "fixtures", "deskcheck", "valid.html");
const VERIFY_ENV = "GATED_DELIVERY_VERIFY_CMD";
const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;

const scratch = (name, text) => {
  assert(/^[\w.-]+$/.test(name), `the file name must be a plain name without a path, got ${JSON.stringify(name)}`);
  assert(typeof text === "string", `the file content must be text, got ${typeof text}`);
  const file = join(mkdtempSync(join(tmpdir(), "skill-smoke-")), name);
  writeFileSync(file, text);
  return file;
};

test("spec-lint accepts the valid fixture and rejects the unfilled template on this Node", () => {
  assert.equal(runScript(SPEC_LINT, [VALID_SPEC]).status, EXIT_OK);
  const rejected = runScript(SPEC_LINT, [SPEC_TEMPLATE]);
  assert.equal(rejected.status, EXIT_PROBLEMS);
  assert.notEqual(rejected.stdout.trim(), "", "a rejection must say why");
});

test("deskcheck-lint accepts the valid page and rejects a page with a relative image on this Node", () => {
  assert.equal(runScript(DESKCHECK_LINT, [VALID_PAGE]).status, EXIT_OK);
  const rejected = runScript(DESKCHECK_LINT, [scratch("bad.html", '<h1>x</h1><img src="a.png">')]);
  assert.equal(rejected.status, EXIT_PROBLEMS);
  assert.notEqual(rejected.stdout.trim(), "", "a rejection must say why");
});

test("guardrail-scan passes clean text and flags a credential with file and line, never the value, on this Node", () => {
  assert.equal(runScript(GUARDRAIL_SCAN, [scratch("clean.md", "Add a retry to the export job.\n")]).status, EXIT_OK);
  const flagged = runScript(GUARDRAIL_SCAN, [scratch("dirty.md", "ok\npassword = hunter2value\n")]);
  assert.equal(flagged.status, EXIT_PROBLEMS);
  assert.match(flagged.stdout, /dirty\.md:2/);
  assert.doesNotMatch(flagged.stdout, /hunter2value/);
});

test("resolve-verify-cmd prints the command from the environment and fails when none is set on this Node", () => {
  const home = mkdtempSync(join(tmpdir(), "skill-smoke-home-"));
  const baseEnv = { PATH: process.env.PATH, HOME: home };
  const resolved = runScript(RESOLVE_VERIFY_CMD, [], { cwd: home, env: { ...baseEnv, [VERIFY_ENV]: "make verify" } });
  assert.equal(resolved.status, EXIT_OK);
  assert.equal(resolved.stdout.trim(), "make verify");
  assert.equal(runScript(RESOLVE_VERIFY_CMD, [], { cwd: home, env: baseEnv }).status, EXIT_PROBLEMS);
});
