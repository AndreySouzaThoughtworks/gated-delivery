import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "ratchet.mjs");
const BASELINE = "zanity-baseline.json";
const BASE_REF = "base";
const RATCHET_ARGS = ["--baseline", BASELINE, "--base-ref", BASE_REF];
const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;
const ID_WIDTH = 64;
const PROCESS_IO = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };

const findingId = (seed) => {
  assert(Number.isInteger(seed) && seed >= 0, `seed must be a non-negative integer, got ${seed}; pass 0, 1, 2...`);
  const id = String(seed).padStart(ID_WIDTH, "0");
  assert(id.length === ID_WIDTH, `id for seed ${seed} must be ${ID_WIDTH} characters, got ${id.length}`);
  return id;
};

const baselineText = (seeds) => {
  assert(new Set(seeds).size === seeds.length, `seeds must be unique, got ${JSON.stringify(seeds)}; a baseline cannot hold one id twice`);
  const text = JSON.stringify({ schema_version: 1, identity_version: 1, findings: seeds.map((seed) => ({ id: findingId(seed), rule: "dead-symbol" })) });
  assert(JSON.parse(text).findings.length === seeds.length, `baseline from seeds ${JSON.stringify(seeds)} must hold ${seeds.length} findings, got ${text}`);
  return text;
};

const vcs = (dir, args) => {
  assert(isAbsolute(dir), `the repository directory must be absolute, got ${dir}`);
  assert(args.length > 0, `a subcommand is required, got ${JSON.stringify(args)}`);
  return execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], PROCESS_IO);
};

const repoWithBaseRef = (seedsAtBase) => {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
  vcs(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "README"), "x");
  if (seedsAtBase !== undefined) writeFileSync(join(dir, BASELINE), baselineText(seedsAtBase));
  vcs(dir, ["add", "-A"]);
  vcs(dir, ["commit", "-q", "-m", "base"]);
  vcs(dir, ["tag", BASE_REF]);
  assert(vcs(dir, ["rev-parse", BASE_REF]).trim().length > 0, `tag ${BASE_REF} must resolve in ${dir}`);
  assert(vcs(dir, ["ls-tree", "--name-only", BASE_REF]).includes(BASELINE) === (seedsAtBase !== undefined), `${BASELINE} at ${BASE_REF} must exist exactly when seeds ${JSON.stringify(seedsAtBase)} were given`);
  return dir;
};

const runGuard = (dir, args) => {
  assert(isAbsolute(dir), `the guard must run in an absolute directory, got ${dir}`);
  const result = spawnSync("node", [GUARD, ...args], { cwd: dir, encoding: "utf8" });
  assert(result.status !== null, `the guard must exit rather than die on a signal, got ${result.signal}: ${result.stderr}`);
  return result;
};

test("rejects a baseline that grew, and tells the author not to run --update-baseline", () => {
  const dir = repoWithBaseRef([1]);
  writeFileSync(join(dir, BASELINE), baselineText([1, 2]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_VIOLATION, `grown baseline must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes("grew from 1 to 2"), `message must say what grew, got ${result.stderr}`);
  assert(result.stderr.includes("do not run --update-baseline"), `message must say how to fix, got ${result.stderr}`);
});

test("rejects a baseline of the same size whose ids differ from the base", () => {
  const dir = repoWithBaseRef([1, 2]);
  writeFileSync(join(dir, BASELINE), baselineText([1, 3]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_VIOLATION, `swapped ids must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes(findingId(3)) && !result.stderr.includes("grew"), `message must list the new id ${findingId(3)} and not claim growth, got ${result.stderr}`);
});

test("accepts an unchanged baseline", () => {
  const dir = repoWithBaseRef([1, 2]);
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `unchanged baseline must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("2 findings"), `output must report the count 2, got ${result.stdout}`);
});

test("accepts a baseline that shrank", () => {
  const dir = repoWithBaseRef([1, 2, 3]);
  writeFileSync(join(dir, BASELINE), baselineText([2]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `shrunk baseline must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("1 findings"), `output must report the new count 1, got ${result.stdout}`);
});

test("accepts a baseline absent at the base ref and prints its count", () => {
  const dir = repoWithBaseRef(undefined);
  writeFileSync(join(dir, BASELINE), baselineText([1, 2, 3]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `first introduction must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("accepted with 3 findings"), `output must report the count 3, got ${result.stdout}`);
});

test("rejects an unreadable or malformed baseline with a usage exit", () => {
  const dir = repoWithBaseRef([1]);
  const control = runGuard(dir, RATCHET_ARGS);
  assert(control.status === EXIT_OK, `control: the committed baseline is readable, so exit ${EXIT_OK}, got ${control.status}`);
  writeFileSync(join(dir, BASELINE), "{not json");
  const malformed = runGuard(dir, RATCHET_ARGS);
  assert(malformed.status === EXIT_USAGE && malformed.stderr.includes("not valid JSON"), `malformed baseline must exit ${EXIT_USAGE} naming JSON, got ${malformed.status}: ${malformed.stderr}`);
  mkdirSync(join(dir, "gone"));
  const absent = runGuard(dir, ["--baseline", "gone/none.json", "--base-ref", BASE_REF]);
  assert(absent.status === EXIT_USAGE && absent.stderr.includes("cannot read"), `missing file must exit ${EXIT_USAGE} saying it cannot read, got ${absent.status}: ${absent.stderr}`);
});

test("rejects a baseline without finding ids and an unknown base ref", () => {
  const dir = repoWithBaseRef([1]);
  writeFileSync(join(dir, BASELINE), JSON.stringify({ findings: [{ rule: "x" }] }));
  const noIds = runGuard(dir, RATCHET_ARGS);
  assert(noIds.status === EXIT_USAGE && noIds.stderr.includes("not a zanity baseline"), `entries without ids must exit ${EXIT_USAGE}, got ${noIds.status}: ${noIds.stderr}`);
  writeFileSync(join(dir, BASELINE), baselineText([1]));
  const unknownRef = runGuard(dir, ["--baseline", BASELINE, "--base-ref", "nowhere"]);
  assert(unknownRef.status === EXIT_USAGE && unknownRef.stderr.includes("nowhere"), `unknown ref must exit ${EXIT_USAGE} naming it, got ${unknownRef.status}: ${unknownRef.stderr}`);
});

test("rejects a baseline path that leaves the repository", () => {
  const dir = repoWithBaseRef([1]);
  const result = runGuard(dir, ["--baseline", "../outside.json", "--base-ref", BASE_REF]);
  assert(result.status === EXIT_USAGE && result.stderr.includes("outside"), `escaping path must exit ${EXIT_USAGE} saying outside, got ${result.status}: ${result.stderr}`);
});

test("rejects missing or unknown arguments with the usage line", () => {
  const dir = repoWithBaseRef([1]);
  const noArgs = runGuard(dir, []);
  assert(noArgs.status === EXIT_USAGE && noArgs.stderr.includes("usage:"), `no arguments must exit ${EXIT_USAGE} with usage, got ${noArgs.status}: ${noArgs.stderr}`);
  const unknown = runGuard(dir, [...RATCHET_ARGS, "--force", "1"]);
  assert(unknown.status === EXIT_USAGE && unknown.stderr.includes("usage:"), `unknown option must exit ${EXIT_USAGE} with usage, got ${unknown.status}: ${unknown.stderr}`);
});
