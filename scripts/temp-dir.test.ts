import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { tempDir } from "./test-support/temp-dir.ts";

test("tempDir creates a directory under the system temp dir named after prefix and label", () => {
  const created = tempDir("gd-test", "unit");
  assert.ok(existsSync(created), `expected ${created} to exist`);
  assert.ok(created.startsWith(tmpdir()), `expected ${created} under ${tmpdir()}`);
  assert.match(created, /gd-test-unit-/);
});

test("tempDir refuses a prefix or label that could escape the temp dir", () => {
  assert.throws(() => tempDir("../evil", "x"), /prefix must be a non-empty name/);
  assert.throws(() => tempDir("ok", ""), /label must be a non-empty name/);
  assert.throws(() => tempDir("ok", "a/b"), /label must be a non-empty name/);
});
