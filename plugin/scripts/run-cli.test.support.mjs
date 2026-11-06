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

export const ACTIONABLE_WORD_LIMIT = 40;
const FIX_VERBS = [
  "add", "ask", "assign", "change", "chmod", "cite", "commit", "copy", "create", "delete", "drop", "embed", "fill", "fix", "give", "import", "install", "keep", "leave", "link", "list", "lower", "make",
  "merge", "move", "name", "pass", "pin", "point", "prune", "quote", "raise", "rebase", "rebuild", "record", "re-save", "redact", "regenerate", "remove", "rename", "renumber", "reorder", "repeat",
  "replace", "rerun", "resolve", "restore", "retry", "return", "revert", "reword", "rewrite", "run", "send", "set", "split", "stash", "start", "tag", "tick", "trim", "update", "use", "wrap", "write",
];
const FIX_AFTER_BOUNDARY = new RegExp(`(?:[;.]|\\bHint:)\\s+(?:${FIX_VERBS.join("|")})\\b`, "i");
const OFFENDING_VALUE = /\$\{|"[^"]+"|`[^`]+`|\b[\w./-]+\.(?:md|mdc|json|[cm]?[jt]sx?|html|toml|py|sh|txt|ya?ml)\b|:\d+\b|\b(?:line|Slice|AC\[?)\s*\d+|\b[A-Z]{2,}[A-Z0-9]*-\d+\b|(?:^|[\s("'])(?:\/|\.\.?\/|~\/)[\w.-]+/;
const VIOLATED_RULE = /\b(?:must|needs?|missing|not|no|never|banned|forbidden|exceeds?|disagree|differs|empty|outside|invalid|unresolved|stale|only|lacks|holds|has|reads|dirty|uncommitted|past|twice|repeats)\b/i;

/** @param {string} message */
export const actionabilityProblems = (message) => {
  assert(typeof message === "string", `a failure message must be text, got ${typeof message}`);
  assert(message.trim() !== "", `a failure message must not be blank, got ${JSON.stringify(message)}`);
  const problems = [];
  if (!OFFENDING_VALUE.test(message)) problems.push("names no file, line or offending value");
  if (!VIOLATED_RULE.test(message)) problems.push("states no violated rule");
  if (!FIX_AFTER_BOUNDARY.test(message)) problems.push("states no fix as an imperative after ';', '.' or 'Hint:'");
  const words = message.trim().split(/\s+/).length;
  if (words > ACTIONABLE_WORD_LIMIT) problems.push(`runs ${words} words, over the ${ACTIONABLE_WORD_LIMIT} word limit`);
  return problems;
};

/** @param {string} message */
export const assertActionable = (message) => {
  assert(typeof message === "string", `a failure message must be text, got ${typeof message}`);
  const problems = actionabilityProblems(message);
  assert(problems.length === 0, `the failure message ${JSON.stringify(message)} is not actionable: ${problems.join("; ")}`);
};

/** @param {string} output */
export const assertEveryLineActionable = (output) => {
  assert(typeof output === "string", `the failure output must be text, got ${typeof output}`);
  const lines = output.split("\n").filter((line) => line.trim() !== "");
  assert(lines.length > 0, `the failure output must hold at least one message, got ${lines.length} lines`);
  for (const line of lines) assertActionable(line);
};

/** @param {() => unknown} action */
export const assertErrorIsActionable = (action) => {
  assert(typeof action === "function", `the action must be a function, got ${typeof action}`);
  let failure;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, "the action must throw an error, got none");
  assertActionable(failure.message);
};

/**
 * @param {() => unknown} action
 * @param {RegExp} pattern
 */
export const assertErrorMatchesActionable = (action, pattern) => {
  assert(typeof action === "function", `the action must be a function, got ${typeof action}; pass a function.`);
  assert(pattern instanceof RegExp, `the expected message must be a pattern, got ${typeof pattern}; pass a RegExp.`);
  assert.throws(action, pattern);
  assertErrorIsActionable(action);
};
