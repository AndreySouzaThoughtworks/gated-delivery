import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempDir = (prefix, label) => {
  assert(prefix.length > 0, `a temp folder prefix must not be blank, got ${JSON.stringify(prefix)}; name the test suite`);
  assert(label.length > 0, `a temp folder label must not be blank, got ${JSON.stringify(label)}; name the fixture`);
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-${label}-`));
  assert(existsSync(dir), `the temp folder must exist after creation, got none at ${dir}`);
  return dir;
};
