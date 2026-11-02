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
import { evaluate } from "./lib/guard-core.mjs";

const result = evaluate(() => readFileSync(0, "utf8"), process.env);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status);
