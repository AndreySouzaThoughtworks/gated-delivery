import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "rules-about-rules.mjs");
const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;
const PINNED_SHA = "11d5960a326750d5838078e36cf38b85af677262";
const TOP_LEVEL = "";
const REQUIRED_JOB = "zanity";
const TEST_TABLE = 'paths."**/*.test.mjs"';
const STRICT_CONFIG = `exclude = ["tests/fixtures/"]\n[rules]\nselect = ["all"]\n[${TEST_TABLE}]\ndisable = ["process-in-test"]\n`;
const ALLOWLIST = { zanityDisables: { [TEST_TABLE]: ["process-in-test"] }, zanityExcludes: ["tests/fixtures/"], requiredCiJobs: [REQUIRED_JOB] };

const workflow = (action) => {
  assert(!action.includes("\n"), `an action reference must be one line, got ${JSON.stringify(action)}`);
  const text = `name: ci\njobs:\n  ${REQUIRED_JOB}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${action}\n`;
  assert(text.includes(`uses: ${action}\n`), `the workflow must use ${action}, got ${JSON.stringify(text)}`);
  return text;
};

const guard = (dir) => {
  assert(isAbsolute(dir), `the repository directory must be absolute, got ${dir}`);
  const result = spawnSync("node", [GUARD, "--repo", dir], { encoding: "utf8" });
  assert(result.status !== null, `the guard must exit rather than die on a signal, got ${result.signal}: ${result.stderr}`);
  return result;
};

const PINNED_WORKFLOW = workflow(`actions/checkout@${PINNED_SHA} # v4`);

const write = (dir, relPath, body) => {
  assert(typeof body === "string", `${relPath} needs text content, got ${typeof body}`);
  const full = join(dir, relPath);
  assert(full.startsWith(dir), `${relPath} must stay inside ${dir}, resolved to ${full}`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};

const validRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-about-rules-test-"));
  write(dir, "zanity.toml", STRICT_CONFIG);
  write(dir, ".guardrails/allowed.json", JSON.stringify(ALLOWLIST));
  write(dir, ".github/workflows/ci.yml", PINNED_WORKFLOW);
  write(dir, ".overwatch.json", JSON.stringify({ enabled: true }));
  const baseline = guard(dir);
  assert(baseline.status === EXIT_OK, `the baseline fixture ${dir} must pass the guard it is used against, got ${baseline.status}: ${baseline.stderr}`);
  assert(STRICT_CONFIG.includes('select = ["all"]'), "the baseline fixture must select all rules, so a rejection can only come from the mutation");
  return dir;
};

const expectRejected = (dir, fragment) => {
  const result = guard(dir);
  assert(result.status === EXIT_VIOLATION, `must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes(fragment), `stderr must include "${fragment}", got ${result.stderr}`);
};

const expectAccepted = (dir) => {
  const result = guard(dir);
  assert(result.status === EXIT_OK, `must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr === "", `must print no problems, got ${result.stderr}`);
};

test("accepts the strict fixture", () => {
  expectAccepted(validRepo());
});

test("rejects a zanity.toml that drops select = [all], and accepts it restored", () => {
  const dir = validRepo();
  write(dir, "zanity.toml", STRICT_CONFIG.replace('select = ["all"]', 'select = ["correctness"]'));
  expectRejected(dir, 'must keep select = ["all"]');
  write(dir, "zanity.toml", STRICT_CONFIG);
  expectAccepted(dir);
});

test("rejects a top-level disable and a disable beyond the allowed list in a table", () => {
  const dir = validRepo();
  write(dir, "zanity.toml", `disable = ["long-function"]\n${STRICT_CONFIG}`);
  expectRejected(dir, "disables long-function under top level");
  write(dir, "zanity.toml", STRICT_CONFIG.replace('["process-in-test"]', '["process-in-test", "long-test"]'));
  expectRejected(dir, "disables long-test under [paths.");
});

test("accepts a disable that the allowlist names", () => {
  const dir = validRepo();
  write(dir, ".guardrails/allowed.json", JSON.stringify({ ...ALLOWLIST, zanityDisables: { ...ALLOWLIST.zanityDisables, [TOP_LEVEL]: ["long-function"] } }));
  write(dir, "zanity.toml", `disable = ["long-function"]\n${STRICT_CONFIG}`);
  expectAccepted(dir);
});

test("rejects an exclude outside the allowlist and accepts one the allowlist names", () => {
  const dir = validRepo();
  write(dir, "zanity.toml", STRICT_CONFIG.replace('["tests/fixtures/"]', '["tests/fixtures/", "src/legacy/"]'));
  expectRejected(dir, "excludes src/legacy/");
  write(dir, ".guardrails/allowed.json", JSON.stringify({ ...ALLOWLIST, zanityExcludes: ["tests/fixtures/", "src/legacy/"] }));
  expectAccepted(dir);
});

test("rejects a paths table the allowlist does not name", () => {
  const dir = validRepo();
  write(dir, "zanity.toml", `${STRICT_CONFIG}[paths."src/"]\ndisable = []\n`);
  expectRejected(dir, "scopes rules off in [paths.\"src/\"]");
});

test("rejects a repo with no zanity.toml", () => {
  const empty = mkdtempSync(join(tmpdir(), "rules-about-rules-empty-"));
  expectRejected(empty, "zanity.toml is missing");
  expectAccepted(validRepo());
});

test("rejects an action pinned to a tag or a short SHA, and accepts a local action", () => {
  const dir = validRepo();
  write(dir, ".github/workflows/ci.yml", workflow("actions/checkout@v4"));
  expectRejected(dir, "actions/checkout@v4");
  write(dir, ".github/workflows/ci.yml", workflow(`actions/checkout@${PINNED_SHA.slice(0, 7)}`));
  expectRejected(dir, "not pinned to a full 40-character commit SHA");
  write(dir, ".github/workflows/ci.yml", workflow("./.github/actions/local"));
  expectAccepted(dir);
});

test("rejects a workflow whose required job is gone, and accepts a job matched by its name", () => {
  const dir = validRepo();
  write(dir, ".github/workflows/ci.yml", PINNED_WORKFLOW.replace(`  ${REQUIRED_JOB}:`, "  other:"));
  expectRejected(dir, `required CI job "${REQUIRED_JOB}"`);
  write(dir, ".github/workflows/ci.yml", PINNED_WORKFLOW.replace(`  ${REQUIRED_JOB}:\n`, `  lint:\n    name: ${REQUIRED_JOB}\n`));
  expectAccepted(dir);
});

test("rejects .overwatch.json that disables overwatch, and accepts it enabled or absent", () => {
  const dir = validRepo();
  write(dir, ".overwatch.json", JSON.stringify({ enabled: false }));
  expectRejected(dir, '"enabled": false');
  write(dir, ".overwatch.json", JSON.stringify({}));
  expectAccepted(dir);
});

test("exits with the usage code for an unreadable allowlist, bad JSON, or missing --repo", () => {
  const dir = validRepo();
  write(dir, ".guardrails/allowed.json", "{nope");
  const badJson = guard(dir);
  assert(badJson.status === EXIT_USAGE && badJson.stderr.includes("not valid JSON"), `bad allowlist must exit ${EXIT_USAGE}, got ${badJson.status}: ${badJson.stderr}`);
  write(dir, ".guardrails/allowed.json", JSON.stringify({ requiredCiJobs: "zanity" }));
  const badShape = guard(dir);
  assert(badShape.status === EXIT_USAGE && badShape.stderr.includes("requiredCiJobs"), `bad schema must exit ${EXIT_USAGE} naming the key, got ${badShape.status}: ${badShape.stderr}`);
  const noArgs = spawnSync("node", [GUARD], { encoding: "utf8" });
  assert(noArgs.status === EXIT_USAGE && noArgs.stderr.includes("usage:"), `no --repo must exit ${EXIT_USAGE} with usage, got ${noArgs.status}: ${noArgs.stderr}`);
});

const MANIFEST = ".guardrails/guards.sha256";
const GUARD_FILES = { "ratchet.mjs": "process.exit(0);\n", "rules-about-rules.mjs": "process.exit(1);\n" };

const manifestOf = (files) => {
  const lines = Object.entries(files).map(([name, body]) => `${createHash("sha256").update(body).digest("hex")}  guards/${name}`);
  assert(lines.length === Object.keys(files).length, `one manifest line per guard expected, got ${lines.length} for ${Object.keys(files)}`);
  assert(lines.every((line) => /^[0-9a-f]{64} {2}guards\/\S+$/.test(line)), `each line must read "<sha256>  guards/<file>", got ${JSON.stringify(lines)}`);
  return `${lines.join("\n")}\n`;
};

const repoWithGuards = () => {
  const dir = validRepo();
  for (const [name, body] of Object.entries(GUARD_FILES)) write(dir, `guards/${name}`, body);
  write(dir, MANIFEST, manifestOf(GUARD_FILES));
  expectAccepted(dir);
  assert(existsSync(join(dir, MANIFEST)), `the fixture must hold the manifest at ${MANIFEST} in ${dir}`);
  assert(Object.keys(GUARD_FILES).every((name) => existsSync(join(dir, "guards", name))), `the fixture must hold every guard under guards/ in ${dir}, got ${Object.keys(GUARD_FILES)}`);
  return dir;
};

test("accepts guards that match their manifest", () => {
  repoWithGuards();
});

test("rejects a guard that changed after the manifest was written", () => {
  const dir = repoWithGuards();
  write(dir, "guards/ratchet.mjs", "process.exit(0);\n// edited\n");
  expectRejected(dir, `guards/ratchet.mjs differs from ${MANIFEST}`);
});

test("rejects a guards folder with no manifest", () => {
  const dir = repoWithGuards();
  rmSync(join(dir, MANIFEST));
  expectRejected(dir, `${MANIFEST} is missing`);
});

test("rejects a guard the manifest does not list", () => {
  const dir = repoWithGuards();
  write(dir, "guards/extra.mjs", "process.exit(0);\n");
  expectRejected(dir, `guards/extra.mjs is not listed in ${MANIFEST}`);
});

test("rejects a listed guard that is missing", () => {
  const dir = repoWithGuards();
  rmSync(join(dir, "guards/ratchet.mjs"));
  expectRejected(dir, `guards/ratchet.mjs is listed in ${MANIFEST} but missing`);
});

test("treats a malformed manifest line as unusable input", () => {
  const dir = repoWithGuards();
  write(dir, MANIFEST, "not a hash  guards/ratchet.mjs\n");
  const result = guard(dir);
  assert(result.status === EXIT_USAGE, `a malformed manifest must exit ${EXIT_USAGE}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes("must read"), `stderr must say what the line must read, got ${result.stderr}`);
});

const expectUnusable = (dir, fragment) => {
  const result = guard(dir);
  assert(result.status === EXIT_USAGE, `must exit ${EXIT_USAGE}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes(fragment), `stderr must include "${fragment}", got ${result.stderr}`);
};

test("rejects an empty --repo value", () => {
  const result = spawnSync("node", [GUARD, "--repo", ""], { encoding: "utf8" });
  assert(result.status === EXIT_USAGE && result.stderr.includes("must name a directory"), `an empty --repo must exit ${EXIT_USAGE} asking for a directory, got ${result.status}: ${result.stderr}`);
});

test("rejects an allowlist whose lists hold stray whitespace or repeats, or whose shape is wrong", () => {
  const dir = validRepo();
  write(dir, ".guardrails/allowed.json", JSON.stringify({ ...ALLOWLIST, zanityExcludes: [" tests/fixtures/ "] }));
  expectUnusable(dir, "stray whitespace");
  write(dir, ".guardrails/allowed.json", JSON.stringify({ ...ALLOWLIST, requiredCiJobs: [REQUIRED_JOB, REQUIRED_JOB] }));
  expectUnusable(dir, "must not repeat an item");
  write(dir, ".guardrails/allowed.json", "[]");
  expectUnusable(dir, "must hold a JSON object");
  write(dir, ".guardrails/allowed.json", JSON.stringify({ zanityDisables: [] }));
  expectUnusable(dir, "zanityDisables must map");
  write(dir, ".guardrails/allowed.json", JSON.stringify(ALLOWLIST));
  expectAccepted(dir);
});

test("rejects a zanity.toml with single-quoted items, blank items or a byte order mark", () => {
  const dir = validRepo();
  write(dir, "zanity.toml", STRICT_CONFIG.replace('disable = ["process-in-test"]', "disable = ['process-in-test']"));
  expectUnusable(dir, "only double-quoted strings");
  write(dir, "zanity.toml", STRICT_CONFIG.replace('disable = ["process-in-test"]', 'disable = [""]'));
  expectUnusable(dir, "must not hold blank items");
  write(dir, "zanity.toml", `﻿${STRICT_CONFIG}`);
  expectUnusable(dir, "byte order mark");
  write(dir, "zanity.toml", STRICT_CONFIG);
  expectAccepted(dir);
});

test("rejects a workflow job with two names or a name padded inside its quotes", () => {
  const dir = validRepo();
  write(dir, ".github/workflows/ci.yml", PINNED_WORKFLOW.replace(`  ${REQUIRED_JOB}:\n`, `  ${REQUIRED_JOB}:\n    name: one\n    name: two\n`));
  expectUnusable(dir, "a job has at most one name");
  write(dir, ".github/workflows/ci.yml", PINNED_WORKFLOW.replace(`  ${REQUIRED_JOB}:\n`, `  ${REQUIRED_JOB}:\n    name: " padded "\n`));
  expectUnusable(dir, "must be non-blank and trimmed");
  write(dir, ".github/workflows/ci.yml", PINNED_WORKFLOW);
  expectAccepted(dir);
});

test("rejects a manifest that lists a directory reference or the same guard twice", () => {
  const dir = repoWithGuards();
  const valid = manifestOf(GUARD_FILES);
  write(dir, MANIFEST, `${valid}${"0".repeat(64)}  guards/..\n`);
  expectUnusable(dir, "not directory references");
  write(dir, MANIFEST, `${valid}${valid.split("\n")[0]}\n`);
  expectUnusable(dir, "lists a file twice");
  write(dir, MANIFEST, valid);
  expectAccepted(dir);
});

test("refuses to print a problem that spans two lines", () => {
  const dir = repoWithGuards();
  write(dir, "guards/two\nlines.mjs", "process.exit(0);\n");
  expectUnusable(dir, "each problem must be one line");
});
