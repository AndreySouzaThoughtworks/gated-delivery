import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/**
 * @param {string} script
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptions} [options]
 */
export const runScript = (script, args, options = {}) => {
  assert(typeof script === "string" && script.length > 0, `the script path must be a non-empty string, got ${JSON.stringify(script)}`);
  assert(Array.isArray(args), `args must be a list, got ${typeof args}`);
  const result = spawnSync("node", [script, ...args], { encoding: "utf8", ...options });
  assert(result.status !== null, `the command must exit on its own, got signal ${result.signal}`);
  return result;
};
