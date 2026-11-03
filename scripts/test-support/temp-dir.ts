import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const PATH_SEPARATOR = /[\\/]/;

export const tempDir = (prefix: string, label: string) => {
  assert(prefix && !PATH_SEPARATOR.test(prefix), `prefix must be a non-empty name without a path separator, got ${JSON.stringify(prefix)}`);
  assert(label && !PATH_SEPARATOR.test(label), `label must be a non-empty name without a path separator, got ${JSON.stringify(label)}`);
  const created = mkdtempSync(join(tmpdir(), `${prefix}-${label}-`));
  assert(created.startsWith(tmpdir() + sep), `the directory must be created under ${tmpdir()}, got ${created}`);
  return created;
};
