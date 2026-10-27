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

import assert from "node:assert";
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
const shellQuote = (s) => {
  assert(!String(s).includes("\0"), `a shell argument cannot carry a NUL byte, got ${JSON.stringify(s)}`);
  const quoted = `'${String(s).replaceAll("'", `'\\''`)}'`;
  assert(quoted.slice(1, -1).replaceAll(`'\\''`, "'") === String(s), `quoting must round-trip ${JSON.stringify(s)}, got ${quoted}`);
  return quoted;
};

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
const toggleQuote = (quote, c) => {
  assert(c.length === 1 && !(quote.inSingle && quote.inDouble), `toggleQuote reads one character outside a double-open state, got ${JSON.stringify(c)} with ${JSON.stringify(quote)}`);
  let toggled = true;
  if (c === "'" && !quote.inDouble) quote.inSingle = !quote.inSingle;
  else if (c === '"' && !quote.inSingle) quote.inDouble = !quote.inDouble;
  else toggled = false;
  assert(!(quote.inSingle && quote.inDouble), `a character cannot open both quote kinds, got ${JSON.stringify(quote)} after ${JSON.stringify(c)}`);
  return toggled;
};

const enterSubstitution = (enclosing, quote) => {
  assert(!quote.inSingle, `a substitution cannot open inside single quotes, got ${JSON.stringify(quote)}`);
  enclosing.push({ inSingle: quote.inSingle, inDouble: quote.inDouble, depth: 0 });
  quote.inSingle = false;
  quote.inDouble = false;
  assert(enclosing.at(-1).depth === 0 && !quote.inDouble, `a new substitution starts unquoted at paren depth zero, got ${JSON.stringify(enclosing.at(-1))}`);
};

const trackParen = (enclosing, quote, c) => {
  assert(c.length === 1 && !(quote.inSingle && quote.inDouble), `trackParen reads one character outside a double-open state, got ${JSON.stringify(c)} with ${JSON.stringify(quote)}`);
  assert(enclosing.every((level) => level.depth >= 0), `paren depth never goes negative, got ${JSON.stringify(enclosing)}`);
  const substitution = enclosing.at(-1);
  const consumes = Boolean(substitution) && !quote.inDouble && (c === "(" || c === ")");
  if (!consumes) return false;
  if (c === "(") substitution.depth++;
  // `$(( ))` and subshells nest parens inside the substitution: only the `)` that balances the
  // opening `$(` ends it. Restoring on the first one handed the outer quote state back early,
  // and the apostrophe that followed then hid the variable after it.
  else if (substitution.depth) substitution.depth--;
  else {
    const { inSingle, inDouble } = enclosing.pop();
    quote.inSingle = inSingle;
    quote.inDouble = inDouble;
  }
  assert(enclosing.every((level) => level.depth >= 0), `paren depth never goes negative, got ${JSON.stringify(enclosing)}`);
  return true;
};

const variableAt = (command, at) => {
  assert(command[at] === "$", `variableAt starts at a dollar sign, got ${JSON.stringify(command[at])} at ${at}`);
  const rest = command.slice(at + 1);
  const braced = rest.startsWith("{");
  const body = braced ? rest.slice(1) : rest;
  const name = body.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  if (!name) return null;
  const variable = {
    name,
    length: name.length + (braced ? 1 : 0),
    hasFallback: braced && /^:?[-=?]/.test(body.slice(name.length)),
  };
  assert(command.startsWith(name, at + 1 + variable.length - name.length), `the variable ${name} must sit right after the dollar at ${at}, got ${JSON.stringify(command)}`);
  return variable;
};

const unresolvedVars = (command, assigned) => {
  assert(!command.includes("\0"), `a command cannot carry a NUL byte, got ${JSON.stringify(command)}`);
  assert([...assigned].every((name) => !name.includes("=")), `assigned holds bare names, got ${JSON.stringify([...assigned])}`);
  const found = new Set();
  const enclosing = [];
  const quote = { inSingle: false, inDouble: false };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "\\" && !quote.inSingle) {
      i++;
      continue;
    }
    if (toggleQuote(quote, c)) continue;
    if (quote.inSingle) continue;
    if (c === "$" && command[i + 1] === "(") {
      enterSubstitution(enclosing, quote);
      i++;
      continue;
    }
    if (trackParen(enclosing, quote, c)) continue;
    if (c !== "$") continue;

    const variable = variableAt(command, i);
    if (!variable) continue;
    i += variable.length;
    if (!variable.hasFallback) found.add(variable.name);
  }
  const unresolved = [...found].filter((n) => !assigned.has(n) && PROVIDED[n] === undefined);
  assert(unresolved.every((n) => !assigned.has(n)), `an assigned name is never unresolved, got ${JSON.stringify(unresolved)}`);
  return unresolved;
};
// The section first, then the first bash fence inside it. Anchoring the fence directly to the heading
// made any skill that explained its checks in prose first parse as zero — silently, while --lint still
// counted it as covered. Bounded at the next `## ` so a fence in a later section can't stand in for a
// missing one.
// Scanned line by line, not matched: `## note` is a legal shell comment, and a regex bounded on
// `^## ` truncated the section at the first one — dropping every check after it, silently.
const SECTION_HEADING = "## Deterministic Checks";
const sectionOf = (markdown) => {
  assert(!markdown.includes("\r"), "sectionOf needs carriage-return-free markdown; strip them before calling");
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
  const section = out.join("\n");
  assert(out.length <= markdown.split("\n").length, `a section cannot hold more lines than the document, got ${out.length}`);
  return section;
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
  assert(EXPECT_PREFIX.test(text), `an expect line starts with "expect:", got ${JSON.stringify(text)}`);
  const shape = text.match(EXPECT_SHAPE);
  const ids = shape?.[3].split(",");
  let expect;
  if (EXPECT_MANUAL.test(text)) expect = { raw: text, manual: true };
  else if (!shape) expect = { raw: text, error: `malformed expect "${text}"` };
  else if (new Set(ids).size !== ids.length) expect = { raw: text, error: `malformed expect "${text}": repeated id` };
  else expect = { raw: text, op: shape[1], n: Number(shape[2]), ids };
  assert(expect.raw === text && [expect.manual, expect.error, expect.op].filter(Boolean).length === 1, `an expect is exactly one of manual, error or comparison, got ${JSON.stringify(expect)}`);
  return expect;
}

const SCENARIOS_HEADING = "## Test Scenarios";
const TABLE_ROW_ID = /^\|\s*([^|]*?)\s*\|/;
const NOT_AN_ID = /^(#|:?-+:?)?$/;

export function scenarioIds(evalsMarkdown) {
  assert(!evalsMarkdown.includes("\0"), "evals markdown cannot carry a NUL byte; check the file is text");
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
  assert([...ids].every((id) => id.length > 0 && !id.includes("|")), `a scenario id is a bare cell value, got ${JSON.stringify([...ids])}`);
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
  assert(!evalsMarkdown.includes("\0"), "evals markdown cannot carry a NUL byte; check the file is text");
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
  assert(prelude.every((line) => ASSIGNMENT.test(line)) && checks.every((c) => c.command && !ASSIGNMENT.test(c.command)), `setup lines are assignments and checks are commands, got ${JSON.stringify({ prelude, checks })}`);
  return { prelude, checks };
}

/**
 * Runs one check against `outputFile`.
 * `grep` exits 1 for "no match" — that is a result, not a failure. Only >=2 is a broken command.
 */
export function runCheck({ label, command }, outputFile, prelude = []) {
  assert(command.trim().length > 0 && outputFile.length > 0, `a check needs a command and an output file, got ${JSON.stringify({ command, outputFile })}`);
  assert(prelude.every((line) => ASSIGNMENT.test(line)), `prelude lines must be assignments, got ${JSON.stringify(prelude)}`);
  // Substitute the `output.md` placeholder only. Substituting a bare `output` too would corrupt any
  // command legitimately containing the word — `grep -c "output format" output.md` became
  // `grep -c ""<path>" format" "<path>"` and returned a wrong count rather than an error.
  const assigned = new Set(prelude.map((a) => a.slice(0, a.indexOf("="))));
  // Consume any quotes already around the placeholder — `cat "output.md"` would otherwise become
  // `cat "'/path'"`, a filename that does not exist. A replacement *callback* is required: a plain
  // replacement string interprets `$&` and `$1` in the path itself.
  const substituted = command.replace(/(["']?)\boutput\.md\b\1/g, () => shellQuote(outputFile));

  // An unset variable expands to empty and the check then passes for a reason unrelated to what it
  // measures — green, but meaningless. Report it rather than let it read as runnable.
  const unresolved = unresolvedVars(substituted, assigned);
  let outcome;
  if (unresolved.length) {
    outcome = { label, command, ok: false, result: `unset variable(s): ${unresolved.join(", ")}` };
  } else {
    try {
      const setup = prelude.map((a) => a.replace(/=.*$/, `=${shellQuote(outputFile)}`)).join("; ");
      const cmd = setup ? `${setup}; ${substituted}` : substituted;
      const env = { ...process.env, ...PROVIDED };
      const stdout = execFileSync(SHELL.cmd, [...SHELL.args, cmd], { encoding: "utf8", env });
      outcome = { label, command, ok: true, result: stdout.trim() };
    } catch (e) {
      const status = e.status ?? 1;
      if (status === 1) outcome = { label, command, ok: true, result: (e.stdout ?? "").trim() || "0" };
      else outcome = { label, command, ok: false, result: (e.stderr ?? "").trim() || `exit ${status}` };
    }
  }
  assert(outcome.ok || outcome.result.length > 0, `a failed check must say why, got ${JSON.stringify(outcome)}`);
  return outcome;
}

function report(skill, outputFile) {
  assert(!skill.includes("/") && existsSync(outputFile), `report needs a bare skill name and an existing output file, got ${JSON.stringify({ skill, outputFile })}`);
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
  assert(broken <= checks.length, `broken checks cannot exceed the checks run, got ${broken} of ${checks.length}`);
  return broken;
}

function expectProblems({ expects }, ids) {
  assert(expects.every((expect) => expect.raw !== undefined), `every expect keeps its raw line, got ${JSON.stringify(expects)}`);
  assert([...ids].every((id) => id.length > 0), `scenario ids are not blank, got ${JSON.stringify([...ids])}`);
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
  assert(problems.every((problem) => problem.length > 0), `every problem says what is wrong, got ${JSON.stringify(problems)}`);
  return problems;
}

const RESPONSE_FILE = "output.md";
const PAGE_LABEL = /^Page:/i;
const INTEGER = /^-?\d+$/;
const LABEL_WIDTH = 100;

const countOf = (result) => {
  assert(result === result.trim(), `a check result arrives trimmed, got ${JSON.stringify(result)}`);
  const count = INTEGER.test(result) ? Number(result) : result.split("\n").filter((l) => l.trim()).length;
  assert(Number.isInteger(count), `a check count is an integer, got ${JSON.stringify(count)} for ${JSON.stringify(result)}`);
  return count;
};

const gradeCheck = (check, expect, file, prelude) => {
  assert(Object.hasOwn(COMPARE, expect.op) && check.label.length > 0, `a graded check has a known operator and a label, got ${JSON.stringify({ op: expect.op, label: check.label })}`);
  const { ok, result } = runCheck(check, file, prelude);
  const count = ok ? countOf(result) : "broken";
  const pass = ok && COMPARE[expect.op](count, expect.n);
  if (!ok) console.error(`  ${check.command}\n  ${result}`);
  const label = check.label.length > LABEL_WIDTH ? `${check.label.slice(0, LABEL_WIDTH - 3)}...` : check.label;
  console.log(`${pass ? "PASS" : "FAIL"} ${count} ${expect.op}${expect.n} ${label}`);
  assert(!pass || ok, `a passing check must have run, got ok ${ok} for ${check.command}`);
  return pass;
};

function gradeScenario(skill, file, id) {
  assert(!skill.includes("/") && id.length > 0, `gradeScenario needs a bare skill name and a scenario id, got ${JSON.stringify({ skill, id })}`);
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
    if (!expect || (skillHasPages && PAGE_LABEL.test(check.label) !== (basename(file) !== RESPONSE_FILE))) continue;
    if (!gradeCheck(check, expect, file, prelude)) failed++;
  }
  assert(failed <= checks.length, `failed checks cannot exceed the checks run, got ${failed} of ${checks.length}`);
  return failed ? EXIT_FAIL : EXIT_PASS;
}

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const LINE_BREAK = /\r?\n|\r/g;
const USAGE = "usage:\n  run-checks.mjs --lint\n  run-checks.mjs <skill> <output-file>\n  run-checks.mjs <skill> <output-file> --scenario <id>";

function usage(message) {
  assert(message.length > 0, `a usage error needs a message saying what to fix, got ${message.length} characters`);
  const neutral = message.replace(LINE_BREAK, "\\n").replace(CONTROL_CHARACTERS, "?");
  assert(!/[\r\n]/.test(neutral), `a neutralised message holds no line break, got ${JSON.stringify(neutral)}`);
  console.error(neutral);
  return EXIT_USAGE;
}

/** Every command in every skill must at least RUN. No fixtures, no expectations — just executable. */
function lint() {
  const scratch = join(mkdtempSync(join(tmpdir(), "gated-delivery-evalcheck-")), "output.md");
  writeFileSync(scratch, "placeholder\n");
  assert(existsSync(SKILLS_DIR), `skills are read from ${SKILLS_DIR}; run from the repository root`);
  const skills = readdirSync(SKILLS_DIR).filter((s) => existsSync(join(SKILLS_DIR, s, "evals.md")));
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
  assert(measured <= skills.length && broken >= 0, `measured skills cannot exceed listed skills, got ${measured} of ${skills.length} with ${broken} broken`);
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
