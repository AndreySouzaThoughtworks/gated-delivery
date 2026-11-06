import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Check = {
  number: number;
  id: string;
  title: string;
  rule: string;
  fix: string;
  example: string;
  mistake: string | null;
  source: string;
};

export const CHECK_FIELDS = ["number", "id", "title", "rule", "fix", "example", "mistake", "source"];
export const REGISTRY_FILE = "checks-registry.json";

export const parseChecks = (text: string): Check[] => {
  const parsed: unknown = JSON.parse(text);
  assert(Array.isArray(parsed), `${REGISTRY_FILE} must hold a list of checks, got ${typeof parsed}; restore the list`);
  assert(parsed.length > 0, `${REGISTRY_FILE} must hold at least one check, got an empty list; restore the rows`);
  return parsed;
};

const REGISTRY_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const checksRegistry = (name = REGISTRY_FILE): readonly Check[] => {
  assert(basename(name) === name, `the registry name must be a bare file name, got ${name}; pass ${REGISTRY_FILE}`);
  assert(name.endsWith(".json"), `the registry name must end in .json, got ${name}; pass ${REGISTRY_FILE}`);
  const file = join(REGISTRY_DIRECTORY, name);
  assert(existsSync(file), `${file} must exist, got none; restore ${REGISTRY_FILE}`);
  return parseChecks(readFileSync(file, "utf8"));
};

export const CHECKS: readonly Check[] = checksRegistry();
