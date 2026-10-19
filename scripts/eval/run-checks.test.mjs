// Behaviour check for the eval-fence runner. Run: node --test scripts/eval/run-checks.test.mjs
//
// The runner exists to catch checks that cannot run. Shipping it untested would repeat the mistake
// it was written to prevent, so the cases below cover both directions: a broken command must be
// reported, and a working one must not be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChecks, parseExpect, runCheck, scenarioIds } from "./run-checks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const fence = (body) => `## Deterministic Checks\n\n\`\`\`bash\n${body}\n\`\`\`\n`;

const outputFile = (body) => {
  const f = join(mkdtempSync(join(tmpdir(), "gated-delivery-runner-test-")), "output.md");
  writeFileSync(f, body);
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
  // Regression: primer's fence sets OUT=out.html once and every command uses "$OUT". Running each
  // command in its own shell dropped the variable, so 7 of its 8 checks reported as broken — the
  // 8th only looked fine because it is a pipeline, which used to mask the failure entirely.
  const { prelude, checks } = parseChecks(fence('OUT=out.html\n# a check\ngrep -c x "$OUT"'));
  assert.deepEqual(prelude, ["OUT=out.html"]);
  assert.equal(checks.length, 1, "the assignment must not count as a check");
});

test("a prelude variable resolves to the file under test", () => {
  const file = outputFile("hello\n");
  const { prelude, checks } = parseChecks(fence('OUT=out.html\ngrep -c hello "$OUT"'));
  const result = runCheck(checks[0], file, prelude);
  assert.equal(result.ok, true);
  assert.equal(result.result, "1");
});

test("no match is a result, not a broken command", () => {
  // grep exits 1 when it matches nothing. Treating that as breakage would flag every legitimately
  // zero-scoring check.
  const { checks } = parseChecks(fence("grep -c absent output.md"));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, true);
  assert.equal(result.result, "0");
});

test("a command that cannot run is reported as broken", () => {
  const { checks } = parseChecks(fence("grep --nonsense-flag x output.md"));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false, "a usage error must not be mistaken for a zero score");
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

test("a path containing shell metacharacters is read, not executed", () => {
  // JSON.stringify wraps in double quotes, inside which $(...) still expands: a path holding
  // `$(id -u)` was substituted and then executed, so the check read a different file entirely.
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-runner-quote-"));
  const nasty = join(dir, "$(id -u) `whoami` x");
  mkdirSync(nasty, { recursive: true });
  const file = join(nasty, "output.md");
  writeFileSync(file, "hello\n");

  const { checks } = parseChecks(fence("grep -c hello output.md"));
  const result = runCheck(checks[0], file);
  assert.equal(result.ok, true, `path was not read literally: ${result.result}`);
  assert.equal(result.result, "1");
});

test("a prelude assignment also quotes the path safely", () => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-runner-quote2-"));
  const nasty = join(dir, "$(id -u)");
  mkdirSync(nasty, { recursive: true });
  const file = join(nasty, "output.md");
  writeFileSync(file, "hello\n");

  const { prelude, checks } = parseChecks(fence('OUT=out.html\ngrep -c hello "$OUT"'));
  const result = runCheck(checks[0], file, prelude);
  assert.equal(result.ok, true, `prelude path was not read literally: ${result.result}`);
  assert.equal(result.result, "1");
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
  // Regression: stripping /'[^']*'/ spans treated the apostrophe in "it's" as an opening quote and
  // swallowed the variable that followed, so an unset reference read as fine.
  const { checks } = parseChecks(fence(`grep -c "it's $MISSING_AFTER_APOSTROPHE" output.md`));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /MISSING_AFTER_APOSTROPHE/);
});

test("prose between the heading and the fence does not hide the checks", () => {
  // The regex used to demand the fence immediately after the heading, so a skill that explained its
  // checks first parsed as zero — and `--lint` still counted it among the covered skills.
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
  // Regression: inside `$( )` the shell restarts quoting, so the apostrophe in the nested "it's" is
  // a literal. A flat scan read it as an opening single quote and swallowed the rest of the line —
  // the unset variable after it expanded to empty and the check reported green.
  const { checks } = parseChecks(fence(`echo "$(echo "it's fine") $MISSING_IN_NEST"`));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /MISSING_IN_NEST/);
});

test("parentheses inside a command substitution do not close it early", () => {
  // Regression: the `)` of `$(( ))` or a subshell was read as the end of the substitution, so the
  // outer quote state came back one level too soon and the apostrophe after it opened a span that
  // hid the unset variable.
  const { checks } = parseChecks(fence(`echo "$(echo $((1+2)) "it's ok") $MISSING_AFTER_PARENS"`));
  const result = runCheck(checks[0], outputFile("hello\n"));
  assert.equal(result.ok, false);
  assert.match(result.result, /MISSING_AFTER_PARENS/);
});

test("an ambient environment variable does not satisfy a fence reference", () => {
  // Otherwise --lint passes or fails on what the host happens to export, and a typo'd name is
  // waved through whenever something unrelated shares it.
  process.env.GATED_DELIVERY_AMBIENT_PROBE = "/tmp";
  try {
    const { checks } = parseChecks(fence('grep -c hello "$GATED_DELIVERY_AMBIENT_PROBE"'));
    const result = runCheck(checks[0], outputFile("hello\n"));
    assert.equal(result.ok, false);
    assert.match(result.result, /unset variable\(s\): GATED_DELIVERY_AMBIENT_PROBE/);
  } finally {
    delete process.env.GATED_DELIVERY_AMBIENT_PROBE;
  }
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
  const run = (cwd) => {
    try {
      return {
        code: 0,
        out: execFileSync("node", [join(HERE, "run-checks.mjs"), "--lint"], { cwd, encoding: "utf8" }),
      };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };

  const real = run(REPO);
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
  const red = run(broken);
  assert.equal(red.code, 1);
  assert.match(red.out, /BROKEN busted/);
});

const SCENARIO_TABLE = "## Test Scenarios\n\n| # | Prompt | Persona | Pass Criteria |\n|---|---|---|---|\n| 1 | p | q | r |\n| 2b | p | q | r |\n\n";

const repoWith = (skill, evalsBody) => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-runner-scenario-"));
  const skillDir = join(dir, "plugin", "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "evals.md"), evalsBody);
  return dir;
};

const cli = (cwd, ...args) => {
  try {
    return { code: 0, out: execFileSync("node", [join(HERE, "run-checks.mjs"), ...args], { cwd, encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
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
  const { code, out } = cli(dir, "alpha", outputFile("a\n"), "--scenario", "1");
  assert.equal(code, 0, out);
  assert.equal(out.trim(), "PASS 1 >=1 Has a.");
});

test("--scenario prints FAIL and exits 1 when a check misses its expectation", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# Has a.\n# expect: >=1 on 1\ngrep -c a output.md\n# No b.\n# expect: ==0 on 1\ngrep -c b output.md"));
  const { code, out } = cli(dir, "alpha", outputFile("b\n"), "--scenario", "1");
  assert.equal(code, 1, out);
  assert.match(out, /^FAIL 0 >=1 Has a\.$/m);
  assert.match(out, /^FAIL 1 ==0 No b\.$/m);
});

test("--scenario counts the lines of a check that prints matches rather than a number", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# No pure black.\n# expect: ==0 on 1\ngrep -i '#000' output.md"));
  assert.equal(cli(dir, "alpha", outputFile("ok\n"), "--scenario", "1").code, 0);
  const red = cli(dir, "alpha", outputFile("color: #000\nfill: #000\n"), "--scenario", "1");
  assert.equal(red.code, 1);
  assert.match(red.out, /^FAIL 2 ==0 No pure black\.$/m);
});

test("--scenario skips manual checks and checks for other scenarios", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# Judged by hand.\n# expect: manual\ngrep -c a output.md\n# Elsewhere.\n# expect: ==9 on 2b\ngrep -c a output.md"));
  const { code, out } = cli(dir, "alpha", outputFile("a\n"), "--scenario", "1");
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

  const onResponse = cli(dir, "alpha", response, "--scenario", "1");
  assert.equal(onResponse.code, 0, onResponse.out);
  assert.equal(onResponse.out.trim(), "PASS 1 >=1 Response says hi.");
  const onPage = cli(dir, "alpha", page, "--scenario", "1");
  assert.equal(onPage.code, 0, onPage.out);
  assert.equal(onPage.out.trim(), "PASS 1 >=1 Page: has a pre block.");
});

test("--scenario exits 2 on a usage error", () => {
  const dir = repoWith("alpha", SCENARIO_TABLE + fence("# x\n# expect: >=1 on 1\ngrep -c a output.md"));
  const file = outputFile("a\n");
  assert.equal(cli(dir, "alpha", file, "--scenario").code, 2, "missing id");
  assert.equal(cli(dir, "alpha", file, "--scenario", "404").code, 2, "id not in the scenario table");
  assert.equal(cli(dir, "nope", file, "--scenario", "1").code, 2, "unknown skill");
  assert.equal(cli(dir, "alpha", join(dir, "absent.md"), "--scenario", "1").code, 2, "missing file");
});

test("--lint rejects a malformed expect line and an unknown scenario id, and accepts manual", () => {
  const good = repoWith("alpha", SCENARIO_TABLE + fence("# a\n# expect: >=1 on 1,2b\ngrep -c a output.md\n# b\n# expect: manual\ngrep -c b output.md"));
  const ok = cli(good, "--lint");
  assert.equal(ok.code, 0, ok.out);

  const malformed = repoWith("alpha", SCENARIO_TABLE + fence("# a\n# expect: at least 1 on 1\ngrep -c a output.md"));
  const red1 = cli(malformed, "--lint");
  assert.equal(red1.code, 1);
  assert.match(red1.out, /malformed expect/);

  const unknown = repoWith("alpha", SCENARIO_TABLE + fence("# a\n# expect: >=1 on 1,7\ngrep -c a output.md"));
  const red2 = cli(unknown, "--lint");
  assert.equal(red2.code, 1);
  assert.match(red2.out, /unknown scenario "7"/);
});
