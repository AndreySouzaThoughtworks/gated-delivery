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
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const SKILLS_DIR = join(process.cwd(), "plugin", "skills");

const evalsPathOf = (skill) => {
  assert(!skill.includes("/"), `a skill is a bare folder name, got ${JSON.stringify(skill)}; pass the skill name, not a path`);
  const path = join(SKILLS_DIR, skill, "evals.md");
  assert(dirname(dirname(path)) === SKILLS_DIR, `skill ${JSON.stringify(skill)} resolves to ${path}; expected an evals.md directly inside one folder of ${SKILLS_DIR}`);
  return path;
};

// `sh -c` reports only the LAST stage of a pipeline, so a broken command anywhere upstream exits 0
// and the check reads as runnable. Several fences are pipelines. `pipefail` fixes it but is not in
// POSIX sh — CI's /bin/sh is dash — so run under bash where available and say so when it isn't.
const TRANSCRIPT_FILE = "transcript.jsonl";
const PLACEHOLDER = /(["']?)\b(output\.md|transcript\.jsonl)\b\1/g;
const TRANSCRIPT_PLACEHOLDER = /\btranscript\.jsonl\b/;

const SHELL = existsSync("/bin/bash")
  ? { cmd: "/bin/bash", args: ["-o", "pipefail", "-c"], pipelineAware: true }
  : { cmd: "sh", args: ["-c"], pipelineAware: false };

// Variables the runner supplies, so fences can refer to the repo under test. Documented contract:
// a fence may use "$WORKTREE" without assigning it. Anything else must be assigned in the fence.
const PROVIDED = { WORKTREE: process.cwd() };
const SHELL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * POSIX shell quoting. `JSON.stringify` is JSON encoding, not shell quoting: it wraps in double
 * quotes, inside which `$(...)`, backticks and `$VAR` still expand — a path containing `$(id -u)`
 * was executed rather than read. Single quotes suppress all expansion; an embedded single quote is
 * closed, escaped, and reopened.
 */
const SINGLE_QUOTE = "'";
const ESCAPED_SINGLE_QUOTE = "'\\''";
const shellQuote = (s) => {
  const quoted = `${SINGLE_QUOTE}${String(s).replaceAll(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}${SINGLE_QUOTE}`;
  assert(quoted.length >= 2 && quoted.startsWith(SINGLE_QUOTE) && quoted.endsWith(SINGLE_QUOTE), `shellQuote(${JSON.stringify(s)}) gave ${quoted}; expected the value wrapped in single quotes`);
  assert(!quoted.slice(1, -1).replaceAll(ESCAPED_SINGLE_QUOTE, "").includes(SINGLE_QUOTE), `shellQuote(${JSON.stringify(s)}) left a bare single quote in ${quoted}; expected each one closed, escaped and reopened`);
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
  assert(!(quote.inSingle && quote.inDouble), `toggleQuote got inSingle ${JSON.stringify(quote.inSingle)} and inDouble ${JSON.stringify(quote.inDouble)}; expected at most one of them true`);
  let toggled = true;
  if (c === "'" && !quote.inDouble) quote.inSingle = !quote.inSingle;
  else if (c === '"' && !quote.inSingle) quote.inDouble = !quote.inDouble;
  else toggled = false;
  assert(!(quote.inSingle && quote.inDouble), `toggleQuote on ${c} left single and double quotes open at once; expected at most one`);
  return toggled;
};

const trackParen = (enclosing, quote, c) => {
  assert(c.length === 1, `trackParen got ${JSON.stringify(c)}; expected one character`);
  assert(enclosing.every((substitution) => substitution.depth >= 0), "trackParen found a substitution with negative paren depth; expected 0 or more");
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
  return true;
};

const variableAt = (command, at) => {
  assert(command[at] === "$", `variableAt expected a $ at ${at}, found ${JSON.stringify(command[at])}`);
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
  assert(variable.length >= variable.name.length, `variableAt read ${variable.name} but consumed only ${variable.length}; expected the whole name`);
  return variable;
};

const unresolvedVars = (command, assigned) => {
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
      enclosing.push({ inSingle: quote.inSingle, inDouble: quote.inDouble, depth: 0 });
      quote.inSingle = false;
      quote.inDouble = false;
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
  assert(unresolved.every((name) => SHELL_IDENTIFIER.test(name)), `unresolvedVars reported ${unresolved.join(", ")}; expected only shell variable names`);
  assert(unresolved.every((name) => !assigned.has(name) && PROVIDED[name] === undefined), `unresolvedVars reported a variable that is assigned or provided: ${unresolved.join(", ")}`);
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
  assert(!markdown.includes("\r"), "sectionOf got a carriage return; expected line endings normalised to \\n first");
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
  assert(out.length === 0 || markdown.includes(SECTION_HEADING), `sectionOf returned ${out.length} lines without a "${SECTION_HEADING}" heading in the text; expected none`);
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
  const shape = text.match(EXPECT_SHAPE);
  const ids = shape?.[3].split(",");
  let expect;
  if (EXPECT_MANUAL.test(text)) expect = { raw: text, manual: true };
  else if (!shape) expect = { raw: text, error: `malformed expect "${text}"` };
  else if (new Set(ids).size !== ids.length) expect = { raw: text, error: `malformed expect "${text}": repeated id` };
  else expect = { raw: text, op: shape[1], n: Number(shape[2]), ids };
  assert(expect.raw === text, `parseExpect returned raw ${JSON.stringify(expect.raw)} for ${JSON.stringify(text)}; expected the input kept verbatim`);
  assert(expect.manual || expect.error !== undefined || (Object.hasOwn(COMPARE, expect.op) && expect.ids.length > 0), `parseExpect(${JSON.stringify(text)}) is neither manual, an error nor a comparison with ids; expected exactly one`);
  return expect;
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
  assert([...ids].every((id) => id === id.trim() && !NOT_AN_ID.test(id)), `scenarioIds returned ${JSON.stringify([...ids])}; expected trimmed ids with no header or separator cells`);
  assert(!ids.has(""), "scenarioIds returned an empty id; expected only named scenarios");
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
  assert(checks.every((check) => !check.command.startsWith("#") && !ASSIGNMENT.test(check.command)), "parseChecks kept a comment or an assignment as a check; expected only commands");
  assert(prelude.every((assignment) => ASSIGNMENT.test(assignment)), "parseChecks kept a non-assignment in the prelude; expected only NAME=value lines");
  return { prelude, checks };
}

/**
 * Runs one check against `outputFile`.
 * `grep` exits 1 for "no match" — that is a result, not a failure. Only >=2 is a broken command.
 */
export function runCheck({ label, command }, outputFile, prelude = []) {
  assert(command.trim() !== "", `runCheck "${label}" got a blank command; expected a shell command`);
  assert(outputFile !== "", `runCheck "${label}" got an empty output file; expected the path being graded`);
  // Substitute the `output.md` placeholder only. Substituting a bare `output` too would corrupt any
  // command legitimately containing the word — `grep -c "output format" output.md` became
  // `grep -c ""<path>" format" "<path>"` and returned a wrong count rather than an error.
  const assigned = new Set(prelude.map((a) => a.slice(0, a.indexOf("="))));
  // Consume any quotes already around the placeholder — `cat "output.md"` would otherwise become
  // `cat "'/path'"`, a filename that does not exist. A replacement *callback* is required: a plain
  // replacement string interprets `$&` and `$1` in the path itself.
  const transcriptFile = join(dirname(outputFile), TRANSCRIPT_FILE);
  const substituted = command.replace(PLACEHOLDER, (_, __, name) => shellQuote(name === TRANSCRIPT_FILE ? transcriptFile : outputFile));

  // An unset variable expands to empty and the check then passes for a reason unrelated to what it
  // measures — green, but meaningless. Report it rather than let it read as runnable.
  const unresolved = unresolvedVars(substituted, assigned);
  let outcome;
  if (unresolved.length) {
    outcome = { label, command, ok: false, result: `unset variable(s): ${unresolved.join(", ")}` };
  } else if (TRANSCRIPT_PLACEHOLDER.test(command) && !existsSync(transcriptFile)) {
    outcome = { label, command, ok: false, result: `no ${TRANSCRIPT_FILE} beside ${outputFile}` };
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
  assert(outcome.ok || outcome.result !== "", `runCheck "${label}" failed with an empty result; expected a reason`);
  return outcome;
}

function report(skill, outputFile) {
  assert(outputFile !== "", `report(${skill}) got an empty output file; expected the path being graded`);
  const evalsPath = evalsPathOf(skill);
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
  assert(broken <= checks.length, `report(${skill}) counted ${broken} broken of ${checks.length} checks; expected no more than the checks run`);
  return broken;
}

function expectProblems({ expects }, ids) {
  assert(expects.every((expect) => expect.raw !== ""), `expectProblems got an expect line with blank text; expected every parsed line to keep its raw text`);
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
  assert(problems.every((problem) => problem !== ""), `expectProblems produced a blank problem in ${JSON.stringify(problems)}; expected each problem to say what is wrong`);
  return problems;
}

const RESPONSE_FILE = "output.md";
const PAGE_LABEL = /^Page:/i;
const INTEGER = /^-?\d+$/;
const LABEL_WIDTH = 100;

const gradeCheck = (check, expect, file, prelude) => {
  assert(Object.hasOwn(COMPARE, expect.op), `gradeCheck got operator ${JSON.stringify(expect.op)} for "${check.label}"; expected one of ${Object.keys(COMPARE).join(" ")}`);
  assert(file !== "", `gradeCheck "${check.label}" got an empty file; expected the path being graded`);
  const { ok, result } = runCheck(check, file, prelude);
  const count = ok ? (INTEGER.test(result) ? Number(result) : result.split("\n").filter((l) => l.trim()).length) : "broken";
  const pass = ok && COMPARE[expect.op](count, expect.n);
  if (!ok) console.error(`  ${check.command}\n  ${result}`);
  const label = check.label.length > LABEL_WIDTH ? `${check.label.slice(0, LABEL_WIDTH - 3)}...` : check.label;
  console.log(`${pass ? "PASS" : "FAIL"} ${count} ${expect.op}${expect.n} ${label}`);
  return pass;
};

function gradeScenario(skill, file, id) {
  assert(id !== "", `gradeScenario(${skill}) got an empty scenario id; expected one from the scenario table`);
  const evalsPath = evalsPathOf(skill);
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
  assert(failed <= checks.length, `gradeScenario(${skill}) counted ${failed} failures from ${checks.length} checks; expected no more than the checks run`);
  return failed ? EXIT_FAIL : EXIT_PASS;
}

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const EXIT_HARNESS_ERROR = 3;
const SKILL_NAME = /^[^./\\][^/\\]*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const LINE_BREAK = /\r?\n|\r/g;
const USAGE = [
  "usage:",
  "  run-checks.mjs --lint",
  "  run-checks.mjs <skill> <output-file>",
  "  run-checks.mjs <skill> <output-file> --scenario <id>",
  "exit codes: 0 every check held, 1 a check failed or the skill is unknown, 2 usage error, 3 harness error (an internal check or file read failed)",
].join("\n");

function usage(message) {
  assert(message !== "", `usage got ${JSON.stringify(message)}; expected what went wrong or the usage text`);
  const printable = message.replace(LINE_BREAK, "\\n").replace(CONTROL_CHARACTERS, "?");
  assert(printable.search(LINE_BREAK) === -1, `usage would print a line break from ${JSON.stringify(message)}; expected one line so input cannot forge log lines`);
  assert(printable.search(CONTROL_CHARACTERS) === -1, `usage would print a control character from ${JSON.stringify(message)}; expected each replaced`);
  console.error(printable);
  return EXIT_USAGE;
}

/** Every command in every skill must at least RUN. No fixtures, no expectations — just executable. */
function lint() {
  const scratch = join(mkdtempSync(join(tmpdir(), "gated-delivery-evalcheck-")), "output.md");
  writeFileSync(scratch, "placeholder\n");
  writeFileSync(join(dirname(scratch), TRANSCRIPT_FILE), "");
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
  assert(measured <= skills.length, `lint measured ${measured} skills out of ${skills.length}; expected no more than were walked`);
  assert(total >= measured, `lint counted ${total} checks across ${measured} measured skills; expected at least one check each`);
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
  const scenarioMode = scenarioAt !== -1;
  const positional = args.filter((_, i) => i !== scenarioAt && i !== scenarioAt + 1);
  const [skill, file] = scenarioMode ? positional : [arg, outputFile];
  let exitCode;
  try {
    const id = args[scenarioAt + 1];
    const wellFormed = scenarioMode ? Boolean(id) && positional.length === 2 : Boolean(arg && outputFile);
    const lintMode = !scenarioMode && arg === "--lint";
    if (lintMode) exitCode = lint() ? EXIT_FAIL : EXIT_PASS;
    else if (!wellFormed) exitCode = usage(USAGE);
    else if (!SKILL_NAME.test(skill)) exitCode = usage(`Not a skill name: ${skill}; pass the folder name under plugin/skills, not a path`);
    else if (scenarioMode) exitCode = gradeScenario(skill, file, id);
    else if (!existsSync(file)) exitCode = usage(`No such output file: ${file}`);
    else exitCode = report(skill, file) ? EXIT_FAIL : EXIT_PASS;
  } catch (error) {
    console.error(error);
    exitCode = EXIT_HARNESS_ERROR;
  }
  process.exit(exitCode);
}
