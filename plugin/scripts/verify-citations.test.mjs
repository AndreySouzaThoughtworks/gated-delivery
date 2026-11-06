import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isInside, verifyText, violationFor } from "./verify-citations.mjs";
import { assertActionable, assertEveryLineActionable, assertErrorIsActionable } from "./run-cli.test.support.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "verify-citations.mjs");
const EXIT_VERIFIED = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;

const checked = (text, root) => {
  assert(typeof text === "string", `the scout output must be text, got ${typeof text}`);
  const violations = verifyText(text, root);
  assert(Array.isArray(violations), `verifyText must return a list, got ${typeof violations}`);
  for (const violation of violations) assertActionable(violation.replace(/^\d+: /, ""));
  return violations;
};

const scratch = () => {
  const outside = mkdtempSync(join(tmpdir(), "verify-citations-"));
  const root = join(outside, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "const first = 1;\n  const second = 2;  \nconst third = 3;\n");
  writeFileSync(join(outside, "secret.txt"), "top secret\n");
  assert(root.startsWith(outside), `${root} must sit inside ${outside}`);
  assert(existsSync(join(root, "src", "app.js")), `the fixture file must exist under ${root}`);
  return { root, outside };
};

const run = (args, input) => {
  assert(Array.isArray(args), `args must be a list, got ${typeof args}`);
  const result = spawnSync("node", [SCRIPT, ...args], { input, encoding: "utf8" });
  assert(result.status !== null, `the command must exit on its own, got signal ${result.signal}`);
  return result;
};

test("accepts a correct finding", () => {
  const { root } = scratch();
  assert.deepEqual(checked("- src/app.js:1 :: const first = 1;\n", root), []);
});

test("accepts a correct finding whose file line has surrounding whitespace", () => {
  const { root } = scratch();
  assert.deepEqual(checked("- src/app.js:2 :: const second = 2;", root), []);
});

test("accepts a none found line as is", () => {
  const { root } = scratch();
  assert.deepEqual(checked("- none found :: retryPolicy in src/", root), []);
});

test("rejects a missing file and shows the path", () => {
  const { root } = scratch();
  const [violation] = checked("- src/gone.js:1 :: x", root);
  assert.match(violation, /^1: file src\/gone\.js does not exist/);
});

test("rejects a line number past the end and shows both numbers", () => {
  const { root } = scratch();
  const [violation] = checked("- src/app.js:4 :: const third = 3;", root);
  assert.match(violation, /^1: line 4 is past the end of src\/app\.js, which has 3 lines/);
});

test("rejects line 0 and a non-integer line", () => {
  const { root } = scratch();
  for (const line of ["0", "1.5", "abc", "-1", ""]) {
    const [violation] = checked(`- src/app.js:${line} :: const first = 1;`, root);
    assert.match(violation, new RegExp(`line "${line}" of src/app\\.js is not a positive integer`));
  }
});

test("rejects a quote that sits on a different line and shows what the line reads", () => {
  const { root } = scratch();
  const [violation] = checked("- src/app.js:1 :: const third = 3;", root);
  assert.match(violation, /quote "const third = 3;" is not line 1 of src\/app\.js, which reads "const first = 1;"/);
});

test("rejects a quote that differs only by inner whitespace", () => {
  const { root } = scratch();
  const [violation] = checked("- src/app.js:1 :: const  first = 1;", root);
  assert.match(violation, /is not line 1 of src\/app\.js/);
});

test("rejects a path that escapes the root with dot-dot segments", () => {
  const { root } = scratch();
  const [violation] = checked("- ../secret.txt:1 :: top secret", root);
  assert.match(violation, /outside the root/);
});

test("rejects an absolute path outside the root", () => {
  const { root, outside } = scratch();
  const [violation] = checked(`- ${join(outside, "secret.txt")}:1 :: top secret`, root);
  assert.match(violation, /outside the root/);
});

test("rejects a symlink inside the root that points outside it", () => {
  const { root, outside } = scratch();
  symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
  const [violation] = checked("- link.txt:1 :: top secret", root);
  assert.match(violation, /path "link\.txt" is a symlink to .*secret\.txt, outside the root/);
});

test("rejects a directory used as a file", () => {
  const { root } = scratch();
  const [violation] = checked("- src:1 :: x", root);
  assert.match(violation, /^1: path "src" is not a regular file/);
});

test("rejects a malformed line, a blank line and empty input, never skipping them", () => {
  const { root } = scratch();
  assert.match(checked("src/app.js:1 const first = 1;", root)[0], /^1: not a finding line/);
  assert.match(checked("- src/app.js:1 :: const first = 1;\n\n- none found :: x", root)[0], /^2: not a finding line, got ""/);
  assert.match(checked("", root)[0], /^1: not a finding line/);
});

test("rejects an empty quote and a whitespace-only quote", () => {
  const { root } = scratch();
  assert.match(checked("- src/app.js:1 :: ", root)[0], /^1: quote for src\/app\.js:1 is empty/);
  assert.match(checked("- src/app.js:1 ::    ", root)[0], /is empty/);
});

test("numbers each violation by its line in the input", () => {
  const { root } = scratch();
  const violations = checked("- src/app.js:1 :: const first = 1;\n- src/app.js:9 :: x\n- src/app.js:3 :: wrong", root);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /^2: /);
  assert.match(violations[1], /^3: /);
});

test("violationFor refuses a relative root and a root that is not its own realpath", () => {
  const { root, outside } = scratch();
  const finding = { path: "src/app.js", line: "1", quote: "const first = 1;" };
  assert.throws(() => violationFor("repo", finding), /the root must be absolute, got "repo"/);
  assertErrorIsActionable(() => violationFor("repo", finding));
  symlinkSync(root, join(outside, "alias"));
  assert.throws(() => violationFor(join(outside, "alias"), finding), /the root must be its own realpath/);
  assert.equal(violationFor(realpathSync(root), finding), null);
});

test("isInside refuses a relative root and a relative target", () => {
  assert.throws(() => isInside("repo", "/repo/a"), /the root must be absolute, got "repo"/);
  assert.throws(() => isInside("/repo", "a"), /the target must be absolute, got "a"/);
  assertErrorIsActionable(() => isInside("repo", "/repo/a"));
  assertErrorIsActionable(() => isInside("/repo", "a"));
  assert.equal(isInside("/repo", "/repo/a"), true);
  assert.equal(isInside("/repo", "/repo/../x"), false);
  assert.equal(isInside("/repo", "/repo"), true);
  assert.equal(isInside("/repo", "/repository"), false);
});

test("verifyText refuses non-text input and a root that is not a directory", () => {
  const { root } = scratch();
  assert.throws(() => verifyText(42, root), /the scout output must be text, got number/);
  assert.throws(() => verifyText("", join(root, "missing")), /the root must be an existing directory/);
  assert.throws(() => verifyText("", join(root, "src", "app.js")), /the root must be an existing directory/);
  assertErrorIsActionable(() => verifyText("", join(root, "missing")));
});

test("the command exits 0 when every finding verifies, reading a file argument", () => {
  const { root, outside } = scratch();
  const input = join(outside, "scout.txt");
  writeFileSync(input, "- src/app.js:1 :: const first = 1;\n- none found :: x\n");
  const result = run(["--root", root, input]);
  assert.equal(result.status, EXIT_VERIFIED, result.stderr);
  assert.equal(result.stdout, "");
});

test("the command exits 1 and prints one line per violation, reading stdin", () => {
  const { root } = scratch();
  const result = run(["--root", root], "- src/app.js:1 :: nope\n- src/app.js:2 :: const second = 2;\n");
  assert.equal(result.status, EXIT_VIOLATIONS);
  assert.match(result.stdout, /^1: quote "nope" is not line 1 of src\/app\.js, which reads "const first = 1;"; copy the line verbatim\.\n$/);
  assertEveryLineActionable(result.stdout.replace(/^\d+: /gm, ""));
});

test("the command defaults the root to the working directory", () => {
  const { root } = scratch();
  const result = spawnSync("node", [SCRIPT], { input: "- src/app.js:1 :: const first = 1;", encoding: "utf8", cwd: root });
  assert.equal(result.status, EXIT_VERIFIED, result.stderr);
});

test("the command exits 2 on a usage error", () => {
  const { root, outside } = scratch();
  const missingFile = run(["--root", root, join(outside, "absent.txt")]);
  const twoFiles = run(["--root", root, "a.txt", "b.txt"]);
  const emptyRoot = run(["--root", ""], "");
  const unknownOption = run(["--bogus"], "");
  const missingRoot = run(["--root", join(outside, "nowhere")], "");
  for (const result of [missingFile, twoFiles, emptyRoot, unknownOption, missingRoot]) {
    assert.equal(result.status, EXIT_USAGE, result.stderr);
    assert.match(result.stderr, /usage: verify-citations\.mjs/);
  }
  assert.match(twoFiles.stderr, /must get at most one input file, got 2/);
  assert.match(emptyRoot.stderr, /`--root` must name a directory/);
  for (const result of [twoFiles, emptyRoot, missingRoot]) assertActionable(result.stderr.split("\n")[0].replace(/^verify-citations: /, ""));
});
