#!/usr/bin/env node
// PreToolUse hook (Bash): deny a small, high-signal set of catastrophic commands.
// Deliberately narrow — false positives erode trust, so this blocks only things that
// are almost never legitimate. Everything else passes through untouched.
//
// THREAT MODEL — read before treating a gap here as a vulnerability.
// This is an accident guard, NOT a sandbox and NOT a security boundary. It pattern-matches one
// command string, so any indirection defeats it by construction: `bash script.sh`, `node -e ...`,
// a variable (`X='rm -rf /'; $X`), base64, or writing a file and running it later. All of those
// are ALLOW and always will be. Closing them would need real execution sandboxing, which a
// 60-line regex hook cannot provide.
// What it is worth fixing: a *direct, literal* spelling of a catastrophic command that slips
// through — a quoted target, a trailing slash, a fully-qualified ref, the `+ref` force idiom.
// Those are the accidents this exists to catch, and each one has a row in guard-bash.test.mjs.

import { readFileSync } from "node:fs";

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

const allow = () => process.exit(0);
const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
};

const main = () => {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    allow();
  }
  const command = input?.tool_input?.command ?? "";
  for (const { pattern, why } of CATASTROPHIC) {
    if (pattern.test(command)) {
      deny(
        `Blocked by gated-delivery guard: ${why}. If this is genuinely intended, run it outside the agent or adjust the command.`,
      );
    }
  }
  allow();
};

main();
