#!/usr/bin/env node
// Executes the `## Deterministic Checks` fence from a skill's evals.md.
//
// Until now nothing ran those fences — they were documentation. Every measure defect this repo has
// shipped (a `\|` that matches a literal pipe, a key that also names a heading) was invisible
// precisely because no command was ever executed.
//
//   node scripts/eval/run-checks.mjs --lint                           every skill: prove each command RUNS
//   node scripts/eval/run-checks.mjs <skill> <file>                   one skill: report each command's result
//   node scripts/eval/run-checks.mjs <skill> <file> --scenario <id>   grade the checks whose `# expect:` names <id>

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const SKILLS_DIR = join(process.cwd(), "plugin", "skills");

// `sh -c` reports only the LAST stage of a pipeline, so a broken command anywhere upstream exits 0
// and the check reads as runnable. Several fences are pipelines. `pipefail` fixes it but is not in
// POSIX sh — CI's /bin/sh is dash — so run under bash where available and say so when it isn't.
const SHELL = existsSync("/bin/bash")
  ? { cmd: "/bin/bash", args: ["-o", "pipefail", "-c"], pipelineAware: true }
  : { cmd: "sh", args: ["-c"], pipelineAware: false };

// Variables the runner supplies, so fences can refer to the repo under test. Documented contract:
// a fence may use "$WORKTREE" without assigning it. Anything else must be assigned in the fence.
const PROVIDED = { WORKTREE: process.cwd() };

/**
 * POSIX shell quoting. `JSON.stringify` is JSON encoding, not shell quoting: it wraps in double
 * quotes, inside which `$(...)`, backticks and `$VAR` still expand — a path containing `$(id -u)`
 * was executed rather than read. Single quotes suppress all expansion; an embedded single quote is
 * closed, escaped, and reopened.
 */
const shellQuote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/**
 * Variables a fence references that nothing supplies. Such a reference expands to empty and the
 * check then passes for a reason unrelated to what it measures.
 *
 * This is a character scan, not a regex, because quote state cannot be matched: an apostrophe
 * inside a double-quoted argument ("it's $VAR") is not a quote delimiter, and a regex that strips
 * `'...'` spans swallowed the variable after it.
 *
 * Quote state is per command-substitution level, not per command: `$( )` restarts quoting, so the
 * inner quotes of `echo "$(echo "it's ok") $VAR"` open and close inside the substitution and leave
 * the outer `"` intact. Scanned flat, that apostrophe opened a span that swallowed `$VAR`.
 *
 * Expansion forms, by whether an unset variable still yields something:
 *   ${VAR-w} ${VAR:-w} ${VAR=w} ${VAR:=w}   fallback supplied      -> fine
 *   ${VAR?w} ${VAR:?w}                      errors loudly          -> fine, the run fails visibly
 *   ${VAR+w} ${VAR:+w} ${VAR} $VAR          empty when unset       -> flag
 * The `+` forms are the trap: they look like defaults and are the exact silent-empty case.
 */
const unresolvedVars = (command, assigned) => {
  const found = new Set();
  const enclosing = [];
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && !inSingle) {
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle) continue;
    if (c === "$" && command[i + 1] === "(") {
      enclosing.push({ inSingle, inDouble, depth: 0 });
      inSingle = false;
      inDouble = false;
      i++;
      continue;
    }
    if (c === "(" && !inDouble && enclosing.length) {
      enclosing.at(-1).depth++;
      continue;
    }
    if (c === ")" && !inDouble && enclosing.length) {
      // `$(( ))` and subshells nest parens inside the substitution: only the `)` that balances the
      // opening `$(` ends it. Restoring on the first one handed the outer quote state back early,
      // and the apostrophe that followed then hid the variable after it.
      if (enclosing.at(-1).depth) enclosing.at(-1).depth--;
      else ({ inSingle, inDouble } = enclosing.pop());
      continue;
    }
    if (c !== "$") continue;

    const rest = command.slice(i + 1);
    const braced = rest.startsWith("{");
    const body = braced ? rest.slice(1) : rest;
    const name = body.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (!name) continue;
    i += name.length + (braced ? 1 : 0);
    if (braced && /^:?[-=?]/.test(body.slice(name.length))) continue;
    found.add(name);
  }
  return [...found].filter((n) => !assigned.has(n) && PROVIDED[n] === undefined);
};
// The section first, then the first bash fence inside it. Anchoring the fence directly to the heading
// made any skill that explained its checks in prose first parse as zero — silently, while --lint still
// counted it as covered. Bounded at the next `## ` so a fence in a later section can't stand in for a
// missing one.
// Scanned line by line, not matched: `## note` is a legal shell comment, and a regex bounded on
// `^## ` truncated the section at the first one — dropping every check after it, silently.
const SECTION_HEADING = "## Deterministic Checks";
const sectionOf = (markdown) => {
  const out = [];
  let inSection = false;
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (!inFence && line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.startsWith(SECTION_HEADING);
      continue;
    }
    if (line.startsWith("```")) inFence = !inFence;
    if (inSection) out.push(line);
  }
  return out.join("\n");
};
const FENCE = /```bash\n([\s\S]*?)```/;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const EXPECT_PREFIX = /^expect:/;
const EXPECT_MANUAL = /^expect: manual$/;
const EXPECT_SHAPE = /^expect: (>=|==|<=)(\d+) on ([^,\s]+(?:,[^,\s]+)*)$/;
const COMPARE = {
  ">=": (count, n) => count >= n,
  "==": (count, n) => count === n,
  "<=": (count, n) => count <= n,
};

export function parseExpect(text) {
  if (EXPECT_MANUAL.test(text)) return { raw: text, manual: true };
  const shape = text.match(EXPECT_SHAPE);
  if (!shape) return { raw: text, error: `malformed expect "${text}"` };
  const ids = shape[3].split(",");
  if (new Set(ids).size !== ids.length) return { raw: text, error: `malformed expect "${text}": repeated id` };
  return { raw: text, op: shape[1], n: Number(shape[2]), ids };
}

const SCENARIOS_HEADING = "## Test Scenarios";
const TABLE_ROW_ID = /^\|\s*([^|]*?)\s*\|/;
const NOT_AN_ID = /^(#|:?-+:?)?$/;

export function scenarioIds(evalsMarkdown) {
  const ids = new Set();
  let inSection = false;
  for (const line of evalsMarkdown.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.startsWith(SCENARIOS_HEADING);
      continue;
    }
    const id = inSection && line.match(TABLE_ROW_ID)?.[1];
    if (id && !NOT_AN_ID.test(id)) ids.add(id);
  }
  return ids;
}

/**
 * Commands in the fence, each labelled by the comment lines directly above it.
 *
 * A fence may open with shell assignments naming the file under test (`OUT=out.html`). Those are
 * setup, not checks: they are collected as a `prelude` and replayed before each command, because
 * every command runs in its own shell and would otherwise see an empty variable.
 */
export function parseChecks(evalsMarkdown) {
  const fence = sectionOf(evalsMarkdown.replace(/\r/g, "")).match(FENCE);
  if (!fence) return { prelude: [], checks: [] };
  const checks = [];
  const prelude = [];
  let label = [];
  let expects = [];
  for (const line of fence[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      const comment = trimmed.replace(/^#\s?/, "");
      if (EXPECT_PREFIX.test(comment)) expects.push(parseExpect(comment));
      else label.push(comment);
      continue;
    }
    if (ASSIGNMENT.test(trimmed)) {
      prelude.push(trimmed);
      continue;
    }
    checks.push({ label: label.join(" ") || "(unlabelled)", command: trimmed, expects });
    label = [];
    expects = [];
  }
  return { prelude, checks };
}

/**
 * Runs one check against `outputFile`.
 * `grep` exits 1 for "no match" — that is a result, not a failure. Only >=2 is a broken command.
 */
export function runCheck({ label, command }, outputFile, prelude = []) {
  // Substitute the `output.md` placeholder only. Substituting a bare `output` too would corrupt any
  // command legitimately containing the word — `grep -c "output format" output.md` became
  // `grep -c ""<path>" format" "<path>"` and returned a wrong count rather than an error.
  const assigned = new Set(prelude.map((a) => a.slice(0, a.indexOf("="))));
  const setup = prelude.map((a) => a.replace(/=.*$/, `=${shellQuote(outputFile)}`)).join("; ");
  // Consume any quotes already around the placeholder — `cat "output.md"` would otherwise become
  // `cat "'/path'"`, a filename that does not exist. A replacement *callback* is required: a plain
  // replacement string interprets `$&` and `$1` in the path itself.
  const substituted = command.replace(/(["']?)\boutput\.md\b\1/g, () => shellQuote(outputFile));

  // An unset variable expands to empty and the check then passes for a reason unrelated to what it
  // measures — green, but meaningless. Report it rather than let it read as runnable.
  const unresolved = unresolvedVars(substituted, assigned);
  if (unresolved.length) {
    return { label, command, ok: false, result: `unset variable(s): ${unresolved.join(", ")}` };
  }

  const cmd = setup ? `${setup}; ${substituted}` : substituted;
  try {
    const env = { ...process.env, ...PROVIDED };
    const stdout = execFileSync(SHELL.cmd, [...SHELL.args, cmd], { encoding: "utf8", env });
    return { label, command, ok: true, result: stdout.trim() };
  } catch (e) {
    const status = e.status ?? 1;
    if (status === 1) return { label, command, ok: true, result: (e.stdout ?? "").trim() || "0" };
    return { label, command, ok: false, result: (e.stderr ?? "").trim() || `exit ${status}` };
  }
}

const skillNames = () =>
  readdirSync(SKILLS_DIR).filter((s) => existsSync(join(SKILLS_DIR, s, "evals.md")));

function report(skill, outputFile) {
  const evalsPath = join(SKILLS_DIR, skill, "evals.md");
  if (!existsSync(evalsPath)) {
    console.error(`No such skill: ${skill}`);
    return 1;
  }
  const { prelude, checks } = parseChecks(readFileSync(evalsPath, "utf8"));
  if (!checks.length) {
    console.log(`${skill}: no Deterministic Checks fence`);
    return 0;
  }
  console.log(`\n${skill}  (${checks.length} checks against ${outputFile})`);
  let broken = 0;
  for (const check of checks) {
    const { ok, label, result } = runCheck(check, outputFile, prelude);
    if (!ok) broken++;
    const shown = result.length > 60 ? `${result.slice(0, 57)}...` : result;
    console.log(`  ${ok ? "·" : "✗"} ${label.slice(0, 58).padEnd(60)} ${shown}`);
  }
  return broken;
}

function expectProblems({ expects }, ids) {
  const seen = new Set();
  const problems = [];
  for (const expect of expects) {
    if (expect.error) problems.push(expect.error);
    for (const id of expect.ids ?? []) {
      if (!ids.has(id)) problems.push(`unknown scenario "${id}" in "${expect.raw}"`);
      if (seen.has(id)) problems.push(`scenario "${id}" named by two expect lines`);
      seen.add(id);
    }
  }
  return problems;
}

const RESPONSE_FILE = "output.md";
const PAGE_LABEL = /^Page:/i;
const INTEGER = /^-?\d+$/;
const LABEL_WIDTH = 100;

const countOf = (result) =>
  INTEGER.test(result) ? Number(result) : result.split("\n").filter((l) => l.trim()).length;

const readsFile = (check, file, skillHasPages) =>
  !skillHasPages || PAGE_LABEL.test(check.label) === (basename(file) !== RESPONSE_FILE);

function gradeScenario(skill, file, id) {
  const evalsPath = join(SKILLS_DIR, skill, "evals.md");
  if (!existsSync(evalsPath)) return usage(`No such skill: ${skill}`);
  if (!existsSync(file)) return usage(`No such output file: ${file}`);
  const evals = readFileSync(evalsPath, "utf8");
  if (!scenarioIds(evals).has(id)) return usage(`No scenario "${id}" in ${skill}/evals.md`);
  const { prelude, checks } = parseChecks(evals);
  const skillHasPages = checks.some((c) => PAGE_LABEL.test(c.label));
  let failed = 0;
  for (const check of checks) {
    const expect = check.expects.find((e) => e.ids?.includes(id));
    if (!expect || !readsFile(check, file, skillHasPages)) continue;
    const { ok, result } = runCheck(check, file, prelude);
    const count = ok ? countOf(result) : "broken";
    const pass = ok && COMPARE[expect.op](count, expect.n);
    if (!pass) failed++;
    if (!ok) console.error(`  ${check.command}\n  ${result}`);
    const label = check.label.length > LABEL_WIDTH ? `${check.label.slice(0, LABEL_WIDTH - 3)}...` : check.label;
    console.log(`${pass ? "PASS" : "FAIL"} ${count} ${expect.op}${expect.n} ${label}`);
  }
  return failed ? EXIT_FAIL : EXIT_PASS;
}

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const USAGE = "usage:\n  run-checks.mjs --lint\n  run-checks.mjs <skill> <output-file>\n  run-checks.mjs <skill> <output-file> --scenario <id>";

function usage(message) {
  console.error(message);
  return EXIT_USAGE;
}

/** Every command in every skill must at least RUN. No fixtures, no expectations — just executable. */
function lint() {
  const scratch = join(mkdtempSync(join(tmpdir(), "gated-delivery-evalcheck-")), "output.md");
  writeFileSync(scratch, "placeholder\n");
  const skills = skillNames();
  let broken = 0;
  let measured = 0;
  let total = 0;
  for (const skill of skills) {
    const evals = readFileSync(join(SKILLS_DIR, skill, "evals.md"), "utf8");
    const { prelude, checks } = parseChecks(evals);
    const ids = scenarioIds(evals);
    if (checks.length) measured++;
    total += checks.length;
    for (const check of checks) {
      for (const problem of expectProblems(check, ids)) {
        broken++;
        console.log(`  BROKEN ${skill}: ${check.command}\n         ${problem}`);
      }
      const outcome = runCheck(check, scratch, prelude);
      if (outcome.ok) continue;
      broken++;
      console.log(`  BROKEN ${skill}: ${outcome.command}\n         ${outcome.result}`);
    }
  }
  const caveat = SHELL.pipelineAware
    ? ""
    : " (no bash: a broken command inside a pipeline cannot be detected here)";
  // Report what was MEASURED, not how many skills were walked: a skill with no fence contributes
  // zero checks, and "all runnable across 10 skills" then reads as coverage that doesn't exist.
  const scope = `${total} checks across ${measured}/${skills.length} skills`;
  console.log(
    broken
      ? `\n${broken} unrunnable check(s) — ${scope}.${caveat}`
      : `All Deterministic Checks are runnable — ${scope}.${caveat}`,
  );
  return broken;
}

// Only act as a CLI when run directly. Without this guard, importing parseChecks/runCheck from a
// test executes the usage branch and exits the test process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const scenarioAt = args.indexOf("--scenario");
  const [arg, outputFile] = args;
  if (scenarioAt !== -1) {
    const id = args[scenarioAt + 1];
    const positional = args.filter((_, i) => i !== scenarioAt && i !== scenarioAt + 1);
    const [skill, file] = positional;
    process.exit(id && positional.length === 2 ? gradeScenario(skill, file, id) : usage(USAGE));
  } else if (arg === "--lint") {
    process.exit(lint() ? 1 : 0);
  } else if (arg && outputFile) {
    if (!existsSync(outputFile)) {
      console.error(`No such output file: ${outputFile}`);
      process.exit(2);
    }
    process.exit(report(arg, outputFile) ? 1 : 0);
  } else {
    process.exit(usage(USAGE));
  }
}
