import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "jsdoc-types-only.ts");
const SHIPPED_FILE = "plugin/a.mjs";
const SHIPPED_TEST_FILE = "plugin/a.test.mjs";
const OUTSIDE_FILE = "scripts/b.mjs";

const gitRepo = (files: Record<string, string>) => {
  assert(Object.keys(files).length > 0, `a fixture repo needs at least one file, got ${Object.keys(files).length}`);
  const dir = mkdtempSync(join(tmpdir(), "jsdoc-types-only-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  const staged = execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" }).split("\n").filter(Boolean);
  assert(staged.length === Object.keys(files).length, `every fixture file must be staged, got ${staged.length} of ${Object.keys(files).length}`);
  return dir;
};

const verdict = (files: Record<string, string>) => {
  assert(Object.values(files).every((body) => body.endsWith("\n")), `every fixture file must end in a newline, got ${Object.keys(files).find((path) => !files[path].endsWith("\n"))}`);
  const result = spawnSync("node", [GUARD, "--repo", gitRepo(files)], { encoding: "utf8" });
  assert(result.status !== null, `the guard must exit on its own, got signal ${result.signal}`);
  return { code: result.status, out: result.stdout + result.stderr };
};

test("accepts a block holding only type tags, including multi-line types", () => {
  const source = [
    "/**",
    " * @typedef {{ name: string,",
    " *   marker: string }} Watcher",
    " * @template {object} T",
    " * @param {T} value",
    " * @param {number} [depth]",
    " * @returns {Watcher[]}",
    " */",
    "export const f = (value, depth) => [];",
    '/** @type {import("node:fs").Stats} */',
    "export let stats;",
    '/** @import {Dirent} from "node:fs" */',
    "",
  ].join("\n");
  const { code, out } = verdict({ [SHIPPED_FILE]: source });
  assert(code === 0, `expected exit 0 for a types-only block, got ${code}: ${out}`);
  assert(out.includes("3 JSDoc blocks"), `expected 3 blocks counted, got: ${out}`);
});

test("rejects a prose line and names file:line and the text", () => {
  const source = ["/**", " * Reads the marker table.", " * @param {string} dir", " */", "export const f = (dir) => dir;", ""].join("\n");
  const { code, out } = verdict({ [SHIPPED_FILE]: source });
  assert(code === 1, `expected exit 1 for a prose line, got ${code}: ${out}`);
  assert(out.includes(`${SHIPPED_FILE}:2:`), `expected ${SHIPPED_FILE}:2 in the message, got: ${out}`);
  assert(out.includes("Reads the marker table."), `expected the offending text in the message, got: ${out}`);
});

test("rejects prose after the parameter name", () => {
  const source = ["", "/**", " * @param {string} dir - the directory to scan", " */", "export const f = (dir) => dir;", ""].join("\n");
  const { code, out } = verdict({ [SHIPPED_FILE]: source });
  assert(code === 1, `expected exit 1 for prose after the name, got ${code}: ${out}`);
  assert(out.includes(`${SHIPPED_FILE}:3:`), `expected ${SHIPPED_FILE}:3 in the message, got: ${out}`);
  assert(out.includes("the directory to scan"), `expected the offending text in the message, got: ${out}`);
});

test("rejects prose after a returns type and a one-line prose block", () => {
  const source = ["/** @returns {string} the joined path */", "export const f = () => '';", "/** Joins paths. */", "export const g = () => '';", ""].join("\n");
  const { code, out } = verdict({ [SHIPPED_FILE]: source });
  assert(code === 1, `expected exit 1, got ${code}: ${out}`);
  assert(out.includes(`${SHIPPED_FILE}:1:`), `expected ${SHIPPED_FILE}:1 for the returns prose, got: ${out}`);
  assert(out.includes(`${SHIPPED_FILE}:3:`), `expected ${SHIPPED_FILE}:3 for the one-line prose, got: ${out}`);
});

test("rejects a tag that is not a type tag", () => {
  const source = ["/**", " * @deprecated", " */", "export const f = () => 1;", ""].join("\n");
  const { code, out } = verdict({ [SHIPPED_FILE]: source });
  assert(code === 1, `expected exit 1 for @deprecated, got ${code}: ${out}`);
  assert(out.includes("@deprecated is not a type tag"), `expected the tag named, got: ${out}`);
});

test("a --repo directory that does not exist stops the guard with a message that names it", () => {
  const missing = join(tmpdir(), "jsdoc-types-only-test-no-such-directory");
  const result = spawnSync("node", [GUARD, "--repo", missing], { encoding: "utf8" });
  assert(result.status !== 0, `expected a non-zero exit for a missing --repo, got ${result.status}`);
  assert(result.stderr.includes(`${missing} must exist`), `expected the message to name ${missing}, got: ${result.stderr}`);
});

test("ignores test files and files outside plugin", () => {
  const prose = ["/**", " * Prose.", " */", "export const f = 1;", ""].join("\n");
  const { code, out } = verdict({ [SHIPPED_TEST_FILE]: prose, [OUTSIDE_FILE]: prose, [SHIPPED_FILE]: "export const g = 1;\n" });
  assert(code === 0, `expected exit 0 when only unscoped files hold prose, got ${code}: ${out}`);
  assert(out.includes("0 JSDoc blocks in 1 shipped files"), `expected one audited file with no blocks, got: ${out}`);
});
