import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const gitRepo = (files: Record<string, string>, prefix: string) => {
  assert(Object.keys(files).length > 0, `a fixture repo needs at least one file, got ${Object.keys(files).length}`);
  const dir = mkdtempSync(join(tmpdir(), prefix));
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
