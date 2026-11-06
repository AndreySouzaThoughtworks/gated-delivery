// Behaviour check for the eval-fence runner. Run: node --test scripts/eval/run-checks.test.ts
//
// The runner exists to catch checks that cannot run. Shipping it untested would repeat the mistake
// it was written to prevent, so the cases below cover both directions: a broken command must be
// reported, and a working one must not be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChecks, parseExpect, runCheck, scenarioIds } from "./run-checks.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const OUTPUT_NAME = "output.md";
const TRANSCRIPT_NAME = "transcript.jsonl";
const CODE_FENCE = "```";

type ExecFailure = { status?: number; stdout?: string; stderr?: string };

const fence = (body: string) => {
  assert(!body.includes(CODE_FENCE), `fence got body ${JSON.stringify(body)}; expected no ${JSON.stringify(CODE_FENCE)} inside it, since it would close the fence early`);
  const markdown = `## Deterministic Checks\n\n\`\`\`bash\n${body}\n\`\`\`\n`;
  assert(markdown.startsWith("## Deterministic Checks\n"), "fence does not open with the Deterministic Checks heading; expected the section parseChecks reads");
  assert(markdown.includes(`\n${body}\n`), `fence got markdown ${JSON.stringify(markdown)}; expected body ${JSON.stringify(body)} on its own lines inside the fence`);
  return markdown;
};

const withEnv = <T>(name: string, value: string, body: () => T) => {
  assert(process.env[name] === undefined, `withEnv would overwrite ${name}, already set to ${process.env[name]}; expected an unset variable`);
  process.env[name] = value;
  let result: T;
  try {
    result = body();
  } finally {
    delete process.env[name];
  }
  assert(process.env[name] === undefined, `withEnv left ${name} set; expected it removed after the body`);
  return result;
};

const outputFile = (body: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "gated-delivery-runner-test-")), OUTPUT_NAME);
  writeFileSync(f, body);
  assert(basename(f) === OUTPUT_NAME, `outputFile named the file ${basename(f)}; expected ${OUTPUT_NAME}, the name fences refer to`);
  assert(readFileSync(f, "utf8") === body, `${f} does not hold the body outputFile wrote`);
  return f;
};

test("parses labelled commands and skips comment-only lines", () => {
  const { checks } = parseChecks(
    fence("# first label\ngrep -c a output.md\n# second\ngrep -c b output.md"),
  );
  assert.equal(checks.length, 2);
  assert.equal(checks[0].label, "first label");
  assert.equal(checks[1].command, "grep -c b output.md");
});

test("multi-line comments join into one label", () => {
  const { checks } = parseChecks(fence("# line one\n# line two\ngrep -c a output.md"));
  assert.equal(checks[0].label, "line one line two");
});

test("returns nothing when the skill has no fence", () => {
  const { checks, prelude } = parseChecks("# Evals\n\nNo deterministic section here.\n");
  assert.deepEqual(checks, []);
  assert.deepEqual(prelude, []);
});

test("collects leading assignments as a prelude rather than treating them as checks", () => {
  // A fence sets OUT=out.html once and every command uses "$OUT": running each command in its own
  // shell would drop the variable and report the checks as broken.
  const { prelude, checks } = parseChecks(fence('OUT=out.html\n# a check\ngrep -c x "$OUT"'));
  assert.deepEqual(prelude, ["OUT=out.html"]);
  assert.equal(checks.length, 1, "the assignment must not count as a check");
});

test("no match is a result, not a broken command", () => {
  // grep exits 1 when it matches nothing. Treating that as breakage would flag every legitimately
  // zero-scoring check.
  const { checks } = parseChecks(fence("grep -c absent output.md"));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, true);
  assert.equal(result.result, "0");
});

test("a broken command inside a pipeline is still detected", () => {
  // `sh -c` reports only the last stage, so an upstream failure exited 0 and the check read as
  // runnable. Several real fences are pipelines.
  const { checks } = parseChecks(fence("grep --nonsense-flag x output.md | wc -l"));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false, "an upstream failure must not be masked by the last stage");
});

test("a command containing the word 'output' is not corrupted by substitution", () => {
  // Substituting a bare `output` as well as `output.md` mangled the pattern and returned a wrong
  // count instead of an error.
  const file = outputFile("the output format is fine\n");
  const { checks } = parseChecks(fence('grep -c "output format" output.md'));
  const result = runCheck(checks[0], file);
  assert.equal(result.ok, true);
  assert.equal(result.result, "1", "the literal pattern must survive substitution");
});

test("a variable nothing supplies is reported, not silently expanded to empty", () => {
  const { checks } = parseChecks(fence('grep -c x "$NOT_SUPPLIED_ANYWHERE"'));
  const result = runCheck(checks[0], outputFile("x\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /unset variable\(s\): NOT_SUPPLIED_ANYWHERE/);
});

test("$WORKTREE is supplied by the runner", () => {
  const { checks } = parseChecks(fence('test -d "$WORKTREE" && echo ok'));
  const result = runCheck(checks[0], outputFile("x\n"));
  assert.equal(result.ok, true);
  assert.equal(result.result, "ok");
});

test("a path containing shell metacharacters is read, not executed, by the placeholder and by a prelude", () => {
  const fences = ["grep -c hello output.md", 'OUT=out.html\ngrep -c hello "$OUT"'];
  for (const body of fences) {
    const nasty = join(mkdtempSync(join(tmpdir(), "gated-delivery-runner-quote-")), "$(id -u) `whoami` x");
    mkdirSync(nasty);
    const file = join(nasty, "output.md");
    writeFileSync(file, "hello\n");
    const { prelude, checks } = parseChecks(fence(body));
    const result = runCheck(checks[0], file, prelude);
    assert.equal(result.ok, true, `path was not read literally: ${result.result}`);
    assert.equal(result.result, "1");
  }
});

test("expansion forms are classified by whether an unset variable still yields something", () => {
  // The `+` forms are the trap: they read like defaults but expand to EMPTY when unset, which is
  // exactly the silent-empty case this check exists to catch. `-` and `=` supply a real fallback,
  // with or without the colon.
  const cases = [
    ["${MISS_A-hello}", true],
    ["${MISS_B=hello}", true],
    ["${MISS_C:-hello}", true],
    ["${MISS_D:=hello}", true],
    ["${MISS_E:+hello}", false],
    ["${MISS_F+hello}", false],
    ["${MISS_G}", false],
    ["$MISS_H", false],
  ];
  for (const [expansion, shouldRun] of cases) {
    const { checks } = parseChecks(fence(`grep -c ${expansion} output.md`));
    const result = runCheck(checks[0], outputFile("hello\n"));
    assert.equal(result.ok, shouldRun, `${expansion} -> ${result.result}`);
  }
});

test("a $NAME inside single quotes is a literal, not a variable", () => {
  const { checks } = parseChecks(fence("grep -c '$NOT_A_VAR' output.md"));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, true, "the shell does not expand inside single quotes");
});

test("an apostrophe inside a double-quoted argument is not a quote delimiter", () => {
  // Stripping /'[^']*'/ spans would treat the apostrophe in "it's" as an opening quote and swallow
  // the variable that follows, so an unset reference would read as fine.
  const { checks } = parseChecks(fence(`grep -c "it's $MISSING_AFTER_APOSTROPHE" output.md`));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /MISSING_AFTER_APOSTROPHE/);
});

test("prose between the heading and the fence does not hide the checks", () => {
  // A fence that does not directly follow the heading still counts: parsing it as zero checks would
  // leave `--lint` counting the skill as covered.
  const md = "## Deterministic Checks\n\nRun against a saved response.\n\n```bash\ngrep -c x output.md\n```\n";
  assert.equal(parseChecks(md).checks.length, 1);
});

test("a ## comment inside the fence is not a section boundary", () => {
  // `## note` is a legal shell comment. Bounding the section on any line starting `## ` truncated
  // the fence at it and the whole skill parsed as zero checks.
  const md = "## Deterministic Checks\n\n```bash\n## count the matches\ngrep -c x output.md\n```\n";
  assert.equal(parseChecks(md).checks.length, 1);
});

test("a fence in a later section is not mistaken for the checks fence", () => {
  const md = "## Deterministic Checks\n\nNone yet.\n\n## Notes\n\n```bash\necho nope\n```\n";
  assert.equal(parseChecks(md).checks.length, 0);
});

test("a command substitution starts its own quoting context", () => {
  // Inside `$( )` the shell restarts quoting, so the apostrophe in the nested "it's" is a literal.
  // A flat scan would read it as an opening single quote and swallow the rest of the line, and the
  // unset variable after it would expand to empty and report green.
  const { checks } = parseChecks(fence(`echo "$(echo "it's fine") $MISSING_IN_NEST"`));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /MISSING_IN_NEST/);
});

test("parentheses inside a command substitution do not close it early", () => {
  // Only the `)` that balances the opening `$(` ends the substitution. Ending it at the `)` of
  // `$(( ))` or a subshell would restore the outer quote state too soon, and the apostrophe after
  // it would open a span that hides the unset variable.
  const { checks } = parseChecks(fence(`echo "$(echo $((1+2)) "it's ok") $MISSING_AFTER_PARENS"`));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /MISSING_AFTER_PARENS/);
});

test("an ambient environment variable does not satisfy a fence reference", () => {
  // Otherwise --lint passes or fails on what the host happens to export, and a typo'd name is
  // waved through whenever something unrelated shares it.
  withEnv("GATED_DELIVERY_AMBIENT_PROBE", "/tmp", () => {
    const { checks } = parseChecks(fence('grep -c hello "$GATED_DELIVERY_AMBIENT_PROBE"'));
    const result = runCheck(checks[0], outputFile("hello\n"));
    assert.equal(result.ok, false);
    assert.match(result.result, /unset variable\(s\): GATED_DELIVERY_AMBIENT_PROBE/);
  });
});

test("an already-quoted output.md placeholder is not double-quoted", () => {
  // `cat "output.md"` became `cat "'/path'"` — a filename that does not exist. The read failed,
  // and exit 1 was then reported as a clean score of 0.
  const { checks } = parseChecks(fence('cat "output.md"'));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, true);
  assert.equal(result.result, "hello", "the file must actually be read");
});

test("--lint passes over the real skills and goes red when a check is broken", () => {
  const real = cli(REPO, ["--lint"]);
  assert.equal(real.code, 0, real.out);
  assert.match(real.out, /All Deterministic Checks are runnable/);
  // The summary must state what was measured. "across N skills" alone read as coverage even when a
  // skill carried no fence at all.
  // Non-zero, but not measured === total: a skill without a fence is a WARN by design (the guard's
  // call), so demanding equality here would turn that judgment call into a hard suite failure —
  // while "0 checks across 0/10" must still fail, or the summary asserts nothing.
  assert.match(real.out, /[1-9]\d* checks across [1-9]\d*\/\d+ skills/, real.out);

  // Same runner, one deliberately broken fence: it must go red, or --lint proves nothing in CI.
  const broken = mkdtempSync(join(tmpdir(), "gated-delivery-runner-broken-"));
  const skill = join(broken, "plugin", "skills", "busted");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "evals.md"), fence("# broken\ngrep --nonsense-flag x output.md"));
  const red = cli(broken, ["--lint"]);
  assert.equal(red.code, 1);
  assert.match(red.out, /BROKEN busted/);
});

const SCENARIO_TABLE = "## Test Scenarios\n\n| # | Prompt | Persona | Pass Criteria |\n|---|---|---|---|\n| 1 | p | q | r |\n| 2b | p | q | r |\n\n";

const repoWith = (skill: string, evalsBody: string) => {
  assert(!skill.includes("/"), `repoWith got skill ${JSON.stringify(skill)}; expected a bare folder name`);
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-runner-scenario-"));
  const skillDir = join(dir, "plugin", "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "evals.md"), evalsBody);
  assert(existsSync(join(skillDir, "evals.md")), `repoWith(${skill}) wrote no evals.md; expected one for the runner to read`);
  return dir;
};

const cli = (cwd: string, args: string[]) => {
  assert(existsSync(cwd), `cli ran in ${cwd}, which does not exist; expected an existing folder`);
  assert(args.length > 0, `cli got ${args.length} arguments; expected --lint or a skill and an output file`);
  try {
    return { code: 0, out: execFileSync("node", [join(HERE, "run-checks.ts"), ...args], { cwd, encoding: "utf8" }) };
  } catch (e) {
    const failure = e as ExecFailure;
    return { code: failure.status ?? 1, out: (failure.stdout ?? "") + (failure.stderr ?? "") };
  }
};

test("expect lines are parsed apart from the label", () => {
  const { checks } = parseChecks(
    fence("# Clean result reported.\n# expect: >=1 on 1,2b\n# expect: ==0 on 3\ngrep -c a output.md"),
  );
  assert.equal(checks[0].label, "Clean result reported.");
  assert.deepEqual(
    checks[0].expects.map(({ op, n, ids }) => ({ op, n, ids })),
    [
      { op: ">=", n: 1, ids: ["1", "2b"] },
      { op: "==", n: 0, ids: ["3"] },
    ],
  );
});

test("parseExpect accepts the three operators and manual, and rejects anything else", () => {
  assert.deepEqual(
    (({ op, n, ids }) => ({ op, n, ids }))(parseExpect("expect: <=2 on R1")),
    { op: "<=", n: 2, ids: ["R1"] },
  );
  assert.equal(parseExpect("expect: manual").manual, true);
  for (const bad of ["expect: >1 on 1", "expect: >= 1 on 1", "expect: >=1", "expect: >=1 on", "expect: about 3 on 1", "expect: >=1 on 1,1"]) {
    assert.ok(parseExpect(bad).error, `must reject: ${bad}`);
  }
});

test("scenarioIds reads every table row under Test Scenarios, across sub-tables", () => {
  const md = `${SCENARIO_TABLE}### More\n\n| # | Prompt |\n|---|---|\n|  R7  | x |\n\n## Other\n\n| 99 | not a scenario |\n`;
  assert.deepEqual([...scenarioIds(md)], ["1", "2b", "R7"]);
});

test("--scenario prints PASS and exits 0 when every applicable check holds", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# Has a.\n# expect: >=1 on 1\ngrep -c a output.md\n# Other scenario.\n# expect: ==5 on 2b\ngrep -c zzz output.md"));
  const { code, out } = cli(dir, ["alpha", outputFile("a\n"), "--scenario", "1"]);
  assert.equal(code, 0, out);
  assert.equal(out.trim(), "PASS 1 >=1 Has a.");
});

test("--scenario prints FAIL and exits 1 when a check misses its expectation", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# Has a.\n# expect: >=1 on 1\ngrep -c a output.md\n# No b.\n# expect: ==0 on 1\ngrep -c b output.md"));
  const { code, out } = cli(dir, ["alpha", outputFile("b\n"), "--scenario", "1"]);
  assert.equal(code, 1, out);
  assert.match(out, /^FAIL 0 >=1 Has a\.$/m);
  assert.match(out, /^FAIL 1 ==0 No b\.$/m);
});

test("--scenario counts the lines of a check that prints matches rather than a number", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# No pure black.\n# expect: ==0 on 1\ngrep -i '#000' output.md"));
  assert.equal(cli(dir, ["alpha", outputFile("ok\n"), "--scenario", "1"]).code, 0);
  const red = cli(dir, ["alpha", outputFile("color: #000\nfill: #000\n"), "--scenario", "1"]);
  assert.equal(red.code, 1);
  assert.match(red.out, /^FAIL 2 ==0 No pure black\.$/m);
});

test("--scenario skips manual checks and checks for other scenarios", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# Judged by hand.\n# expect: manual\ngrep -c a output.md\n# Elsewhere.\n# expect: ==9 on 2b\ngrep -c a output.md"));
  const { code, out } = cli(dir, ["alpha", outputFile("a\n"), "--scenario", "1"]);
  assert.equal(code, 0, out);
  assert.equal(out.trim(), "");
});

test("--scenario runs Page checks on a page and response checks on output.md", () => {
  const body = SCENARIO_TABLE + fence("# Response says hi.\n# expect: >=1 on 1\ngrep -c hi output.md\n# Page: has a pre block.\n# expect: >=1 on 1\ngrep -c '<pre>' output.md");
  const dir = repoWith("alpha", body);
  const response = outputFile("hi\n");
  const pageDir = mkdtempSync(join(tmpdir(), "gated-delivery-runner-page-"));
  const page = join(pageDir, "deskcheck.html");
  writeFileSync(page, "<pre>x</pre>\n");

  const onResponse = cli(dir, ["alpha", response, "--scenario", "1"]);
  assert.equal(onResponse.code, 0, onResponse.out);
  assert.equal(onResponse.out.trim(), "PASS 1 >=1 Response says hi.");
  const onPage = cli(dir, ["alpha", page, "--scenario", "1"]);
  assert.equal(onPage.code, 0, onPage.out);
  assert.equal(onPage.out.trim(), "PASS 1 >=1 Page: has a pre block.");
});

test("--scenario exits 2 on a usage error", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# x\n# expect: >=1 on 1\ngrep -c a output.md"));
  const file = outputFile("a\n");
  assert.equal(cli(dir, ["alpha", file, "--scenario"]).code, 2, "missing id");
  assert.equal(cli(dir, ["alpha", file, "--scenario", "404"]).code, 2, "id not in the scenario table");
  assert.equal(cli(dir, ["nope", file, "--scenario", "1"]).code, 2, "unknown skill");
  assert.equal(cli(dir, ["alpha", join(dir, "absent.md"), "--scenario", "1"]).code, 2, "missing file");
});

test("a skill argument that is a path, or . or .., is a usage error before any check runs", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# x\n# expect: >=1 on 1\ngrep -c a output.md"));
  const file = outputFile("a\n");
  for (const skill of ["..", ".", "a/b", "../alpha", ""]) {
    for (const args of [[skill, file], [skill, file, "--scenario", "1"]]) {
      const result = cli(dir, args);
      assert.equal(result.code, 2, `${JSON.stringify(skill)} ${args.length}: ${result.out}`);
      assert.doesNotMatch(result.out, /AssertionError/);
    }
  }
});

test("an unreadable evals.md exits 3 as a harness error, not 1 which means FAIL", () => {
  const dir = repoWith("alpha", "placeholder");
  const evalsPath = join(dir, "plugin", "skills", "alpha", "evals.md");
  rmSync(evalsPath);
  mkdirSync(evalsPath);
  const result = cli(dir, ["alpha", outputFile("a\n")]);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /EISDIR/);
  const lint = cli(dir, ["--lint"]);
  assert.equal(lint.code, 3, lint.out);
  assert.match(lint.out, /EISDIR/);
});

test("--lint rejects a malformed expect line and an unknown scenario id, and accepts manual", () => {
  const good = repoWith("alpha", SCENARIO_TABLE + fence("# a\n# expect: >=1 on 1,2b\ngrep -c a output.md\n# b\n# expect: manual\ngrep -c b output.md"));
  const ok = cli(good, ["--lint"]);
  assert.equal(ok.code, 0, ok.out);

  const malformed = repoWith("alpha", SCENARIO_TABLE + fence("# a\n# expect: at least 1 on 1\ngrep -c a output.md"));
  const red1 = cli(malformed, ["--lint"]);
  assert.equal(red1.code, 1);
  assert.match(red1.out, /malformed expect/);

  const unknown = repoWith("alpha", SCENARIO_TABLE + fence("# a\n# expect: >=1 on 1,7\ngrep -c a output.md"));
  const red2 = cli(unknown, ["--lint"]);
  assert.equal(red2.code, 1);
  assert.match(red2.out, /unknown scenario "7"/);
});

const TOOL_USE_WRITE = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/x/a.html"}}]}}\n';
const COUNT_WRITES = "grep -c '\"name\":\"Write\"' transcript.jsonl";

const outputWithTranscript = (transcript?: string) => {
  const file = outputFile("hello\n");
  if (transcript !== undefined) writeFileSync(join(dirname(file), TRANSCRIPT_NAME), transcript);
  assert(existsSync(file), `outputWithTranscript wrote no ${OUTPUT_NAME}; expected the graded file`);
  assert(existsSync(join(dirname(file), TRANSCRIPT_NAME)) === (transcript !== undefined), `outputWithTranscript(${transcript === undefined ? "no transcript" : "a transcript"}) disagrees with the ${TRANSCRIPT_NAME} on disk; expected one only when given`);
  return file;
};

test("the transcript.jsonl placeholder resolves beside the graded file, read literally whatever the path holds", () => {
  const nasty = join(mkdtempSync(join(tmpdir(), "gated-delivery-runner-transcript-")), "$(id -u) `whoami` it's $&");
  mkdirSync(nasty);
  const file = join(nasty, "output.md");
  writeFileSync(file, "hello\n");
  writeFileSync(join(nasty, "transcript.jsonl"), TOOL_USE_WRITE);
  for (const command of [COUNT_WRITES, 'grep -c "\\"name\\":\\"Write\\"" "transcript.jsonl"']) {
    const result = runCheck({ label: "x", command }, file);
    assert.equal(result.ok, true, result.result);
    assert.equal(result.result, "1");
  }
});

test("a check using transcript.jsonl fails when no transcript sits beside the file", () => {
  const file = outputWithTranscript();
  const result = runCheck({ label: "x", command: COUNT_WRITES }, file);
  assert.equal(result.ok, false);
  assert.equal(result.result, `no transcript.jsonl beside ${file}`);
});

test("a transcript with a Write tool_use passes the count and one without scores zero", () => {
  assert.equal(runCheck({ label: "x", command: COUNT_WRITES }, outputWithTranscript(TOOL_USE_WRITE)).result, "1");
  const without = runCheck({ label: "x", command: COUNT_WRITES }, outputWithTranscript('{"type":"result"}\n'));
  assert.equal(without.ok, true);
  assert.equal(without.result, "0");
});

test("--lint proves a command using transcript.jsonl runnable and rejects a broken one", () => {
  const good = repoWith("alpha", SCENARIO_TABLE + fence(`# w\n${COUNT_WRITES}`));
  const ok = cli(good, ["--lint"]);
  assert.equal(ok.code, 0, ok.out);
  const broken = repoWith("alpha", SCENARIO_TABLE + fence("# w\ngrep --nonsense-flag x transcript.jsonl"));
  assert.equal(cli(broken, ["--lint"]).code, 1);
});

test("parseExpect refuses text that spans lines", () => {
  assert.throws(() => parseExpect("expect: >=1 on a\nexpect: manual"), /an expect is one line/);
  assert.deepEqual(parseExpect("expect: manual"), { raw: "expect: manual", manual: true });
});

test("runCheck refuses an empty output file and a path with a NUL byte", () => {
  assert.throws(() => runCheck({ label: "x", command: "true" }, ""), /a check runs against an output file/);
  assert.throws(() => runCheck({ label: "x", command: "cat output.md" }, "/tmp/out\0put.md"), /a shell argument cannot carry a NUL byte/);
});

const DIGITS_BEYOND_DOUBLE_RANGE = 400;

test("--scenario exits 3 when an expect carries a number too large to be an integer", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence(`# Huge.\n# expect: >=${"9".repeat(DIGITS_BEYOND_DOUBLE_RANGE)} on 1\ngrep -c a output.md`));
  const result = cli(dir, ["alpha", outputFile("a\n"), "--scenario", "1"]);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /a comparison expect carries an integer/);
});

test("--lint exits 3 when run outside the repository root, where there are no skills", () => {
  const result = cli(mkdtempSync(join(tmpdir(), "gated-delivery-runner-empty-")), ["--lint"]);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /skills are read from/);
});

test("runCheck refuses a prelude entry that is not an assignment", () => {
  assert.throws(() => runCheck({ label: "x", command: "true" }, "/tmp/output.md", ["rm -f x"]), /the prelude holds assignments only/);
});

test("--lint with a skill name lints only that skill and rejects a skill with no evals.md", () => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-runner-one-skill-"));
  for (const [skill, body] of [["good", "grep -c a output.md"], ["busted", "grep --nonsense-flag x output.md"]]) {
    mkdirSync(join(dir, "plugin", "skills", skill), { recursive: true });
    writeFileSync(join(dir, "plugin", "skills", skill, "evals.md"), fence(`# ${skill}\n${body}`));
  }
  assert.equal(cli(dir, ["--lint", "good"]).code, 0);
  const red = cli(dir, ["--lint", "busted"]);
  assert.equal(red.code, 1);
  assert.match(red.out, /BROKEN busted/);
  const ghost = cli(dir, ["--lint", "ghost"]);
  assert.equal(ghost.code, 1);
  assert.match(ghost.out, /BROKEN ghost: no evals.md to lint/);
});
