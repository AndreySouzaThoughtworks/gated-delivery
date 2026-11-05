#!/usr/bin/env node
// Executes the `## Deterministic Checks` fence from a skill's evals.md.
//
// Until now nothing ran those fences — they were documentation. Every measure defect this repo has
// shipped (a `\|` that matches a literal pipe, a key that also names a heading) was invisible
// precisely because no command was ever executed.
//
//   node scripts/eval/run-checks.ts --lint                           every skill: prove each command RUNS
//   node scripts/eval/run-checks.ts --lint <skill>                   the same for one skill
//   node scripts/eval/run-checks.ts <skill> <file>                   one skill: report each command's result
//   node scripts/eval/run-checks.ts <skill> <file> --scenario <id>   grade the checks whose `# expect:` names <id>

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type Quote = { inSingle: boolean; inDouble: boolean };
type Substitution = Quote & { depth: number };
type Expect = { raw: string; manual?: true; error?: string; op?: string; n?: number; ids?: string[] };
type Check = { label: string; command: string; expects: Expect[] };
type Outcome = { label: string; command: string; ok: boolean; result: string };
type ExecFailure = { status?: number; stdout?: string; stderr?: string };

const SKILLS_DIR = join(process.cwd(), "plugin", "skills");

const evalsPathOf = (skill: string) => { // zanity: ignore[assertion-density] -- multi-caller-helper: report and gradeScenario run only after main proved the skill name with SKILL_NAME
  const path = join(SKILLS_DIR, skill, "evals.md");
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
const PROVIDED: Record<string, string> = { WORKTREE: process.cwd() };

/**
 * POSIX shell quoting. `JSON.stringify` is JSON encoding, not shell quoting: it wraps in double
 * quotes, inside which `$(...)`, backticks and `$VAR` still expand — a path containing `$(id -u)`
 * was executed rather than read. Single quotes suppress all expansion; an embedded single quote is
 * closed, escaped, and reopened.
 */
const SINGLE_QUOTE = "'";
const ESCAPED_SINGLE_QUOTE = "'\\''";
const shellQuote = (s: string) => { // zanity: ignore[assertion-density] -- single-invariant: the NUL byte check is the only outside data risk and a second assertion would restate the quoting
  assert(!String(s).includes("\0"), `a shell argument cannot carry a NUL byte, got ${JSON.stringify(s)}`);
  const quoted = `${SINGLE_QUOTE}${String(s).replaceAll(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}${SINGLE_QUOTE}`;
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
const toggleQuote = (quote: Quote, c: string) => { // zanity: ignore[assertion-density] -- limit-bound: inlining into unresolvedVars would breach the complexity limit and the caller passes one character from the scanned command
  let toggled = true;
  if (c === "'" && !quote.inDouble) quote.inSingle = !quote.inSingle;
  else if (c === '"' && !quote.inSingle) quote.inDouble = !quote.inDouble;
  else toggled = false;
  return toggled;
};

const trackParen = (enclosing: Substitution[], quote: Quote, c: string) => { // zanity: ignore[assertion-density] -- limit-bound: inlining into unresolvedVars would breach the complexity limit and the depth guard keeps the substitution state valid
  const substitution = enclosing.at(-1);
  if (!substitution || quote.inDouble || (c !== "(" && c !== ")")) return false;
  if (c === "(") substitution.depth++;
  // `$(( ))` and subshells nest parens inside the substitution: only the `)` that balances the
  // opening `$(` ends it. Restoring on the first one handed the outer quote state back early,
  // and the apostrophe that followed then hid the variable after it.
  else if (substitution.depth) substitution.depth--;
  else {
    enclosing.pop();
    quote.inSingle = substitution.inSingle;
    quote.inDouble = substitution.inDouble;
  }
  return true;
};

const variableAt = (command: string, at: number) => { // zanity: ignore[assertion-density] -- limit-bound: inlining into unresolvedVars would breach the complexity limit and the caller passes only the index of a dollar sign
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
  return variable;
};

const unresolvedVars = (command: string, assigned: Set<string>) => { // zanity: ignore[assertion-density] -- no-invariant: the scan reads any command text and filters a set it built, so no outside data can break a postcondition
  const found = new Set<string>();
  const enclosing: Substitution[] = [];
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
  return unresolved;
};
// The section first, then the first bash fence inside it. Anchoring the fence directly to the heading
// made any skill that explained its checks in prose first parse as zero — silently, while --lint still
// counted it as covered. Bounded at the next `## ` so a fence in a later section can't stand in for a
// missing one.
// Scanned line by line, not matched: `## note` is a legal shell comment, and a regex bounded on
// `^## ` truncated the section at the first one — dropping every check after it, silently.
const SECTION_HEADING = "## Deterministic Checks";
const FENCE = /```bash\n([\s\S]*?)```/;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const EXPECT_PREFIX = /^expect:/;
const EXPECT_MANUAL = /^expect: manual$/;
const EXPECT_SHAPE = /^expect: (>=|==|<=)(\d+) on ([^,\s]+(?:,[^,\s]+)*)$/;
const COMPARE: Record<string, (count: number, n: number) => boolean> = {
  ">=": (count: number, n: number) => count >= n,
  "==": (count: number, n: number) => count === n,
  "<=": (count: number, n: number) => count <= n,
};

export function parseExpect(text: string): Expect { // zanity: ignore[assertion-density] -- single-invariant: the one-line check is the only outside data risk and the branches below it are exhaustive by construction
  assert(!text.includes("\n"), `an expect is one line, got ${JSON.stringify(text)}`);
  const shape = text.match(EXPECT_SHAPE);
  const ids = shape?.[3].split(",") ?? [];
  let expect: Expect;
  if (EXPECT_MANUAL.test(text)) expect = { raw: text, manual: true };
  else if (!shape) expect = { raw: text, error: `malformed expect "${text}"` };
  else if (new Set(ids).size !== ids.length) expect = { raw: text, error: `malformed expect "${text}": repeated id` };
  else expect = { raw: text, op: shape[1], n: Number(shape[2]), ids };
  return expect;
}

const SCENARIOS_HEADING = "## Test Scenarios";
const TABLE_ROW_ID = /^\|\s*([^|]*?)\s*\|/;
const NOT_AN_ID = /^(#|:?-+:?)?$/;

export function scenarioIds(evalsMarkdown: string) { // zanity: ignore[assertion-density] -- no-invariant: markdown text is typed and every id reaches the set only after the non-empty cell filter
  const ids = new Set<string>();
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
export function parseChecks(evalsMarkdown: string): { prelude: string[]; checks: Check[] } { // zanity: ignore[assertion-density] -- no-invariant: markdown text is typed and each line lands in exactly one of prelude, label or checks
  const sectionLines: string[] = [];
  let inSection = false;
  let inFence = false;
  for (const line of evalsMarkdown.replace(/\r/g, "").split("\n")) {
    if (!inFence && line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.startsWith(SECTION_HEADING);
      continue;
    }
    if (line.startsWith("```")) inFence = !inFence;
    if (inSection) sectionLines.push(line);
  }
  const fence = sectionLines.join("\n").match(FENCE);
  if (!fence) return { prelude: [], checks: [] };
  const checks: Check[] = [];
  const prelude: string[] = [];
  let label: string[] = [];
  let expects: Expect[] = [];
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
export function runCheck({ label, command }: Pick<Check, "label" | "command">, outputFile: string, prelude: string[] = []): Outcome {
  assert(outputFile, `a check runs against an output file, got ${JSON.stringify(outputFile)}`);
  assert(prelude.every((assignment) => ASSIGNMENT.test(assignment)), `the prelude holds assignments only, got ${JSON.stringify(prelude)}`);
  // Substitute the `output.md` placeholder only. Substituting a bare `output` too would corrupt any
  // command legitimately containing the word — `grep -c "output format" output.md` became
  // `grep -c ""<path>" format" "<path>"` and returned a wrong count rather than an error.
  const assigned = new Set(prelude.map((a: string) => a.slice(0, a.indexOf("="))));
  // Consume any quotes already around the placeholder — `cat "output.md"` would otherwise become
  // `cat "'/path'"`, a filename that does not exist. A replacement *callback* is required: a plain
  // replacement string interprets `$&` and `$1` in the path itself.
  const transcriptFile = join(dirname(outputFile), TRANSCRIPT_FILE);
  const substituted = command.replace(PLACEHOLDER, (_: string, __: string, name: string) => shellQuote(name === TRANSCRIPT_FILE ? transcriptFile : outputFile));

  // An unset variable expands to empty and the check then passes for a reason unrelated to what it
  // measures — green, but meaningless. Report it rather than let it read as runnable.
  const unresolved = unresolvedVars(substituted, assigned);
  let outcome: Outcome;
  if (unresolved.length) {
    outcome = { label, command, ok: false, result: `unset variable(s): ${unresolved.join(", ")}` };
  } else if (TRANSCRIPT_PLACEHOLDER.test(command) && !existsSync(transcriptFile)) {
    outcome = { label, command, ok: false, result: `no ${TRANSCRIPT_FILE} beside ${outputFile}` };
  } else {
    try {
      const setup = prelude.map((a: string) => a.replace(/=.*$/, `=${shellQuote(outputFile)}`)).join("; ");
      const cmd = setup ? `${setup}; ${substituted}` : substituted;
      const env = { ...process.env, ...PROVIDED };
      const stdout = execFileSync(SHELL.cmd, [...SHELL.args, cmd], { encoding: "utf8", env });
      outcome = { label, command, ok: true, result: stdout.trim() };
    } catch (e) {
      const failure = e as ExecFailure;
      const status = failure.status ?? 1;
      if (status === 1) outcome = { label, command, ok: true, result: (failure.stdout ?? "").trim() || "0" };
      else outcome = { label, command, ok: false, result: (failure.stderr ?? "").trim() || `exit ${status}` };
    }
  }
  return outcome;
}

function report(skill: string, outputFile: string) { // zanity: ignore[assertion-density] -- entry-point: the skill mode handler runs only after main checked the skill name and the output file exists
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
  return broken;
}

function expectProblems({ expects }: Check, ids: Set<string>) { // zanity: ignore[assertion-density] -- limit-bound: inlining into lint would breach the nesting limit and the problems come from the parsed expects alone
  const seen = new Set();
  const problems: string[] = [];
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

const gradeCheck = (check: Check, expect: Expect, file: string, prelude: string[]) => { // zanity: ignore[assertion-density] -- single-invariant: the integer check guards a count that parseExpect can overflow and a second assertion would restate it
  assert(Number.isInteger(expect.n), `a comparison expect carries an integer, got ${JSON.stringify(expect)}`);
  const { ok, result } = runCheck(check, file, prelude);
  const count = ok ? (INTEGER.test(result) ? Number(result) : result.split("\n").filter((l: string) => l.trim()).length) : "broken";
  const pass = ok && typeof count === "number" && COMPARE[expect.op!](count, expect.n!);
  if (!ok) console.error(`  ${check.command}\n  ${result}`);
  const label = check.label.length > LABEL_WIDTH ? `${check.label.slice(0, LABEL_WIDTH - 3)}...` : check.label;
  console.log(`${pass ? "PASS" : "FAIL"} ${count} ${expect.op}${expect.n} ${label}`);
  return pass;
};

function gradeScenario(skill: string, file: string, id: string) { // zanity: ignore[assertion-density] -- entry-point: the scenario mode handler runs only after main proved the id and both paths are present
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
  "  run-checks.ts --lint [skill]",
  "  run-checks.ts <skill> <output-file>",
  "  run-checks.ts <skill> <output-file> --scenario <id>",
  "exit codes: 0 every check held, 1 a check failed or the skill is unknown, 2 usage error, 3 harness error (an internal check or file read failed)",
].join("\n");

function usage(message: string) { // zanity: ignore[assertion-density] -- no-invariant: every caller passes a fixed or interpolated message and the printable form is built by the replace calls
  const printable = message.replace(LINE_BREAK, "\\n").replace(CONTROL_CHARACTERS, "?");
  console.error(printable);
  return EXIT_USAGE;
}

/** Every command in every skill must at least RUN. No fixtures, no expectations — just executable. */
function lint(only?: string) { // zanity: ignore[assertion-density] -- single-invariant: the skills directory check is the only outside data risk and a second assertion would restate it
  const scratch = join(mkdtempSync(join(tmpdir(), "gated-delivery-evalcheck-")), "output.md");
  writeFileSync(scratch, "placeholder\n");
  writeFileSync(join(dirname(scratch), TRANSCRIPT_FILE), "");
  assert(existsSync(SKILLS_DIR), `skills are read from ${SKILLS_DIR}; run from the repository root`);
  const skills = readdirSync(SKILLS_DIR).filter((s) => existsSync(join(SKILLS_DIR, s, "evals.md")) && (only === undefined || s === only));
  if (only !== undefined && !skills.length) {
    console.log(`  BROKEN ${only}: no evals.md to lint`);
    return 1;
  }
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
  const scenarioMode = scenarioAt !== -1;
  const positional = args.filter((_, i) => i !== scenarioAt && i !== scenarioAt + 1);
  const [skill, file] = scenarioMode ? positional : [arg, outputFile];
  let exitCode;
  try {
    const id = args[scenarioAt + 1];
    const wellFormed = scenarioMode ? Boolean(id) && positional.length === 2 : Boolean(arg && outputFile);
    const lintMode = !scenarioMode && arg === "--lint";
    if (lintMode) exitCode = lint(outputFile) ? EXIT_FAIL : EXIT_PASS;
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
