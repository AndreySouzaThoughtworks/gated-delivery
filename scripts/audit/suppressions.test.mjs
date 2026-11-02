import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "suppressions.mjs");
const COUNT_FILE = "scripts/audit/suppressions.count";
const GOOD_REASON = "the retry loop already logs every failure upstream";

const ZANITY = ["zanity", "ignore"].join(": ");
const NOQA = ["no", "qa"].join("");
const ESLINT = ["eslint", "disable-next-line"].join("-");
const TYPE_IGNORE = ["type", "ignore"].join(": ");
const TS_EXPECT = ["@ts", "expect", "error"].join("-");
const SEMGREP = ["no", "semgrep"].join("");
const C8 = ["c8", "ignore next"].join(" ");
const SHELLCHECK = ["shellcheck", "disable=SC2086"].join(" ");

const gitRepo = (files, allowed) => {
  assert(typeof allowed === "number", `the allowed count must be a number, got ${typeof allowed}`);
  assert(Object.keys(files).length > 0, `a fixture repo needs at least one file, got ${Object.keys(files).length}`);
  const dir = mkdtempSync(join(tmpdir(), "suppressions-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const all = { ...files, [COUNT_FILE]: `${allowed}\n` };
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
};

const runGuard = (dir) => {
  assert(typeof dir === "string", `the guard runs in a directory path, got ${typeof dir}`);
  const result = spawnSync("node", [GUARD, "--repo", dir], { encoding: "utf8" });
  assert(result.status !== null, `the guard must exit on its own, got signal ${result.signal}`);
  return { code: result.status, out: result.stdout + result.stderr };
};

const verdict = (line, allowed = 1) => {
  assert(typeof line === "string" && line.length > 0, `a fixture line must be non-empty text, got "${line}"`);
  assert(Number.isInteger(allowed), `the allowed count must be an integer, got ${allowed}`);
  return runGuard(gitRepo({ "src/a.mjs": `${line}\n` }, allowed));
};

test("accepts a zanity marker with one rule and a real reason", () => {
  const { code, out } = verdict(`call(); // ${ZANITY}[forbidden-call] -- ${GOOD_REASON}`);
  assert(code === 0, `expected exit 0, got ${code}: ${out}`);
  assert(out.includes("1 suppressions"), `expected the count 1 in the output, got: ${out}`);
});

test("accepts each other marker family when it carries a reason", () => {
  const lines = {
    "a.mjs": `// ${ESLINT} no-console -- ${GOOD_REASON}`,
    "b.py": `x = 1  # ${NOQA}: BLE001 -- ${GOOD_REASON}`,
    "c.py": `x = 1  # ${TYPE_IGNORE}[attr] -- ${GOOD_REASON}`,
    "d.ts": `// ${TS_EXPECT} -- ${GOOD_REASON}`,
    "e.py": `x = 1  # ${SEMGREP} -- ${GOOD_REASON}`,
    "f.mjs": `/* ${C8} -- ${GOOD_REASON} */`,
    "g.sh": `# ${SHELLCHECK} -- ${GOOD_REASON}`,
  };
  const files = Object.fromEntries(Object.entries(lines).map(([name, line]) => [name, `${line}\n`]));
  const { code, out } = runGuard(gitRepo(files, Object.keys(lines).length));
  assert(code === 0, `expected exit 0 for ${Object.keys(lines).length} reasoned markers, got ${code}: ${out}`);
  assert(out.includes("7 suppressions"), `expected 7 suppressions counted, got: ${out}`);
});

test("rejects every marker family when the reason is missing", () => {
  const bare = [`// ${ESLINT} no-console`, `# ${NOQA}: BLE001`, `# ${TYPE_IGNORE}`, `// ${TS_EXPECT}`, `# ${SEMGREP}`, `// ${C8}`, `# ${SHELLCHECK}`];
  for (const line of bare) {
    const { code, out } = verdict(line);
    assert(code === 1, `expected exit 1 for "${line}", got ${code}: ${out}`);
    assert(out.includes("has no reason"), `expected "has no reason" for "${line}", got: ${out}`);
  }
});

test("rejects a bare zanity ignore that silences every rule", () => {
  const { code, out } = verdict(`call(); // ${ZANITY} -- ${GOOD_REASON}`);
  assert(code === 1, `expected exit 1 for a bare ignore, got ${code}: ${out}`);
  assert(out.includes("names 0 rules"), `expected the zero-rule complaint, got: ${out}`);
});

test("rejects a zanity ignore that names an empty list or two rules", () => {
  const empty = verdict(`call(); // ${ZANITY}[] -- ${GOOD_REASON}`);
  const pair = verdict(`call(); // ${ZANITY}[forbidden-call, passthrough-wrapper] -- ${GOOD_REASON}`);
  assert(empty.code === 1 && empty.out.includes("names 0 rules"), `expected exit 1 and "names 0 rules" for [], got ${empty.code}: ${empty.out}`);
  assert(pair.code === 1 && pair.out.includes("names 2 rules"), `expected exit 1 and "names 2 rules" for a pair, got ${pair.code}: ${pair.out}`);
});

test("rejects reasons that are empty, too short or filler", () => {
  const weak = ["", "false positive", "n/a", "todo", "legacy", "temporary", "fix later", "wontfix", "noise", "ok", "this is a false positive noise ok", "it is fine here", "same same same same same"];
  for (const reason of weak) {
    const { code, out } = verdict(`call(); // ${ZANITY}[forbidden-call] -- ${reason}`);
    assert(code === 1, `expected exit 1 for the reason "${reason}", got ${code}: ${out}`);
    assert(/has no reason|meaningful distinct words/.test(out), `expected a reason complaint for "${reason}", got: ${out}`);
  }
});

test("accepts a reason of exactly the minimum meaningful words", () => {
  const { code, out } = verdict(`call(); // ${ZANITY}[forbidden-call] -- the parser rejects hostile input`);
  assert(code === 0, `expected exit 0 for 4 meaningful words (parser rejects hostile input), got ${code}: ${out}`);
  const short = verdict(`call(); // ${ZANITY}[forbidden-call] -- the parser rejects input`);
  assert(short.code === 1, `expected exit 1 for 3 meaningful words, got ${short.code}: ${short.out}`);
});

test("fails when the count exceeds the committed ratchet and passes at it", () => {
  const line = `call(); // ${ZANITY}[forbidden-call] -- ${GOOD_REASON}`;
  const over = verdict(line, 0);
  assert(over.code === 1 && over.out.includes("exceed the 0 allowed"), `expected exit 1 and "exceed the 0 allowed", got ${over.code}: ${over.out}`);
  const at = verdict(line, 1);
  assert(at.code === 0, `expected exit 0 at the ratchet, got ${at.code}: ${at.out}`);
});

test("fails when the ratchet is higher than the count so gains are locked in", () => {
  const { code, out } = runGuard(gitRepo({ "src/a.mjs": "call();\n" }, 2));
  assert(code === 1 && out.includes("below the 2 recorded"), `expected exit 1 and "below the 2 recorded", got ${code}: ${out}`);
});

test("fails when the ratchet file is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "suppressions-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "a.mjs"), "call();\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  const { code, out } = runGuard(dir);
  assert(code === 1 && out.includes("is missing"), `expected exit 1 and "is missing", got ${code}: ${out}`);
});

test("a clean repo passes at zero and prose mentioning a marker is ignored", () => {
  const { code, out } = runGuard(gitRepo({ "src/a.mjs": "call();\n", "docs/rules.md": `| ${TS_EXPECT} | lens |\n` }, 0));
  assert(code === 0, `expected exit 0 for a clean repo, got ${code}: ${out}`);
  assert(out.includes("0 suppressions"), `expected 0 suppressions, got: ${out}`);
});

test("an untracked file is not scanned", () => {
  const dir = gitRepo({ "src/a.mjs": "call();\n" }, 0);
  writeFileSync(join(dir, "loose.mjs"), `// ${ESLINT} no-console\n`);
  const { code, out } = runGuard(dir);
  assert(code === 0, `expected exit 0 because git does not track loose.mjs, got ${code}: ${out}`);
  assert(out.includes("0 suppressions"), `expected 0 suppressions, got: ${out}`);
});
