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
const PROCESS_IO = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };

const entry = ({ path = "scripts/a.mjs", rule = "dead-symbol", fn = "alpha" } = {}) => {
  assert(path.length > 0 && rule.length > 0, `path and rule must be non-empty, got ${JSON.stringify({ path, rule })}`);
  assert(/^\w+$/.test(fn), `fn must be a plain function name, got ${JSON.stringify(fn)}`);
  return { path, line: 1, rule, message: `'${fn}' is unused.`, fix: "remove it", id: `${path}:${rule}:${fn}` };
};

const baselineText = (entries) => {
  assert(Array.isArray(entries), `entries must be an array, got ${JSON.stringify(entries)}`);
  const text = JSON.stringify({ schema_version: 1, identity_version: 1, findings: entries });
  assert(JSON.parse(text).findings.length === entries.length, `baseline must hold ${entries.length} findings, got ${text}`);
  return text;
};

const alpha = entry();
const beta = entry({ fn: "beta" });
const gamma = entry({ fn: "gamma" });

const vcs = (dir, args) => {
  assert(isAbsolute(dir), `the repository directory must be absolute, got ${dir}`);
  assert(args.length > 0, `a subcommand is required, got ${JSON.stringify(args)}`);
  return execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], PROCESS_IO);
};

const repoWithBaseRef = (entriesAtBase) => {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
  vcs(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "README"), "x");
  if (entriesAtBase !== undefined) writeFileSync(join(dir, BASELINE), baselineText(entriesAtBase));
  vcs(dir, ["add", "-A"]);
  vcs(dir, ["commit", "-q", "-m", "base"]);
  vcs(dir, ["tag", BASE_REF]);
  assert(vcs(dir, ["rev-parse", BASE_REF]).trim().length > 0, `tag ${BASE_REF} must resolve in ${dir}`);
  assert(vcs(dir, ["ls-tree", "--name-only", BASE_REF]).includes(BASELINE) === (entriesAtBase !== undefined), `${BASELINE} at ${BASE_REF} must exist exactly when entries ${JSON.stringify(entriesAtBase)} were given`);
  return dir;
};

const runGuard = (dir, args) => {
  assert(isAbsolute(dir), `the guard must run in an absolute directory, got ${dir}`);
  const result = spawnSync("node", [GUARD, ...args], { cwd: dir, encoding: "utf8" });
  assert(result.status !== null, `the guard must exit rather than die on a signal, got ${result.signal}: ${result.stderr}`);
  return result;
};

test("rejects a baseline that grew, and tells the author not to run --update-baseline", () => {
  const dir = repoWithBaseRef([alpha]);
  writeFileSync(join(dir, BASELINE), baselineText([alpha, beta]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_VIOLATION, `grown baseline must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes("grew from 1 to 2"), `message must say what grew, got ${result.stderr}`);
  assert(result.stderr.includes("do not run --update-baseline"), `message must say how to fix, got ${result.stderr}`);
});

test("accepts a file moved, renamed or converted with identical findings", () => {
  const dir = repoWithBaseRef([alpha, beta]);
  const moved = [alpha, beta].map((finding) => ({ ...finding, path: "skills/spec/scripts/a.ts", id: `moved:${finding.id}` }));
  writeFileSync(join(dir, BASELINE), baselineText(moved));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `a pure move must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("2 findings"), `output must report the count 2, got ${result.stdout}`);
});

test("rejects a same-size baseline whose finding has a different message", () => {
  const dir = repoWithBaseRef([alpha, beta]);
  writeFileSync(join(dir, BASELINE), baselineText([alpha, gamma]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_VIOLATION, `a new function must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes("gamma") && !result.stderr.includes("grew"), `message must name 'gamma' and not claim growth, got ${result.stderr}`);
});

test("rejects a same-size baseline whose finding has a different rule", () => {
  const dir = repoWithBaseRef([alpha, beta]);
  writeFileSync(join(dir, BASELINE), baselineText([alpha, entry({ fn: "beta", rule: "assertion-density" })]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_VIOLATION, `a new rule must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes("assertion-density"), `message must name the rule, got ${result.stderr}`);
});

test("rejects a key counted twice at HEAD when the base counts it once, even if another finding shrank", () => {
  const dir = repoWithBaseRef([alpha, beta]);
  writeFileSync(join(dir, BASELINE), baselineText([alpha, entry({ path: "scripts/other/a.mjs" })]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_VIOLATION, `a doubled key must exit ${EXIT_VIOLATION}, got ${result.status}: ${result.stderr}`);
  assert(result.stderr.includes("1 at base, 2 now") && result.stderr.includes("alpha"), `message must give the counts for alpha, got ${result.stderr}`);
});

test("accepts an unchanged baseline", () => {
  const dir = repoWithBaseRef([alpha, beta]);
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `unchanged baseline must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("2 findings"), `output must report the count 2, got ${result.stdout}`);
});

test("accepts a baseline that shrank", () => {
  const dir = repoWithBaseRef([alpha, beta, gamma]);
  writeFileSync(join(dir, BASELINE), baselineText([beta]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `shrunk baseline must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("1 findings"), `output must report the new count 1, got ${result.stdout}`);
});

test("accepts a baseline absent at the base ref and prints its count", () => {
  const dir = repoWithBaseRef(undefined);
  writeFileSync(join(dir, BASELINE), baselineText([alpha, beta, gamma]));
  const result = runGuard(dir, RATCHET_ARGS);
  assert(result.status === EXIT_OK, `first introduction must exit ${EXIT_OK}, got ${result.status}: ${result.stderr}`);
  assert(result.stdout.includes("accepted with 3 findings"), `output must report the count 3, got ${result.stdout}`);
});

test("rejects an unreadable or malformed baseline with a usage exit", () => {
  const dir = repoWithBaseRef([alpha]);
  const control = runGuard(dir, RATCHET_ARGS);
  assert(control.status === EXIT_OK, `control: the committed baseline is readable, so exit ${EXIT_OK}, got ${control.status}`);
  writeFileSync(join(dir, BASELINE), "{not json");
  const malformed = runGuard(dir, RATCHET_ARGS);
  assert(malformed.status === EXIT_USAGE && malformed.stderr.includes("not valid JSON"), `malformed baseline must exit ${EXIT_USAGE} naming JSON, got ${malformed.status}: ${malformed.stderr}`);
  mkdirSync(join(dir, "gone"));
  const absent = runGuard(dir, ["--baseline", "gone/none.json", "--base-ref", BASE_REF]);
  assert(absent.status === EXIT_USAGE && absent.stderr.includes("cannot read"), `missing file must exit ${EXIT_USAGE} saying it cannot read, got ${absent.status}: ${absent.stderr}`);
});

test("rejects a baseline whose findings lack path, rule or message and an unknown base ref", () => {
  const dir = repoWithBaseRef([alpha]);
  writeFileSync(join(dir, BASELINE), JSON.stringify({ findings: [{ id: "x" }] }));
  const noIds = runGuard(dir, RATCHET_ARGS);
  assert(noIds.status === EXIT_USAGE && noIds.stderr.includes("not a zanity baseline"), `entries without fields must exit ${EXIT_USAGE}, got ${noIds.status}: ${noIds.stderr}`);
  writeFileSync(join(dir, BASELINE), baselineText([alpha]));
  const unknownRef = runGuard(dir, ["--baseline", BASELINE, "--base-ref", "nowhere"]);
  assert(unknownRef.status === EXIT_USAGE && unknownRef.stderr.includes("nowhere"), `unknown ref must exit ${EXIT_USAGE} naming it, got ${unknownRef.status}: ${unknownRef.stderr}`);
});

test("rejects a baseline path that leaves the repository", () => {
  const dir = repoWithBaseRef([alpha]);
  const result = runGuard(dir, ["--baseline", "../outside.json", "--base-ref", BASE_REF]);
  assert(result.status === EXIT_USAGE && result.stderr.includes("outside"), `escaping path must exit ${EXIT_USAGE} saying outside, got ${result.status}: ${result.stderr}`);
});

test("rejects missing or unknown arguments with the usage line", () => {
  const dir = repoWithBaseRef([alpha]);
  const noArgs = runGuard(dir, []);
  assert(noArgs.status === EXIT_USAGE && noArgs.stderr.includes("usage:"), `no arguments must exit ${EXIT_USAGE} with usage, got ${noArgs.status}: ${noArgs.stderr}`);
  const unknown = runGuard(dir, [...RATCHET_ARGS, "--force", "1"]);
  assert(unknown.status === EXIT_USAGE && unknown.stderr.includes("usage:"), `unknown option must exit ${EXIT_USAGE} with usage, got ${unknown.status}: ${unknown.stderr}`);
});
