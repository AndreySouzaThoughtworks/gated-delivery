import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../../plugin/hooks/lib/guard-core.mjs";

const EXIT_OK = 0;
const EXIT_BLOCK = 2;
const FORMAT_HOOK = join(dirname(fileURLToPath(import.meta.url)), "../../plugin/hooks/format-on-edit.mjs");

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} HookResult
 */

/**
 * @param {string} raw
 * @returns {string}
 */
const toClaudeShellPayload = (raw) => {
  const payload = JSON.parse(raw);
  assert(typeof payload === "object" && payload !== null, `the Cursor payload must be a JSON object, got ${raw}`);
  assert(!Array.isArray(payload), `the Cursor payload must be an object, not an array, got ${raw}`);
  return JSON.stringify({ tool_input: { command: payload.command } });
};

/**
 * @param {string} message
 * @returns {string}
 */
const denial = (message) => { // zanity: ignore[assertion-density] -- no-invariant: both guard verdict branches pass it the guard's own non-empty text
  return JSON.stringify({ permission: "deny", user_message: message, agent_message: message });
};

/**
 * @param {string} raw
 * @param {Record<string, string | undefined>} env
 * @returns {HookResult}
 */
export const guardShell = (raw, env) => { // zanity: ignore[assertion-density] -- no-invariant: the guard core already answers only exit 0 or 2 with its own deny shape
  const verdict = evaluate(() => toClaudeShellPayload(raw), env);
  if (verdict.status === EXIT_BLOCK) {
    return { status: EXIT_BLOCK, stdout: denial(verdict.stderr.trim()), stderr: verdict.stderr };
  }
  if (verdict.stdout === "") return { status: EXIT_OK, stdout: JSON.stringify({ permission: "allow" }), stderr: "" };
  const { permissionDecision, permissionDecisionReason } = JSON.parse(verdict.stdout).hookSpecificOutput;
  return { status: EXIT_OK, stdout: denial(permissionDecisionReason), stderr: "" };
};

/**
 * @param {string} raw
 * @param {string} cwd
 * @returns {HookResult}
 */
export const formatEditedFile = (raw, cwd) => { // zanity: ignore[assertion-density] -- single-invariant: the spawn result is the only outside data and a second assertion would restate it
  let filePath;
  try {
    filePath = JSON.parse(raw).file_path;
  } catch {
    return { status: EXIT_OK, stdout: "", stderr: "" };
  }
  if (typeof filePath !== "string") return { status: EXIT_OK, stdout: "", stderr: "" };
  const formatted = spawnSync(process.execPath, [FORMAT_HOOK], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    cwd,
    encoding: "utf8",
  });
  assert(formatted.error === undefined, `the format hook must start, got ${formatted.error?.message}`);
  return { status: EXIT_OK, stdout: "", stderr: formatted.stderr };
};
