import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempDir = (prefix, label) => {
  assert(prefix.length > 0, `a temp folder prefix must not be blank, got ${JSON.stringify(prefix)}; name the test suite`);
  assert(label.length > 0, `a temp folder label must not be blank, got ${JSON.stringify(label)}; name the fixture`);
  return mkdtempSync(join(tmpdir(), `${prefix}-${label}-`));
};
