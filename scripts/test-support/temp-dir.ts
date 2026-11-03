import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempDir = (prefix: string, label: string) => {
  return mkdtempSync(join(tmpdir(), `${prefix}-${label}-`));
};
