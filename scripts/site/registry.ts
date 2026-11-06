import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CheckEntry } from "./html.ts";

export const REGISTRY_MODULE = "scripts/audit/checks-registry.ts";
const REQUIRED_FIELDS: (keyof CheckEntry)[] = ["number", "id", "title", "rule", "fix", "example", "mistake", "source"];

export const validateChecks = (checks: unknown): CheckEntry[] => {
  assert(Array.isArray(checks) && checks.length > 0, `${REGISTRY_MODULE} must export a non-empty list of checks, got ${JSON.stringify(checks)}; export CHECKS.`);
  for (const check of checks) {
    for (const field of REQUIRED_FIELDS) {
      assert(check?.[field] !== undefined && check[field] !== "", `check ${check?.number ?? "?"} in ${REGISTRY_MODULE} lacks the field "${field}", got ${JSON.stringify(check?.[field])}; fill it in, or use null for a mistake with no category.`);
    }
  }
  return checks as CheckEntry[];
};

export const loadChecks = async (root: string): Promise<CheckEntry[]> => {
  assert(root !== "", `the registry is read under the repository root, got an empty path; pass the root.`);
  const path = join(root, REGISTRY_MODULE);
  assert(existsSync(path), `${REGISTRY_MODULE} is missing, so the CI checks page has no source. Rule: the page renders from the registry. Fix: restore the registry module.`);
  const registry = await import(pathToFileURL(path).href);
  return validateChecks(typeof registry.checksRegistry === "function" ? registry.checksRegistry() : registry.CHECKS);
};
