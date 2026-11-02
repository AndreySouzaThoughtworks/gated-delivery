import assert from "node:assert/strict";

// Target may be quoted and may carry a trailing slash: `rm -rf "$HOME"` and `rm -rf ~/` are the
// same catastrophe as `rm -rf $HOME`. Demanding whitespace-or-end straight after the target let
// both through.
const HOME_OR_ROOT = /['"]?(\/|~|\$HOME|\/\*)\/?['"]?(\s|$)/.source;
// main/master must be a whole ref, not a substring. Every character that can legally sit against a
// ref name has to be in these classes or the guard is bypassable: `/` for `refs/heads/main`, `:` for
// `HEAD:main`, and quotes for `'main'`. The trailing class is what keeps `fix/main-menu` and
// `release/main-line` allowed — those continue with `-`, so they never close the match.
const PROTECTED_REF = /([\s/:'"]|^)(main|master)([\s'"]|$)/.source;
// `git push origin +main` force-pushes with no --force flag at all. Same catastrophe, different
// spelling, and the flag-based patterns below cannot see it.
const PLUS_FORCE = /\bgit\s+push\b[^|&;]*\s\+(\S*[\s/:])?(main|master)([\s'"]|$)/;

const CATASTROPHIC = [
  {
    // Recursive and force may come combined (`-Rf`), split (`-r -f`) or long (`--recursive --force`),
    // in any order, so each is a separate lookahead over the same command segment.
    pattern: new RegExp(
      /\brm\b(?=[^|&;]*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b)(?=[^|&;]*\s(-[a-zA-Z]*f[a-zA-Z]*|--force)\b)[^|&;]*\s/
        .source + HOME_OR_ROOT,
    ),
    why: "recursive force-delete targeting / , ~ , $HOME, or /*",
  },
  {
    pattern: new RegExp(/\bgit\s+push\b[^|&;]*(--force|-f)\b[^|&;]*/.source + PROTECTED_REF),
    why: "force-push to main/master",
  },
  {
    pattern: new RegExp(
      /\bgit\s+push\b[^|&;]*/.source + PROTECTED_REF + /[^|&;]*(--force|-f)\b/.source,
    ),
    why: "force-push to main/master",
  },
  {
    pattern: PLUS_FORCE,
    why: "force-push to main/master (via the +ref refspec)",
  },
  {
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    why: "fork bomb",
  },
];

const EXIT_OK = 0;

const EXIT_BLOCK = 2;
const ESCAPE_VARIABLE = "GATED_DELIVERY_GUARD";
const ESCAPE_VALUE = "off";
const ALLOWED_RESULT = { status: EXIT_OK, stdout: "", stderr: "" };

const decide = (payload) => {
  assert(payload !== null && typeof payload === "object", `the payload must be a JSON object, got ${JSON.stringify(payload)}`);
  const command = payload.tool_input?.command;
  assert(typeof command === "string", `tool_input.command must be a string, got ${JSON.stringify(command)}`);
  return CATASTROPHIC.find(({ pattern }) => pattern.test(command))?.why ?? null;
};

const evaluate = (readInput, env, decider = decide) => {
  assert(typeof readInput === "function", `readInput must be a function, got ${typeof readInput}`);
  assert(typeof decider === "function", `decider must be a function, got ${typeof decider}`);
  if (env[ESCAPE_VARIABLE] === ESCAPE_VALUE) return ALLOWED_RESULT;
  try {
    const reason = decider(JSON.parse(readInput()));
    if (reason === null) return ALLOWED_RESULT;
    const permissionDecisionReason = `Blocked by gated-delivery guard: ${reason}. If this is genuinely intended, run it outside the agent or adjust the command.`;
    const output = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason } };
    return { status: EXIT_OK, stdout: JSON.stringify(output), stderr: "" };
  } catch (error) {
    const stderr = `gated-delivery guard blocked this command because it could not check it: ${error.message}. Send the command again as a valid Bash tool call. If the guard itself is broken, start Claude Code with ${ESCAPE_VARIABLE}=${ESCAPE_VALUE} to turn it off.\n`;
    return { status: EXIT_BLOCK, stdout: "", stderr };
  }
};

export { decide, evaluate };
